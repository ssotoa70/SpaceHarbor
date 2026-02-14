import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema, workflowJobSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const jobParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, description: "Workflow job identifier" }
  }
} as const;

const pendingJobsResponseSchema = {
  type: "object",
  required: ["jobs"],
  properties: {
    jobs: {
      type: "array",
      items: workflowJobSchema
    }
  }
} as const;

const jobWrapperResponseSchema = {
  type: "object",
  required: ["job"],
  properties: {
    job: workflowJobSchema
  }
} as const;

const heartbeatBodySchema = {
  type: "object",
  required: ["workerId"],
  properties: {
    workerId: { type: "string", minLength: 1 },
    leaseSeconds: { type: "number", minimum: 1 }
  }
} as const;

function isReplayEnabled(): boolean {
  return process.env.ASSETHARBOR_REPLAY_ENABLED?.trim().toLowerCase() !== "false";
}

function resolveReplayMaxPerMinute(): number {
  const raw = Number(process.env.ASSETHARBOR_REPLAY_MAX_PER_MINUTE ?? "60");
  if (!Number.isFinite(raw) || raw < 1) {
    return 60;
  }

  return Math.floor(raw);
}

function operationIdForPrefix(prefix: string, baseName: string): string {
  return prefix === "/api/v1" ? `v1${baseName}` : `legacy${baseName}`;
}

export async function registerJobsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  const replayWindowMs = 60_000;
  const replayRequestTimes: number[] = [];

  const consumeReplaySlot = (): { allowed: boolean; retryAfterSeconds?: number } => {
    const nowMs = Date.now();
    const oldestAllowed = nowMs - replayWindowMs;

    while (replayRequestTimes.length > 0 && replayRequestTimes[0] <= oldestAllowed) {
      replayRequestTimes.shift();
    }

    const replayMaxPerMinute = resolveReplayMaxPerMinute();
    if (replayRequestTimes.length >= replayMaxPerMinute) {
      const retryAfterSeconds = Math.max(1, Math.ceil((replayRequestTimes[0] + replayWindowMs - nowMs) / 1000));
      return {
        allowed: false,
        retryAfterSeconds
      };
    }

    replayRequestTimes.push(nowMs);
    return {
      allowed: true
    };
  };

  for (const prefix of prefixes) {
    const routePath = withPrefix(prefix, "/jobs/:id");
    app.get<{ Params: { id: string } }>(routePath, {
      schema: {
        tags: ["workflow"],
        operationId: operationIdForPrefix(prefix, "GetJobById"),
        summary: "Get workflow job by id",
        params: jobParamsSchema,
        response: {
          200: workflowJobSchema,
          404: errorEnvelopeSchema
        }
      }
    }, async (request, reply) => {
      const job = persistence.getJobById(request.params.id);
      if (!job) {
        return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
          jobId: request.params.id
        });
      }

      return reply.status(200).send(job);
    });

    app.get(withPrefix(prefix, "/jobs/pending"), {
      schema: {
        tags: ["workflow"],
        operationId: operationIdForPrefix(prefix, "ListPendingJobs"),
        summary: "List pending workflow jobs",
        response: {
          200: pendingJobsResponseSchema
        }
      }
    }, async () => ({
      jobs: persistence.getPendingJobs()
    }));

    app.post<{ Params: { id: string }; Body: { workerId?: string; leaseSeconds?: number } }>(
      withPrefix(prefix, "/jobs/:id/heartbeat"),
      {
        schema: {
          tags: ["workflow"],
          operationId: operationIdForPrefix(prefix, "HeartbeatJobLease"),
          summary: "Extend workflow job lease heartbeat",
          security: [{ ApiKeyAuth: [] as string[] }],
          params: jobParamsSchema,
          body: heartbeatBodySchema,
          response: {
            200: jobWrapperResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const workerId = request.body?.workerId?.trim();
        if (!workerId) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "workerId is required", {
            fields: ["workerId"]
          });
        }

        const leaseSeconds = Number.isFinite(request.body?.leaseSeconds)
          ? Math.max(1, Number(request.body.leaseSeconds))
          : 30;

        const job = persistence.heartbeatJob(request.params.id, workerId, leaseSeconds, {
          correlationId: resolveCorrelationId(request)
        });

        if (!job) {
          return sendError(request, reply, 404, "NOT_FOUND", "job lease not found", {
            jobId: request.params.id,
            workerId
          });
        }

        return reply.status(200).send({ job });
      }
    );

    app.post<{ Params: { id: string } }>(withPrefix(prefix, "/jobs/:id/replay"), {
      schema: {
        tags: ["workflow"],
        operationId: operationIdForPrefix(prefix, "ReplayJob"),
        summary: "Replay failed job back to pending state",
        security: [{ ApiKeyAuth: [] as string[] }],
        params: jobParamsSchema,
        response: {
          202: jobWrapperResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
          404: errorEnvelopeSchema
        }
      }
    }, async (request, reply) => {
      if (!isReplayEnabled()) {
        return sendError(request, reply, 403, "REPLAY_DISABLED", "replay is disabled", {
          route: withPrefix(prefix, "/jobs/:id/replay")
        });
      }

      const existing = persistence.getJobById(request.params.id);
      if (!existing) {
        return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
          jobId: request.params.id
        });
      }

      if (existing.status !== "failed" && existing.status !== "needs_replay") {
        return sendError(request, reply, 409, "REPLAY_NOT_ALLOWED", "job is not replayable in current state", {
          jobId: request.params.id,
          status: existing.status
        });
      }

      const replaySlot = consumeReplaySlot();
      if (!replaySlot.allowed) {
        return sendError(request, reply, 429, "RATE_LIMITED", "replay rate limit exceeded", {
          retryAfterSeconds: replaySlot.retryAfterSeconds
        });
      }

      const job = persistence.replayJob(request.params.id, {
        correlationId: resolveCorrelationId(request)
      });

      if (!job) {
        return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
          jobId: request.params.id
        });
      }

      return reply.status(202).send({ job });
    });
  }
}
