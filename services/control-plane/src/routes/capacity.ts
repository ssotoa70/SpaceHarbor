import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { StorageTier } from "../domain/models.js";

export async function registerCapacityRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /projects/:id/storage-metrics — record storage metrics for a project
    app.post<{
      Params: { id: string };
      Body: {
        entityType: string;
        entityId: string;
        totalBytes: number;
        fileCount: number;
        proxyBytes?: number;
        thumbnailBytes?: number;
        storageTier?: StorageTier;
      };
    }>(
      withPrefix(prefix, "/projects/:id/storage-metrics"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}CreateStorageMetric`,
          summary: "Record storage metrics for a project entity",
          response: {
            201: {
              type: "object",
              required: ["metric"],
              properties: {
                metric: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    entityType: { type: "string" },
                    entityId: { type: "string" },
                    totalBytes: { type: "number" },
                    fileCount: { type: "number" },
                    proxyBytes: { type: "number" },
                    thumbnailBytes: { type: "number" },
                    storageTier: { type: "string" },
                    measuredAt: { type: "string" }
                  }
                }
              }
            },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const metric = await persistence.createStorageMetric(
          request.body,
          { correlationId: request.id }
        );
        return reply.status(201).send({ metric });
      }
    );

    // GET /projects/:id/storage-summary — per-project storage breakdown
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/projects/:id/storage-summary"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}GetProjectStorageSummary`,
          summary: "Get storage summary for a project",
          response: {
            200: {
              type: "object",
              required: ["metrics"],
              properties: {
                metrics: { type: "array", items: { type: "object" } }
              }
            }
          }
        }
      },
      async (request, reply) => {
        const metrics = await persistence.getStorageSummaryByProject(request.params.id);
        return reply.send({ metrics });
      }
    );

    // GET /versions/:id/storage-footprint — storage footprint for a version
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/versions/:id/storage-footprint"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}GetVersionStorageFootprint`,
          summary: "Get storage footprint for a specific version",
          response: {
            200: {
              type: "object",
              required: ["metric"],
              properties: {
                metric: { type: "object", nullable: true }
              }
            }
          }
        }
      },
      async (request, reply) => {
        const metric = await persistence.getLatestStorageMetric("version", request.params.id);
        return reply.send({ metric });
      }
    );

    // GET /shots/:id/render-metrics — render farm metrics for a shot
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/shots/:id/render-metrics"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}GetShotRenderMetrics`,
          summary: "Get render farm metrics for a shot",
          response: {
            200: {
              type: "object",
              required: ["metrics"],
              properties: {
                metrics: { type: "array", items: { type: "object" } }
              }
            }
          }
        }
      },
      async (request, reply) => {
        const metrics = await persistence.getRenderMetricsByShot(request.params.id);
        return reply.send({ metrics });
      }
    );

    // GET /projects/:id/capacity-forecast — capacity forecast for a project
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/projects/:id/capacity-forecast"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}GetCapacityForecast`,
          summary: "Get capacity forecast for a project",
          response: {
            200: {
              type: "object",
              required: ["forecast"],
              properties: {
                forecast: { type: "object" }
              }
            }
          }
        }
      },
      async (request, reply) => {
        const storageMetrics = await persistence.getStorageSummaryByProject(request.params.id);
        const renderMetrics = await persistence.getRenderMetricsByProject(request.params.id);

        const totalStorageBytes = storageMetrics.reduce((sum, m) => sum + m.totalBytes, 0);
        const totalFiles = storageMetrics.reduce((sum, m) => sum + m.fileCount, 0);
        const totalCoreHours = renderMetrics.reduce((sum, m) => sum + (m.coreHours ?? 0), 0);
        const avgRenderTime = renderMetrics.length > 0
          ? renderMetrics.reduce((sum, m) => sum + (m.renderTimeSeconds ?? 0), 0) / renderMetrics.length
          : 0;

        return reply.send({
          forecast: {
            projectId: request.params.id,
            currentStorageBytes: totalStorageBytes,
            currentFileCount: totalFiles,
            totalCoreHours,
            avgRenderTimeSeconds: avgRenderTime,
            renderJobCount: renderMetrics.length,
            measuredAt: new Date().toISOString()
          }
        });
      }
    );

    // GET /reports/render-cost — render cost report with groupBy
    app.get<{
      Querystring: {
        groupBy?: "department" | "sequence" | "show";
        from?: string;
        to?: string;
        projectId?: string;
      };
    }>(
      withPrefix(prefix, "/reports/render-cost"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}GetRenderCostReport`,
          summary: "Get render cost report grouped by department, sequence, or show",
          querystring: {
            type: "object",
            properties: {
              groupBy: { type: "string", enum: ["department", "sequence", "show"], default: "department" },
              from: { type: "string", format: "date-time" },
              to: { type: "string", format: "date-time" },
              projectId: { type: "string" }
            }
          },
          response: {
            200: {
              type: "object",
              required: ["report"],
              properties: {
                report: { type: "object" }
              }
            }
          }
        }
      },
      async (request, reply) => {
        const { projectId, from, to, groupBy = "department" } = request.query;
        if (!projectId) {
          return reply.status(400).send({
            code: "BAD_REQUEST",
            message: "projectId query parameter is required",
            requestId: request.id,
            details: null
          });
        }

        const metrics = await persistence.getRenderMetricsByProject(projectId, from, to);

        // Group metrics by the selected dimension
        const groups = new Map<string, { coreHours: number; renderTimeSeconds: number; jobCount: number; frameCount: number }>();
        for (const m of metrics) {
          const key = groupBy === "department"
            ? (m.renderEngine ?? "unknown")
            : groupBy === "sequence"
              ? (m.shotId ?? "unassigned")
              : projectId;

          const existing = groups.get(key) ?? { coreHours: 0, renderTimeSeconds: 0, jobCount: 0, frameCount: 0 };
          existing.coreHours += m.coreHours ?? 0;
          existing.renderTimeSeconds += m.renderTimeSeconds ?? 0;
          existing.jobCount += 1;
          existing.frameCount += m.frameCount ?? 0;
          groups.set(key, existing);
        }

        const breakdown = Array.from(groups.entries()).map(([key, data]) => ({
          group: key,
          ...data,
        }));

        return reply.send({
          report: {
            projectId,
            groupBy,
            from: from ?? null,
            to: to ?? null,
            totalJobs: metrics.length,
            totalCoreHours: metrics.reduce((sum, m) => sum + (m.coreHours ?? 0), 0),
            breakdown,
          }
        });
      }
    );

    // POST /render-metrics — record render farm metrics
    app.post<{
      Body: {
        projectId: string;
        shotId?: string;
        versionId?: string;
        renderEngine?: string;
        renderTimeSeconds?: number;
        coreHours?: number;
        peakMemoryGb?: number;
        frameCount?: number;
        submittedAt?: string;
      };
    }>(
      withPrefix(prefix, "/render-metrics"),
      {
        schema: {
          tags: ["capacity"],
          operationId: `${opPrefix}CreateRenderFarmMetric`,
          summary: "Record render farm metrics",
          response: {
            201: {
              type: "object",
              required: ["metric"],
              properties: {
                metric: { type: "object" }
              }
            },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const metric = await persistence.createRenderFarmMetric(
          request.body,
          { correlationId: request.id }
        );
        return reply.status(201).send({ metric });
      }
    );
  }
}
