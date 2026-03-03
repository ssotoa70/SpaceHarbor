import type { FastifyInstance } from "fastify";

import { assetQueueRowSchema } from "../http/schemas.js";
import { withPrefix } from "../http/routes.js";
import type { PersistenceAdapter } from "../persistence/types.js";

const assetQueueResponseSchema = {
  type: "object",
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      items: assetQueueRowSchema
    }
  }
} as const;

export async function registerAssetsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(withPrefix(prefix, "/assets"), {
      schema: {
        tags: ["assets"],
        operationId: prefix === "/api/v1" ? "v1ListAssets" : "legacyListAssets",
        summary: "List asset queue rows",
        response: {
          200: assetQueueResponseSchema
        }
      }
    }, async () => ({
      assets: persistence.listAssetQueueRows()
    }));
  }
}
