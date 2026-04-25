/**
 * GET /api/v1/assets/:id/integrity — per-asset hashes + keyframes reader.
 *
 * Mirrors the unified-reader pattern at /assets/:id/metadata. Returns
 * sources={hashes,keyframes} ∈ {ok|empty} + the corresponding payload
 * objects (or null). 404 ASSET_NOT_FOUND when the asset is not in the
 * catalog; 503 DB_UNREACHABLE on persistence errors.
 *
 * Spec: docs/superpowers/specs/2026-04-19-phase-6.0-asset-integrity-design.md
 * Plan: docs/superpowers/plans/2026-04-19-phase-6.0-asset-integrity.md (C2)
 */

import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";

export function registerAssetIntegrityRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): void {
  // Integrity endpoint is v1-only (no legacy unversioned alias).
  const v1Prefix = prefixes.find((p) => p === "/api/v1") ?? "/api/v1";

  app.get(
    withPrefix(v1Prefix, "/assets/:id/integrity"),
    {
      schema: {
        tags: ["assets"],
        operationId: "getAssetIntegrity",
        summary: "Per-asset integrity data (hashes + keyframes)",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let snap;
      try {
        snap = await persistence.getAssetIntegrity(id);
      } catch (err) {
        request.log.warn({ err, assetId: id }, "getAssetIntegrity failed");
        return sendError(request, reply, 503, "DB_UNREACHABLE", "integrity source unreachable");
      }

      if (!snap.assetExists) {
        return sendError(request, reply, 404, "ASSET_NOT_FOUND", `asset ${id} not found`);
      }

      return reply.send({
        assetId: id,
        sources: {
          hashes: snap.hashes ? "ok" : "empty",
          keyframes: snap.keyframes ? "ok" : "empty"
        },
        hashes: snap.hashes
          ? {
              sha256: snap.hashes.sha256,
              perceptual_hash: snap.hashes.perceptualHash,
              algorithm_version: snap.hashes.algorithmVersion,
              bytes_hashed: snap.hashes.bytesHashed,
              hashed_at: snap.hashes.hashedAt
            }
          : null,
        keyframes: snap.keyframes
          ? {
              keyframe_count: snap.keyframes.keyframeCount,
              keyframe_prefix: snap.keyframes.keyframePrefix,
              thumbnail_key: snap.keyframes.thumbnailKey,
              extracted_at: snap.keyframes.extractedAt
            }
          : null
      });
    }
  );
}
