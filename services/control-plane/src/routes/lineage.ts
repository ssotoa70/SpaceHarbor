import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  assetLineageDAGResponseSchema,
  errorEnvelopeSchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { LineageRelationshipType } from "../domain/models.js";

/**
 * Infer the change type between two versions based on metadata differences.
 */
function inferChangeType(
  parent: { colorSpace: string | null; compressionType: string | null; frameRangeStart: number | null; frameRangeEnd: number | null },
  child: { colorSpace: string | null; compressionType: string | null; frameRangeStart: number | null; frameRangeEnd: number | null }
): string {
  if (parent.colorSpace && child.colorSpace && parent.colorSpace !== child.colorSpace) {
    return "color_space_change";
  }
  if (parent.compressionType && child.compressionType && parent.compressionType !== child.compressionType) {
    return "compression_change";
  }
  if (parent.frameRangeStart != null && child.frameRangeStart != null &&
      parent.frameRangeEnd != null && child.frameRangeEnd != null &&
      (parent.frameRangeStart !== child.frameRangeStart || parent.frameRangeEnd !== child.frameRangeEnd)) {
    return "new_frames";
  }
  return "full_re_render";
}

/**
 * Map lineage relationship type to edge type (derives vs depends).
 */
function toEdgeType(relationship: LineageRelationshipType): string {
  if (relationship === "referenced_by") return "depends";
  return "derives";
}

export async function registerLineageRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // GET /assets/:id/lineage — return lineage DAG for an asset
    app.get<{
      Params: { id: string };
    }>(
      withPrefix(prefix, "/assets/:id/lineage"),
      {
        schema: {
          tags: ["lineage"],
          operationId: `${opPrefix}GetAssetLineage`,
          summary: "Get version lineage DAG for an asset",
          response: {
            200: assetLineageDAGResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { id } = request.params;

        // Look up asset to find associated shot
        const asset = await persistence.getAssetById(id);
        if (!asset) {
          return reply.status(404).send({
            code: "NOT_FOUND",
            message: `asset ${id} not found`,
            requestId: request.id,
            details: null
          });
        }

        // If asset has a shotId, get all versions for that shot to build DAG
        const shotId = asset.shotId;
        if (!shotId) {
          // No shot association — return minimal single-node DAG
          return reply.send({
            nodes: [{
              id: asset.id,
              versionLabel: asset.version?.version_label ?? "v1",
              status: "draft",
              createdAt: asset.createdAt,
              createdBy: "unknown",
              branchLabel: null,
              colorSpace: asset.metadata?.color_space ?? null,
              compressionType: asset.metadata?.compression_type ?? null,
              frameRangeStart: asset.metadata?.frame_range?.start ?? null,
              frameRangeEnd: asset.metadata?.frame_range?.end ?? null
            }],
            edges: []
          });
        }

        // Get all versions for this shot
        const versions = await persistence.listVersionsByShot(shotId);

        // Build node list
        const nodes = versions.map(v => ({
          id: v.id,
          versionLabel: v.versionLabel,
          status: v.status,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
          branchLabel: null as string | null,
          colorSpace: v.colorSpace,
          compressionType: v.compressionType,
          frameRangeStart: v.frameRangeStart,
          frameRangeEnd: v.frameRangeEnd
        }));

        // Get version lineage tree to build edges
        const lineageEdges = await persistence.getVersionTree(shotId);
        const versionMap = new Map(versions.map(v => [v.id, v]));

        const edges = lineageEdges.map(edge => {
          const ancestor = versionMap.get(edge.ancestorVersionId);
          const descendant = versionMap.get(edge.descendantVersionId);

          let changeType = "full_re_render";
          if (ancestor && descendant) {
            changeType = inferChangeType(ancestor, descendant);
          }

          // Map "retake_of" to "alternate_take" change type
          if (edge.relationshipType === "retake_of") {
            changeType = "alternate_take";
          }

          return {
            sourceId: edge.ancestorVersionId,
            targetId: edge.descendantVersionId,
            changeType,
            edgeType: toEdgeType(edge.relationshipType)
          };
        });

        // For versions with parentVersionId but no lineage edges, create implicit edges
        for (const v of versions) {
          if (v.parentVersionId && !edges.some(e => e.sourceId === v.parentVersionId && e.targetId === v.id)) {
            const parent = versionMap.get(v.parentVersionId);
            let changeType = "full_re_render";
            if (parent) {
              changeType = inferChangeType(parent, v);
            }
            edges.push({
              sourceId: v.parentVersionId,
              targetId: v.id,
              changeType,
              edgeType: "derives"
            });
          }
        }

        return reply.send({ nodes, edges });
      }
    );
  }
}
