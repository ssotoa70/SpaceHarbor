import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerOutboxRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/outbox", {
    schema: {
      tags: ["events"],
      operationId: "getOutboxItems",
      summary: "List pending outbox items awaiting publication",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["items"],
          properties: {
            items: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
  }, async () => ({
    items: await persistence.getOutboxItems()
  }));

  app.post("/api/v1/outbox/publish", {
    schema: {
      tags: ["events"],
      operationId: "publishOutbox",
      summary: "Publish all pending outbox items to the event broker",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["publishedCount"],
          properties: {
            publishedCount: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const publishedCount = await persistence.publishOutbox({
      correlationId: resolveCorrelationId(request)
    });

    return reply.status(200).send({
      publishedCount
    });
  });
}
