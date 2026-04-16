/**
 * Audit chain verification endpoint.
 *
 *   POST /admin/audit/verify — recomputes the hash chain of the persisted
 *   audit log and returns a report of any broken rows. Admin-only.
 */

import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import { verifyAuditChain } from "../infra/audit-chain.js";
import { withPrefix } from "../http/routes.js";

export async function registerAuditVerifyRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    app.post(
      withPrefix(prefix, "/admin/audit/verify"),
      {
        schema: {
          tags: ["platform"],
          operationId: `${op}VerifyAuditChain`,
          summary: "Recompute the audit log hash chain and report tampering",
          response: {
            200: {
              type: "object",
              properties: {
                valid: { type: "boolean" },
                scanned: { type: "integer" },
                brokenCount: { type: "integer" },
                brokenIds: { type: "array", items: { type: "string" } },
                firstBrokenId: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      async () => {
        // Persistence returns newest-first; reverse for chain verification
        const events = await persistence.getAuditEvents();
        const oldestFirst = [...events].reverse();
        return verifyAuditChain(oldestFirst);
      },
    );
  }
}
