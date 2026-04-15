/**
 * DataEngine pipelines route — live view of configured + discovered
 * metadata extraction pipelines.
 *
 *   GET /api/v1/dataengine/pipelines/active
 *     → { pipelines: DiscoveredPipeline[] }
 *
 * This is the authoritative source for "what DataEngine functions does
 * SpaceHarbor know about right now". It replaces the stale hardcoded
 * `/dataengine/functions` list with a live merge of:
 *   - Admin-controlled Settings (function name + extensions + schema/table)
 *   - Live VAST DataEngine function record (guid, description, owner, dates)
 *
 * Caching + cache invalidation live in the PipelineDiscoveryService.
 * The HTTP route is a thin adapter that shapes the response and catches
 * errors into the standard error envelope.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { PipelineDiscoveryService, type DiscoveredPipeline } from "../data-engine/discovery.js";
import { createVastFunctionFetcher, type VastFetcherContext } from "../data-engine/vast-function-fetcher.js";
import { VmsTokenManager } from "../vast/vms-token-manager.js";

import {
  getDataEnginePipelines,
  getVastDataEngineUrl,
  getVastDataEngineCredentials,
  getVastDataEngineTenant,
} from "./platform-settings.js";

/**
 * Module-level singleton — built lazily on first request. The discovery
 * cache persists across requests, the VMS token manager is reused, and
 * the context provider re-reads Settings on every lookup so admin
 * changes are picked up without a restart.
 *
 * Reset via `resetDataEnginePipelineDiscovery()` when Settings that
 * affect VAST routing change (e.g. URL or credentials).
 */
let discoveryService: PipelineDiscoveryService | null = null;
let tokenManager: VmsTokenManager | null = null;
let tokenManagerKey: string | null = null;

function buildOrGetDiscoveryService(): PipelineDiscoveryService {
  if (discoveryService) return discoveryService;

  const contextProvider = (): VastFetcherContext | null => {
    const vastUrl = getVastDataEngineUrl();
    const creds = getVastDataEngineCredentials();
    if (!vastUrl || !creds) return null;

    // Rebuild the token manager when URL or credentials change — keyed
    // on a composite identity so a settings update invalidates the old
    // token cache automatically.
    const key = `${vastUrl}|${creds.username}`;
    if (!tokenManager || tokenManagerKey !== key) {
      tokenManager = new VmsTokenManager(vastUrl, creds);
      tokenManagerKey = key;
    }

    return {
      vastBaseUrl: vastUrl,
      tenant: getVastDataEngineTenant(),
      tokenManager,
    };
  };

  const fetcher = createVastFunctionFetcher(contextProvider);
  discoveryService = new PipelineDiscoveryService(
    () => getDataEnginePipelines(),
    fetcher,
  );
  return discoveryService;
}

/**
 * Drop the discovery cache. Call this from the Settings update handler
 * when `dataEnginePipelines` or VAST DataEngine connection fields change
 * so the next request reflects fresh data.
 */
export function invalidateDataEnginePipelineCache(): void {
  discoveryService?.invalidate();
}

const pipelinesActiveResponseSchema = {
  type: "object",
  required: ["pipelines"],
  properties: {
    pipelines: {
      type: "array",
      items: {
        type: "object",
        required: ["config", "status"],
        properties: {
          config: {
            type: "object",
            required: ["fileKind", "functionName", "extensions", "targetSchema", "targetTable", "sidecarSchemaId"],
            properties: {
              fileKind: { type: "string", enum: ["image", "video", "raw_camera"] },
              functionName: { type: "string" },
              extensions: { type: "array", items: { type: "string" } },
              targetSchema: { type: "string" },
              targetTable: { type: "string" },
              sidecarSchemaId: { type: "string" },
              displayLabel: { type: "string" },
            },
          },
          live: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  guid: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  owner: {
                    anyOf: [
                      { type: "null" },
                      { type: "object", additionalProperties: true },
                    ],
                  },
                  createdAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                  updatedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                  vrn: { anyOf: [{ type: "string" }, { type: "null" }] },
                  lastRevisionNumber: { anyOf: [{ type: "number" }, { type: "null" }] },
                },
              },
            ],
          },
          status: { type: "string", enum: ["ok", "function-not-found", "vast-unreachable"] },
          statusDetail: { type: "string" },
        },
      },
    },
  },
} as const;

export async function registerDataEnginePipelineRoutes(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    app.get<{ Querystring: { force?: string } }>(
      withPrefix(prefix, "/dataengine/pipelines/active"),
      {
        schema: {
          tags: ["dataengine"],
          operationId: `${opPrefix}GetActiveDataEnginePipelines`,
          summary: "List configured DataEngine metadata pipelines merged with live VAST function records",
          querystring: {
            type: "object",
            properties: {
              force: { type: "string", description: "Pass 'true' to bypass the 60s cache" },
            },
          },
          response: {
            200: pipelinesActiveResponseSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const force = request.query.force === "true";
        try {
          const svc = buildOrGetDiscoveryService();
          const results = await svc.discover({ force });
          return reply.send({ pipelines: serializeResults(results) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return sendError(request, reply, 503, "DISCOVERY_FAILED", msg);
        }
      },
    );
  }
}

/**
 * Convert the in-memory DiscoveredPipeline shape into the JSON response
 * shape. Strips fields we don't want exposed (none today, but isolated
 * here so a future filter is a one-place change).
 */
function serializeResults(results: readonly DiscoveredPipeline[]): DiscoveredPipeline[] {
  return results.map((r) => ({
    config: r.config,
    live: r.live,
    status: r.status,
    ...(r.statusDetail ? { statusDetail: r.statusDetail } : {}),
  }));
}
