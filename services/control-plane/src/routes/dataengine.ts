/**
 * DataEngine routes — expose the function catalogue and configured pipelines.
 *
 * GET /api/v1/dataengine/functions            — list all registered functions
 * GET /api/v1/dataengine/functions/:id        — get a single function by id
 * GET /api/v1/dataengine/pipelines            — list configured pipelines
 * GET /api/v1/dataengine/pipelines/:id/runs   — list recent runs for a pipeline
 *
 * The FunctionRegistry is the single source of truth. No database is involved;
 * the registry is populated at startup in app.ts.
 */

import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import type { FunctionRegistry } from "../data-engine/registry.js";

export async function registerDataEngineRoutes(
  app: FastifyInstance,
  registry: FunctionRegistry,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // GET /dataengine/functions — list all functions in the catalogue
    app.get(
      withPrefix(prefix, "/dataengine/functions"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}ListDataEngineFunctions`,
          summary: "List all registered DataEngine functions",
          response: {
            200: {
              type: "object",
              required: ["functions"],
              properties: {
                functions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      description: { type: "string" },
                      category: { type: "string" },
                      language: { type: "string" },
                      trigger: { type: "string" },
                      inputs: { type: "array", items: { type: "string" } },
                      outputs: { type: "array", items: { type: "string" } },
                      status: { type: "string", enum: ["active", "inactive"] },
                      config: { type: "object", additionalProperties: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        return reply.send({ functions: registry.listFunctions() });
      },
    );

    // GET /dataengine/functions/:id — get a single function by id
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/dataengine/functions/:id"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}GetDataEngineFunction`,
          summary: "Get a DataEngine function by id",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          response: {
            200: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                category: { type: "string" },
                language: { type: "string" },
                trigger: { type: "string" },
                inputs: { type: "array", items: { type: "string" } },
                outputs: { type: "array", items: { type: "string" } },
                status: { type: "string", enum: ["active", "inactive"] },
                config: { type: "object", additionalProperties: { type: "string" } },
              },
            },
            404: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const fn = registry.getFunctionById(request.params.id);
        if (!fn) {
          return reply.status(404).send({ code: "NOT_FOUND", message: `Function '${request.params.id}' not found` });
        }
        return reply.send(fn);
      },
    );

    // GET /dataengine/pipelines — list configured pipelines
    // The EXR ingest pipeline is the canonical pipeline for VFX asset ingest.
    // Additional pipelines can be wired here as they are defined.
    app.get(
      withPrefix(prefix, "/dataengine/pipelines"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}ListDataEnginePipelines`,
          summary: "List configured DataEngine pipelines",
          response: {
            200: {
              type: "object",
              required: ["pipelines"],
              properties: {
                pipelines: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      description: { type: "string" },
                      status: { type: "string" },
                      triggerType: { type: "string" },
                      triggerPath: { type: "string" },
                      steps: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            functionId: { type: "string" },
                            name: { type: "string" },
                            description: { type: "string" },
                            status: { type: "string" },
                            params: { type: "object", additionalProperties: { type: "string" } },
                            order: { type: "number" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        // Pipelines reflect the chain config of the DataEnginePipeline orchestrator.
        // Steps are resolved from the registry to provide rich metadata.
        const allFuncs = registry.listFunctions();
        const resolveStep = (funcId: string, index: number) => {
          const meta = allFuncs.find((f) => f.id === funcId);
          return {
            id: `${funcId}-step`,
            functionId: funcId,
            name: meta?.name ?? funcId,
            description: meta?.description ?? "",
            status: "queued" as const,
            params: meta?.config ?? {},
            order: index + 1,
          };
        };

        const pipelineDefs = [
          { id: "exr-ingest", name: "EXR Ingest Pipeline", description: "Process EXR sequences: extract metadata then generate proxies", triggerType: "on:ingest", triggerPath: "vast://views/vfx/**/*.exr", stepIds: ["exr_inspector", "oiio_proxy_generator"] },
          { id: "video-ingest", name: "Video Ingest Pipeline", description: "Transcode video to review proxies with LUT and burn-in", triggerType: "on:ingest", triggerPath: "vast://views/vfx/**/*.{mov,mp4,mxf}", stepIds: ["ffmpeg_transcoder"] },
          { id: "editorial-conform", name: "Editorial Conform Pipeline", description: "Parse editorial timelines and conform against shot database", triggerType: "on:ingest", triggerPath: "vast://views/editorial/**/*.otio", stepIds: ["otio_parser", "timeline_conformer"] },
          { id: "material-ingest", name: "MaterialX Material Ingest Pipeline", description: "Parse MaterialX shader definitions and build dependency graphs", triggerType: "on:ingest", triggerPath: "vast://views/assets/**/*.mtlx", stepIds: ["mtlx_parser", "dependency_graph_builder"] },
          { id: "provenance-record", name: "Provenance Recording Pipeline", description: "Record creation provenance metadata for ingested assets", triggerType: "on:ingest", triggerPath: "vast://views/vfx/**/*", stepIds: ["provenance_recorder"] },
          { id: "storage-metrics", name: "Storage Metrics Collection", description: "Collect per-project storage metrics from S3 buckets", triggerType: "schedule", triggerPath: "cron: 0 */6 * * *", stepIds: ["storage_metrics_collector"] },
        ];

        const pipelines = pipelineDefs.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: "active" as const,
          triggerType: p.triggerType,
          triggerPath: p.triggerPath,
          steps: p.stepIds.map((sid, i) => resolveStep(sid, i)),
        }));

        return reply.send({ pipelines });
      },
    );

    // GET /dataengine/pipelines/:id/runs — recent execution history for a pipeline.
    //
    // TODO: When VAST DataEngine emits run-level CloudEvents, derive real run records
    // from the event store (jobs table + processed_events) and populate this endpoint.
    // For now it returns an empty array with the correct shape so callers don't 404.
    // The client (fetchDataEnginePipelineRuns in web-ui/src/api.ts) casts the response
    // to DataEnginePipelineStep[], so each item must match that interface.
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/dataengine/pipelines/:id/runs"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}GetDataEnginePipelineRuns`,
          summary: "List recent execution runs for a DataEngine pipeline",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
          response: {
            200: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  functionId: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  status: { type: "string", enum: ["done", "running", "queued", "error"] },
                  params: { type: "object", additionalProperties: { type: "string" } },
                  order: { type: "number" },
                },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        // No run records available yet — return empty array with correct shape.
        return reply.send([]);
      },
    );
  }
}
