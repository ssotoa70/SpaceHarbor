import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { errorEnvelopeSchema, workflowJobSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const claimBodySchema = {
  type: "object",
  required: ["workerId"],
  properties: {
    workerId: { type: "string", minLength: 1 },
    leaseSeconds: { type: "number", minimum: 1 },
    now: { type: "string", format: "date-time" }
  }
} as const;

const claimResponseSchema = {
  type: "object",
  required: ["job"],
  properties: {
    job: {
      anyOf: [workflowJobSchema, { type: "null" }]
    }
  }
} as const;

const reapStaleBodySchema = {
  type: "object",
  properties: {
    now: { type: "string", format: "date-time" }
  }
} as const;

const reapStaleResponseSchema = {
  type: "object",
  required: ["requeuedCount"],
  properties: {
    requeuedCount: { type: "number" }
  }
} as const;

export async function registerQueueRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.post<{ Body: { workerId?: string; leaseSeconds?: number; now?: string } }>(
    "/api/v1/queue/claim",
    {
      schema: {
        tags: ["workflow"],
        operationId: "v1ClaimWorkflowJob",
        summary: "Claim next pending workflow job",
        security: [{ ApiKeyAuth: [] as string[] }],
        body: claimBodySchema,
        response: {
          200: claimResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema
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

      const job = persistence.claimNextJob(workerId, leaseSeconds, {
        correlationId: resolveCorrelationId(request),
        now: request.body?.now
      });

      if (!job) {
        return reply.status(200).send({ job: null });
      }

      return reply.status(200).send({ job });
    }
  );

  app.post<{ Body: { now?: string } }>(
    "/api/v1/queue/reap-stale",
    {
      schema: {
        tags: ["workflow"],
        operationId: "v1ReapStaleLeases",
        summary: "Requeue jobs with expired processing leases",
        security: [{ ApiKeyAuth: [] as string[] }],
        body: reapStaleBodySchema,
        response: {
          200: reapStaleResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema
        }
      }
    },
    async (request, reply) => {
      const nowIso = request.body?.now ?? new Date().toISOString();
      const requeuedCount = persistence.reapStaleLeases(nowIso);
      return reply.status(200).send({ requeuedCount });
    }
  );
}
