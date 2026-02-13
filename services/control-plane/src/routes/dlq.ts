import type { FastifyInstance } from "fastify";

import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerDlqRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/dlq", async () => ({
    items: persistence.getDlqItems()
  }));
}
