import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types";

export async function registerHealthRoute(
  app: FastifyInstance,
  persistence?: PersistenceAdapter
): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "control-plane",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async (request, reply) => {
    // Check if persistence is accessible
    if (!persistence) {
      return reply.status(503).send({
        status: "not_ready",
        database: "not_configured",
      });
    }

    try {
      // Quick connectivity check - try to get stats
      const stats = persistence.getWorkflowStats();
      return reply.status(200).send({
        status: "ready",
        database: "connected",
        stats: {
          assets: stats.assets.total,
          jobs: stats.jobs.total,
        },
      });
    } catch (e) {
      return reply.status(503).send({
        status: "not_ready",
        database: "disconnected",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
