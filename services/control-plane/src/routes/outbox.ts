import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerOutboxRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/outbox", async () => ({
    items: await persistence.getOutboxItems()
  }));

  app.post("/api/v1/outbox/publish", async (request, reply) => {
    const publishedCount = await persistence.publishOutbox({
      correlationId: resolveCorrelationId(request)
    });

    return reply.status(200).send({
      publishedCount
    });
  });
}
