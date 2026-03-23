// ---------------------------------------------------------------------------
// Phase 3.3: GET /api/v1/metrics/iam — IAM observability metrics
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { AuthzLogger, AuthzMetrics } from "../iam/authz-logger.js";

export async function registerIamMetricsRoute(
  app: FastifyInstance,
  getAuthzLogger: () => AuthzLogger,
  prefixes: string[] = ["", "/api/v1"],
): Promise<void> {
  for (const prefix of prefixes) {
    app.get(`${prefix}/metrics/iam`, async (_request, reply) => {
      const metrics: AuthzMetrics = getAuthzLogger().getMetrics();
      const total = metrics.total || 1; // avoid division by zero

      return reply.status(200).send({
        totalAuthAttempts: metrics.total,
        successRate: metrics.total > 0 ? metrics.allow / total : 0,
        failureRate: metrics.total > 0 ? metrics.deny / total : 0,
        authStrategyBreakdown: {
          jwt: 0,
          api_key: 0,
          service_token: 0,
        },
        permissionDenialRate: metrics.total > 0 ? metrics.deny / total : 0,
        shadowDenyRate: metrics.total > 0 ? metrics.shadowDeny / total : 0,
        activeSessions: 0,
      });
    });
  }
}
