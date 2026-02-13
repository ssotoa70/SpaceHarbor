import type { FastifyInstance } from "fastify";

import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerMetricsRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/metrics", {
    schema: {
      tags: ["observability"],
      summary: "Get workflow reliability counters",
      response: {
        200: {
          type: "object",
          required: ["assets", "jobs", "queue", "outbox", "dlq"],
          properties: {
            assets: {
              type: "object",
              required: ["total"],
              properties: {
                total: { type: "number" }
              }
            },
            jobs: {
              type: "object",
              required: ["total", "pending", "processing", "completed", "failed", "needsReplay"],
              properties: {
                total: { type: "number" },
                pending: { type: "number" },
                processing: { type: "number" },
                completed: { type: "number" },
                failed: { type: "number" },
                needsReplay: { type: "number" }
              }
            },
            queue: {
              type: "object",
              required: ["pending", "leased"],
              properties: {
                pending: { type: "number" },
                leased: { type: "number" }
              }
            },
            outbox: {
              type: "object",
              required: ["pending", "published"],
              properties: {
                pending: { type: "number" },
                published: { type: "number" }
              }
            },
            dlq: {
              type: "object",
              required: ["total"],
              properties: {
                total: { type: "number" }
              }
            }
          }
        }
      }
    }
  }, async () => persistence.getWorkflowStats());
}
