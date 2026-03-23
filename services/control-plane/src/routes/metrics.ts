import type { FastifyInstance } from "fastify";

import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerMetricsRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/metrics", {
    schema: {
      tags: ["observability"],
      summary: "Get workflow reliability counters",
      response: {
        200: {
          type: "object",
          required: ["assets", "jobs", "queue", "outbox", "dlq", "degradedMode", "outbound"],
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
            },
            degradedMode: {
              type: "object",
              required: ["fallbackEvents"],
              properties: {
                fallbackEvents: { type: "number" }
              }
            },
            outbound: {
              type: "object",
              required: ["attempts", "success", "failure", "byTarget"],
              properties: {
                attempts: { type: "number" },
                success: { type: "number" },
                failure: { type: "number" },
                byTarget: {
                  type: "object",
                  required: ["slack", "teams", "production"],
                  properties: {
                    slack: {
                      type: "object",
                      required: ["attempts", "success", "failure"],
                      properties: {
                        attempts: { type: "number" },
                        success: { type: "number" },
                        failure: { type: "number" }
                      }
                    },
                    teams: {
                      type: "object",
                      required: ["attempts", "success", "failure"],
                      properties: {
                        attempts: { type: "number" },
                        success: { type: "number" },
                        failure: { type: "number" }
                      }
                    },
                    production: {
                      type: "object",
                      required: ["attempts", "success", "failure"],
                      properties: {
                        attempts: { type: "number" },
                        success: { type: "number" },
                        failure: { type: "number" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      401: errorEnvelopeSchema
    }
  }, async () => await persistence.getWorkflowStats());
}
