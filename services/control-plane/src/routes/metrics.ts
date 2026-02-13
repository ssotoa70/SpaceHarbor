import type { FastifyInstance } from "fastify";

import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerMetricsRoute(app: FastifyInstance, persistence: PersistenceAdapter): Promise<void> {
  app.get("/api/v1/metrics", async () => persistence.getWorkflowStats());
}
