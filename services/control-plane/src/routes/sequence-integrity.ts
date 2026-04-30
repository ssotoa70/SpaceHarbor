/**
 * POST /api/v1/assets/:id/sequence-integrity — placeholder.
 *
 * Real implementation requires a separate sequence-scanner job that walks
 * every frame_number under an asset's source path, detects gaps, and
 * stores xxh3 + SHA256 hashes per frame. Per the media-pipeline + workflow
 * agent reviews:
 *
 *   - Gap detection priority: missing frames in [start, end]; first-frame
 *     mismatch (1001 vs 1000); mid-sequence resolution / bit-depth /
 *     compression change; duplicate frame numbers from partial re-renders.
 *   - Hash strategy: store BOTH xxh3 (fast verify, 2026 VFX-pipeline
 *     standard) AND SHA256 (compliance / chain-of-custody).
 *   - "Validated" UI control should expose timestamp, tool version, link
 *     to the validation log, and a re-validate button.
 *
 * Until the scanner ships, this endpoint short-circuits with 503
 * NOT_IMPLEMENTED — same shape as the function-configs route from
 * Phase 6.0. The UI's <FrameSequenceIntegrity> component recognizes the
 * 503 and renders a "backend scanner not yet implemented" badge instead
 * of fabricating a result.
 */

import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";

export function registerSequenceIntegrityRoute(
  app: FastifyInstance,
  prefixes: string[],
): void {
  // v1-only — no legacy unversioned alias.
  const v1 = prefixes.find((p) => p === "/api/v1") ?? "/api/v1";

  app.post<{ Params: { id: string } }>(
    withPrefix(v1, "/assets/:id/sequence-integrity"),
    {
      schema: {
        tags: ["assets"],
        operationId: "runAssetSequenceIntegrity",
        summary: "Run frame-sequence integrity check for an asset (placeholder).",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.-]+$" },
          },
        },
      },
    },
    async (request, reply) => {
      return sendError(
        request,
        reply,
        503,
        "NOT_IMPLEMENTED",
        "Sequence integrity scanner not yet implemented. Will store xxh3 + SHA256 per frame, detect gaps, and surface mid-sequence drift.",
      );
    },
  );
}
