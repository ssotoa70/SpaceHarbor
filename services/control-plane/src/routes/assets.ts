import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { assetsResponseSchema, assetDetailResponseSchema, errorEnvelopeSchema } from "../http/schemas.js";
import type { WorkflowStatus } from "../domain/models.js";
import type { PersistenceAdapter } from "../persistence/types.js";

interface AssetsQuerystring {
  limit?: string;
  offset?: string;
  status?: string;
  q?: string;
}

const VALID_STATUSES = new Set<string>([
  "pending", "processing", "completed", "failed", "needs_replay",
  "qc_pending", "qc_in_review", "qc_approved", "qc_rejected",
  "revision_required", "retake", "client_submitted", "client_approved", "client_rejected"
]);

export async function registerAssetsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /assets/:id — single asset detail
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1GetAsset" : "legacyGetAsset",
          summary: "Get a single asset by ID",
          response: {
            200: assetDetailResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${request.params.id}`);
        }
        return asset;
      }
    );

    // GET /assets/:id/versions — version history for an asset
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/versions"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1GetAssetVersions" : "legacyGetAssetVersions",
          summary: "Get version history for an asset",
          response: {
            200: {
              type: "object",
              required: ["versions"],
              properties: {
                versions: { type: "array", items: { type: "object", additionalProperties: true } }
              }
            },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${request.params.id}`);
        }
        // Versions are linked via the shot in the VFX hierarchy
        if (!asset.shotId) {
          return { versions: [] };
        }
        const versions = await persistence.listVersionsByShot(asset.shotId);
        return { versions };
      }
    );

    // GET /assets/:id/pipeline-status — which DataEngine functions have completed for this asset
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/pipeline-status"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1GetAssetPipelineStatus" : "legacyGetAssetPipelineStatus",
          summary: "Get DataEngine pipeline processing status for an asset",
          response: {
            200: {
              type: "object",
              required: ["assetId", "functions"],
              properties: {
                assetId: { type: "string" },
                functions: {
                  type: "object",
                  properties: {
                    exr_inspector: { type: "object", properties: { completed: { type: "boolean" }, hasMetadata: { type: "boolean" } } },
                    oiio_proxy_generator: { type: "object", properties: { completed: { type: "boolean" }, hasThumbnail: { type: "boolean" }, hasProxy: { type: "boolean" } } },
                    otio_parser: { type: "object", properties: { completed: { type: "boolean" }, timelineCount: { type: "integer" } } },
                    mtlx_parser: { type: "object", properties: { completed: { type: "boolean" } } }
                  }
                }
              }
            },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const asset = await persistence.getAssetById(request.params.id);
        if (!asset) {
          return sendError(request, reply, 404, "NOT_FOUND", `Asset not found: ${request.params.id}`);
        }
        const meta = asset.metadata ?? {};
        const hasExrMeta = !!(meta.codec || meta.resolution || meta.color_space || meta.compression_type);
        const hasThumbnail = !!meta.thumbnail_url;
        const hasProxy = !!meta.proxy_url;

        // Check if timelines exist for this asset's project
        let timelineCount = 0;
        if (asset.projectId) {
          const timelines = await persistence.listTimelinesByProject(asset.projectId);
          timelineCount = timelines.length;
        }

        return {
          assetId: asset.id,
          functions: {
            exr_inspector: { completed: hasExrMeta, hasMetadata: hasExrMeta },
            oiio_proxy_generator: { completed: hasThumbnail || hasProxy, hasThumbnail, hasProxy },
            otio_parser: { completed: timelineCount > 0, timelineCount },
            mtlx_parser: { completed: false }
          }
        };
      }
    );

    // GET /assets — list assets
    app.get<{ Querystring: AssetsQuerystring }>(
      withPrefix(prefix, "/assets"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1ListAssets" : "legacyListAssets",
          summary: "List assets and workflow queue status",
          querystring: {
            type: "object",
            properties: {
              limit: { type: "string", description: "Maximum number of results to return (1–200, default 50)" },
              offset: { type: "string", description: "Number of results to skip for pagination (default 0)" },
              status: { type: "string", description: "Filter by workflow status (e.g. pending, qc_pending, qc_approved)" },
              q: { type: "string", description: "Full-text search query matched against title and sourceUri" }
            }
          },
          response: {
            200: assetsResponseSchema
          }
        }
      },
      async (request) => {
        const limit = Math.min(Math.max(parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
        const offset = Math.max(parseInt(request.query.offset ?? "0", 10) || 0, 0);
        const statusFilter = request.query.status;
        const searchQuery = request.query.q?.toLowerCase();

        let rows = await persistence.listAssetQueueRows();

        if (statusFilter && VALID_STATUSES.has(statusFilter)) {
          rows = rows.filter((r) => r.status === statusFilter as WorkflowStatus);
        }

        if (searchQuery) {
          rows = rows.filter(
            (r) =>
              r.title.toLowerCase().includes(searchQuery) ||
              r.sourceUri.toLowerCase().includes(searchQuery)
          );
        }

        const total = rows.length;
        const paginated = rows.slice(offset, offset + limit);

        return {
          assets: paginated,
          pagination: { total, limit, offset }
        };
      }
    );
  }
}
