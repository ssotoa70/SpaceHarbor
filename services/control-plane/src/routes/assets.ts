import type { FastifyInstance } from "fastify";

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
  }
}
