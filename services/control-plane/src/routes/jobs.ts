import type { FastifyInstance } from "fastify";

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
  }
}
