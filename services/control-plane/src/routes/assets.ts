import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import { assetsResponseSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerAssetsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(
      withPrefix(prefix, "/assets"),
      {
        schema: {
          tags: ["assets"],
          operationId: prefix === "/api/v1" ? "v1ListAssets" : "legacyListAssets",
          summary: "List assets and workflow queue status",
          response: {
            200: assetsResponseSchema
          }
        }
      },
      async () => ({
        assets: persistence.listAssetQueueRows()
      })
    );
  }
}
