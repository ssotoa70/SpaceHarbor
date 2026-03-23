import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { IamFeatureFlags } from "../iam/feature-flags.js";

// ---------------------------------------------------------------------------
// IAM health check types
// ---------------------------------------------------------------------------

export interface IamHealthStatus {
  status: "ok" | "warning" | "degraded";
  jwksConfigured: boolean;
  featureFlagsConsistent: boolean;
  persistenceType: "persistent" | "in-memory" | "unknown";
  warnings: string[];
}

export interface HealthOptions {
  iamFlags?: IamFeatureFlags;
  roleBindingType?: "persistent" | "in-memory";
}

function checkIamHealth(opts: HealthOptions): IamHealthStatus {
  const warnings: string[] = [];
  const flags = opts.iamFlags;

  const jwksConfigured = !!process.env.SPACEHARBOR_OIDC_JWKS_URI?.trim();

  // Check feature flag consistency
  let featureFlagsConsistent = true;
  if (flags) {
    if (flags.iamEnabled && !flags.shadowMode) {
      // Enforcement without shadow mode is a warning (normal in later rollout rings)
    }
    if (
      (flags.enforceReadScope || flags.enforceWriteScope || flags.enforceApprovalSod) &&
      !flags.iamEnabled
    ) {
      featureFlagsConsistent = false;
      warnings.push("enforcement flags set but IAM is disabled");
    }
  }

  const persistenceType = opts.roleBindingType ?? "unknown";
  if (flags?.iamEnabled && persistenceType === "in-memory") {
    warnings.push("IAM enabled but using in-memory role binding (not persistent)");
  }

  const status: IamHealthStatus["status"] =
    warnings.length > 0 ? "warning" : "ok";

  return {
    status,
    jwksConfigured,
    featureFlagsConsistent,
    persistenceType,
    warnings,
  };
}

export async function registerHealthRoute(
  app: FastifyInstance,
  persistence?: PersistenceAdapter,
  healthOpts?: HealthOptions,
): Promise<void> {
  app.get("/health", {
    schema: {
      tags: ["platform"],
      operationId: "getHealth",
      summary: "Service health check",
      security: [],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            service: { type: "string" },
            uptime: { type: "number" },
            timestamp: { type: "string" },
            iam: {
              type: "object",
              properties: {
                status: { type: "string" },
                jwksConfigured: { type: "boolean" },
                featureFlagsConsistent: { type: "boolean" },
                persistenceType: { type: "string" },
                warnings: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const result: Record<string, unknown> = {
      status: "ok",
      service: "control-plane",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    // Phase 3.3: IAM subsystem health
    if (healthOpts) {
      result.iam = checkIamHealth(healthOpts);
    }

    return result;
  });

  app.get("/health/ready", {
    schema: {
      tags: ["platform"],
      operationId: "getHealthReady",
      summary: "Readiness probe — checks persistence connectivity",
      security: [],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            database: { type: "string" },
            stats: {
              type: "object",
              properties: {
                assets: { type: "number" },
                jobs: { type: "number" },
              },
            },
            iam: {
              type: "object",
              properties: {
                status: { type: "string" },
                jwksConfigured: { type: "boolean" },
                featureFlagsConsistent: { type: "boolean" },
                persistenceType: { type: "string" },
                warnings: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        503: {
          type: "object",
          properties: {
            status: { type: "string" },
            database: { type: "string" },
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Check if persistence is accessible
    if (!persistence) {
      return reply.status(503).send({
        status: "not_ready",
        database: "not_configured",
      });
    }

    try {
      // Quick connectivity check - try to get stats
      const stats = await persistence.getWorkflowStats();
      const result: Record<string, unknown> = {
        status: "ready",
        database: "connected",
        stats: {
          assets: stats.assets.total,
          jobs: stats.jobs.total,
        },
      };

      // Phase 3.3: IAM subsystem health
      if (healthOpts) {
        result.iam = checkIamHealth(healthOpts);
      }

      return reply.status(200).send(result);
    } catch (e) {
      return reply.status(503).send({
        status: "not_ready",
        database: "disconnected",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
