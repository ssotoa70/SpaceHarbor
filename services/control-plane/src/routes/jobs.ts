import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema, workflowJobSchema, assetQueueRowSchema } from "../http/schemas.js";
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
  additionalProperties: false,
  properties: {
    workerId: { type: "string", minLength: 1 },
    leaseSeconds: { type: "number", minimum: 1 }
  }
} as const;

function isReplayEnabled(): boolean {
  return process.env.SPACEHARBOR_REPLAY_ENABLED?.trim().toLowerCase() !== "false";
}

function resolveReplayMaxPerMinute(): number {
  const raw = Number(process.env.SPACEHARBOR_REPLAY_MAX_PER_MINUTE ?? "60");
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
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema
        }
      }
    }, async (request, reply) => {
      const job = await persistence.getJobById(request.params.id);
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
          200: pendingJobsResponseSchema,
          401: errorEnvelopeSchema
        }
      }
    }, async () => ({
      jobs: await persistence.getPendingJobs()
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

        const job = await persistence.heartbeatJob(request.params.id, workerId, leaseSeconds, {
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

      const existing = await persistence.getJobById(request.params.id);
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

      const job = await persistence.replayJob(request.params.id, {
        correlationId: resolveCorrelationId(request)
      });

      if (!job) {
        return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
          jobId: request.params.id
        });
      }

      return reply.status(202).send({ job });
    });

    // -------------------------------------------------------------------------
    // DEV-MODE ONLY: POST /jobs/:id/dev-complete
    // Manually transitions a job from pending/processing → completed → qc_pending
    // so the approval workflow can proceed without a real media worker or
    // VAST DataEngine. Returns 403 in production.
    // -------------------------------------------------------------------------
    const devCompleteBodySchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        metadata: {
          type: "object",
          additionalProperties: true,
          description: "Optional simulated DataEngine output metadata"
        }
      }
    } as const;

    const devCompleteResponseSchema = {
      type: "object",
      required: ["job", "asset"],
      properties: {
        job: workflowJobSchema,
        asset: assetQueueRowSchema
      }
    } as const;

    app.post<{ Params: { id: string }; Body: { metadata?: Record<string, unknown> } }>(
      withPrefix(prefix, "/jobs/:id/dev-complete"),
      {
        schema: {
          tags: ["workflow", "dev"],
          operationId: operationIdForPrefix(prefix, "DevCompleteJob"),
          summary: "[DEV ONLY] Manually complete a job and advance asset to qc_pending",
          params: jobParamsSchema,
          body: devCompleteBodySchema,
          response: {
            200: devCompleteResponseSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        if (process.env.NODE_ENV !== "development") {
          return sendError(request, reply, 403, "DEV_ONLY", "Dev-mode only endpoint");
        }

        app.log.warn(
          { jobId: request.params.id },
          "DEV MODE: Manual job completion — not available in production"
        );

        const correlationId = resolveCorrelationId(request);
        const ctx = { correlationId };

        const existing = await persistence.getJobById(request.params.id);
        if (!existing) {
          return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
            jobId: request.params.id
          });
        }

        if (existing.status !== "pending" && existing.status !== "processing") {
          return sendError(
            request,
            reply,
            409,
            "INVALID_STATUS",
            `job cannot be dev-completed from status '${existing.status}'; expected pending or processing`,
            { jobId: request.params.id, status: existing.status }
          );
        }

        // Step 1: pending → completed (or processing → completed)
        const afterComplete = await persistence.setJobStatus(
          request.params.id,
          "completed",
          null,
          ctx
        );
        if (!afterComplete) {
          return sendError(request, reply, 409, "TRANSITION_FAILED", "failed to transition job to completed");
        }

        // Step 2: completed → qc_pending (makes asset visible to approval workflow)
        const afterQcPending = await persistence.setJobStatus(
          request.params.id,
          "qc_pending",
          null,
          ctx
        );
        if (!afterQcPending) {
          return sendError(request, reply, 409, "TRANSITION_FAILED", "failed to transition job to qc_pending");
        }

        // Refresh the asset queue row so the caller gets the updated status
        const rows = await persistence.listAssetQueueRows();
        const assetRow = rows.find((r) => r.jobId === request.params.id) ?? null;

        return reply.status(200).send({ job: afterQcPending, asset: assetRow });
      }
    );

    // -------------------------------------------------------------------------
    // DEV-MODE ONLY: POST /assets/:id/dev-advance
    // Convenience single-call endpoint: finds the asset's job, claims it if
    // pending, completes it, and sets status to qc_pending — ready for review.
    // Returns 403 in production.
    // -------------------------------------------------------------------------
    const devAdvanceParamsSchema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", minLength: 1, description: "Asset identifier" }
      }
    } as const;

    const devAdvanceResponseSchema = {
      type: "object",
      required: ["asset", "job"],
      properties: {
        asset: assetQueueRowSchema,
        job: workflowJobSchema
      }
    } as const;

    app.post<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/dev-advance"),
      {
        schema: {
          tags: ["assets", "dev"],
          operationId: operationIdForPrefix(prefix, "DevAdvanceAsset"),
          summary: "[DEV ONLY] Advance asset to qc_pending in a single call (claim + complete)",
          params: devAdvanceParamsSchema,
          response: {
            200: devAdvanceResponseSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        if (process.env.NODE_ENV !== "development") {
          return sendError(request, reply, 403, "DEV_ONLY", "Dev-mode only endpoint");
        }

        app.log.warn(
          { assetId: request.params.id },
          "DEV MODE: Manual job completion — not available in production"
        );

        const correlationId = resolveCorrelationId(request);
        const ctx = { correlationId };

        // Find the asset's latest job via the queue rows
        const rows = await persistence.listAssetQueueRows();
        const assetRow = rows.find((r) => r.id === request.params.id);
        if (!assetRow) {
          return sendError(request, reply, 404, "NOT_FOUND", "asset not found", {
            assetId: request.params.id
          });
        }

        if (!assetRow.jobId) {
          return sendError(request, reply, 409, "NO_JOB", "asset has no associated job", {
            assetId: request.params.id
          });
        }

        const job = await persistence.getJobById(assetRow.jobId);
        if (!job) {
          return sendError(request, reply, 404, "NOT_FOUND", "job not found for asset", {
            assetId: request.params.id,
            jobId: assetRow.jobId
          });
        }

        if (job.status === "qc_pending" || job.status === "qc_in_review") {
          // Already advanced — return current state idempotently
          return reply.status(200).send({ asset: assetRow, job });
        }

        if (job.status !== "pending" && job.status !== "processing") {
          return sendError(
            request,
            reply,
            409,
            "INVALID_STATUS",
            `asset job cannot be advanced from status '${job.status}'; expected pending or processing`,
            { assetId: request.params.id, jobId: job.id, status: job.status }
          );
        }

        // If pending, claim it under a synthetic dev worker ID first so the
        // transition graph is satisfied (pending → processing → completed).
        // The transitions table allows pending → completed directly, so we
        // skip the claim and go straight through.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let currentStatus: import("../domain/models.js").WorkflowStatus = job.status;

        // pending → completed is allowed per transitions.ts
        // processing → completed is also allowed
        const afterComplete = await persistence.setJobStatus(job.id, "completed", null, ctx);
        if (!afterComplete) {
          return sendError(request, reply, 409, "TRANSITION_FAILED", "failed to transition job to completed");
        }
        currentStatus = "completed";

        // completed → qc_pending
        const afterQcPending = await persistence.setJobStatus(job.id, "qc_pending", null, ctx);
        if (!afterQcPending) {
          return sendError(
            request,
            reply,
            409,
            "TRANSITION_FAILED",
            `failed to transition job from completed to qc_pending (current: ${currentStatus})`
          );
        }

        // Re-fetch updated asset row
        const updatedRows = await persistence.listAssetQueueRows();
        const updatedAssetRow = updatedRows.find((r) => r.id === request.params.id) ?? assetRow;

        return reply.status(200).send({ asset: updatedAssetRow, job: afterQcPending });
      }
    );
  }
}
