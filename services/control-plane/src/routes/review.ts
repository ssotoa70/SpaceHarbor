import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const reviewUriResponseSchema = {
  type: "object",
  required: ["asset_id", "uri", "format"],
  properties: {
    asset_id: { type: "string" },
    uri: { type: "string" },
    format: {
      type: "string",
      enum: ["exr_sequence", "mov", "dpx_sequence", "mp4", "unknown"],
    },
  },
} as const;

function detectFormat(uri: string): string {
  if (uri.includes(".exr")) return "exr_sequence";
  if (uri.includes(".mov")) return "mov";
  if (uri.includes(".dpx")) return "dpx_sequence";
  if (uri.includes(".mp4")) return "mp4";
  return "unknown";
}

function buildRvlinkUri(sourceUri: string): { uri: string; format: string } {
  // Normalize vast:// and mock:// schemes to NFS-style path for RV
  const path = sourceUri.replace(/^(mock|vast):\/\//, "/vast/");
  const format = detectFormat(sourceUri);
  const uri = `rvlink://${path}`;
  return { uri, format };
}

export function registerReviewRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): void {
  for (const prefix of prefixes) {
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/review-uri"),
      {
        schema: {
          tags: ["review"],
          operationId: `${prefix.replace(/\W/g, "") || "root"}AssetsReviewUri`,
          summary: "Get OpenRV launch URI for an asset",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          response: {
            200: reviewUriResponseSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      (request, reply) => {
        const asset = persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", "Asset not found");
        }
        const sourceUri = asset.sourceUri;
        if (!sourceUri) {
          return sendError(request, reply, 404, "NOT_FOUND", "Asset has no reviewable URI");
        }
        const { uri, format } = buildRvlinkUri(sourceUri);
        return reply.status(200).send({ asset_id: request.params.id, uri, format });
      },
    );
  }
}
