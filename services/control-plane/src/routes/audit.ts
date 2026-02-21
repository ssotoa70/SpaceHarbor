import type { FastifyInstance } from "fastify";

import { auditEventsResponseSchema } from "../http/schemas.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerAuditRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(
      withPrefix(prefix, "/audit"),
      {
        schema: {
          tags: ["audit"],
          operationId: prefix === "/api/v1" ? "v1ListAuditEvents" : "legacyListAuditEvents",
          summary: "List recent audit events",
          response: {
            200: auditEventsResponseSchema
          }
        }
      },
      async () => ({
        events: persistence.getAuditEvents().map((event) => ({
          ...event,
          signal: event.signal ?? null
        }))
      })
    );
  }
}
