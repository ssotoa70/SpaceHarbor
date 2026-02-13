import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerJobsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get<{ Params: { id: string } }>(withPrefix(prefix, "/jobs/:id"), async (request, reply) => {
      const job = persistence.getJobById(request.params.id);
      if (!job) {
        return sendError(request, reply, 404, "NOT_FOUND", "job not found", {
          jobId: request.params.id
        });
      }

      return reply.status(200).send(job);
    });

    app.get(withPrefix(prefix, "/jobs/pending"), async () => ({
      jobs: persistence.getPendingJobs()
    }));

    app.post<{ Params: { id: string }; Body: { workerId?: string; leaseSeconds?: number } }>(
      withPrefix(prefix, "/jobs/:id/heartbeat"),
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

    app.post<{ Params: { id: string } }>(withPrefix(prefix, "/jobs/:id/replay"), async (request, reply) => {
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
