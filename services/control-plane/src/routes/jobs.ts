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

function operationIdForPrefix(prefix: string, baseName: string): string {
  return prefix === "/api/v1" ? `v1${baseName}` : `legacy${baseName}`;
}

export async function registerJobsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
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
          404: errorEnvelopeSchema
        }
      }
    }, async (request, reply) => {
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
