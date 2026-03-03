import type { FastifyInstance } from "fastify";

import { resolveCorrelationId } from "../http/correlation.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerAssetsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(withPrefix(prefix, "/assets"), async () => ({
      assets: persistence.listAssetQueueRows()
    }));

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id"),
      async (request, reply) => {
        const asset = persistence.getAssetById(request.params.id);
        if (!asset) {
          return reply.status(404).send({
            code: "NOT_FOUND",
            message: `asset not found: ${request.params.id}`,
            requestId: request.id,
            details: null
          });
        }
        return { asset };
      }
    );

    app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
      withPrefix(prefix, "/assets/:id"),
      async (request, reply) => {
        const correlationId = resolveCorrelationId(request);
        const body = request.body ?? {};
        const updates: Record<string, unknown> = {};

        if ("metadata" in body) updates.metadata = body.metadata;
        if ("version" in body) updates.version = body.version;
        if ("integrity" in body) updates.integrity = body.integrity;

        const asset = persistence.updateAsset(
          request.params.id,
          updates as Parameters<PersistenceAdapter["updateAsset"]>[1],
          { correlationId }
        );

        if (!asset) {
          return reply.status(404).send({
            code: "NOT_FOUND",
            message: `asset not found: ${request.params.id}`,
            requestId: request.id,
            details: null
          });
        }
        return { asset };
      }
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/:id/versions"),
      async (request, reply) => {
        const asset = persistence.getAssetById(request.params.id);
        if (!asset) {
          return reply.status(404).send({
            code: "NOT_FOUND",
            message: `asset not found: ${request.params.id}`,
            requestId: request.id,
            details: null
          });
        }

        // Scaffold: returns the current version info for this asset.
        // Full version chain traversal (walking parent_version_id) is deferred.
        const versions = asset.version ? [asset.version] : [];
        return { asset_id: asset.id, versions };
      }
    );
  }
}
