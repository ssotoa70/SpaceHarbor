import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerQueueRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.post<{ Body: { workerId?: string; leaseSeconds?: number; now?: string } }>("/api/v1/queue/claim", async (request, reply) => {
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
  });

  app.post<{ Body: { now?: string } }>("/api/v1/queue/reap-stale", async (request, reply) => {
    const nowIso = request.body?.now ?? new Date().toISOString();
    const requeuedCount = persistence.reapStaleLeases(nowIso);
    return reply.status(200).send({ requeuedCount });
  });
}
