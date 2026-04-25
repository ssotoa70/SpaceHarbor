/**
 * GET /api/v1/assets/stats — authoritative catalog-wide counters.
 *
 * Returns totals + byStatus + byKind + integrity counters. Used by the
 * <KpiCounterStrip> on the Asset Browser. Gracefully returns 0 for
 * integrity when asset_integrity.* tables are empty or not yet deployed.
 *
 * Spec: docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md
 * Plan: docs/superpowers/plans/2026-04-19-phase-6.0-asset-integrity.md (C1)
 */

import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";

export function registerAssetStatsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): void {
  // Stats endpoint is v1-only (no legacy unversioned alias).
  const v1Prefix = prefixes.find((p) => p === "/api/v1") ?? "/api/v1";

  app.get(
    withPrefix(v1Prefix, "/assets/stats"),
    {
      schema: {
        tags: ["assets"],
        operationId: "getAssetStats",
        summary: "Catalog-wide asset counters (total, byStatus, byKind, integrity)",
        response: {
          200: {
            type: "object",
            required: ["total", "byStatus", "byKind", "integrity"],
            properties: {
              total: { type: "integer" },
              byStatus: { type: "object", additionalProperties: { type: "integer" } },
              byKind: { type: "object", additionalProperties: { type: "integer" } },
              integrity: {
                type: "object",
                required: ["hashed", "with_keyframes"],
                properties: {
                  hashed: { type: "integer" },
                  with_keyframes: { type: "integer" }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const snap = await persistence.getAssetStats();
        return reply.send({
          total: snap.total,
          byStatus: snap.byStatus,
          byKind: snap.byKind,
          integrity: {
            hashed: snap.integrity.hashed,
            with_keyframes: snap.integrity.withKeyframes
          }
        });
      } catch (err) {
        request.log.warn({ err }, "assets/stats fetch failed");
        return sendError(request, reply, 503, "DB_UNREACHABLE", "asset stats source unreachable");
      }
    }
  );
}
