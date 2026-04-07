/**
 * EXR metadata routes.
 *
 * Proxies requests to the vastdb-query service, which queries VAST Database
 * tables created by exr-inspector using the vastdb Python SDK directly.
 * This avoids Trino connector compatibility issues with vector columns
 * and sorted-table metadata.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { vastFetch } from "../vast/vast-fetch.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getVastdbQueryUrl(): string {
  return process.env.VASTDB_QUERY_URL ?? "http://vastdb-query:8070";
}

/** Proxy a request to the vastdb-query service. */
async function proxyToVastdbQuery(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${getVastdbQueryUrl()}${path}`;
  try {
    const response = await vastFetch(url, {
      headers: { "Accept": "application/json" },
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      data: { detail: err instanceof Error ? err.message : "vastdb-query service unreachable" },
    };
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerExrMetadataRoutes(
  app: FastifyInstance,
  _trino: unknown,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {

    // --- GET /exr-metadata/stats ---
    app.get(
      withPrefix(prefix, "/exr-metadata/stats"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataStats" : "legacyExrMetadataStats",
          summary: "Get summary statistics from exr-inspector tables",
          response: { 200: { type: "object", additionalProperties: true }, 503: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const result = await proxyToVastdbQuery("/api/v1/exr-metadata/stats");
        if (!result.ok) {
          return sendError(request, reply, result.status, "EXR_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /exr-metadata/files ---
    app.get<{ Querystring: { pathPrefix?: string; limit?: number; offset?: number } }>(
      withPrefix(prefix, "/exr-metadata/files"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataFiles" : "legacyExrMetadataFiles",
          summary: "List EXR files with metadata",
          querystring: {
            type: "object",
            properties: {
              pathPrefix: { type: "string" },
              limit: { type: "number", minimum: 1, maximum: 500, default: 50 },
              offset: { type: "number", minimum: 0, default: 0 },
            },
          },
          response: { 200: { type: "object", additionalProperties: true }, 503: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const { pathPrefix, limit = 50, offset = 0 } = request.query;
        const params = new URLSearchParams();
        if (pathPrefix) params.set("pathPrefix", pathPrefix);
        params.set("limit", String(limit));
        params.set("offset", String(offset));

        const result = await proxyToVastdbQuery(`/api/v1/exr-metadata/files?${params}`);
        if (!result.ok) {
          return sendError(request, reply, result.status, "EXR_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /exr-metadata/files/:fileId ---
    app.get<{ Params: { fileId: string } }>(
      withPrefix(prefix, "/exr-metadata/files/:fileId"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataFileDetail" : "legacyExrMetadataFileDetail",
          summary: "Get detailed EXR metadata: file info, parts, channels, and attributes",
          response: {
            200: { type: "object", additionalProperties: true },
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { fileId } = request.params;
        const result = await proxyToVastdbQuery(`/api/v1/exr-metadata/files/${encodeURIComponent(fileId)}`);
        if (!result.ok) {
          const code = result.status === 404 ? "NOT_FOUND" : "EXR_QUERY_FAILED";
          return sendError(request, reply, result.status, code,
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /exr-metadata/lookup ---
    app.get<{ Querystring: { path: string } }>(
      withPrefix(prefix, "/exr-metadata/lookup"),
      {
        schema: {
          tags: ["exr-metadata"],
          operationId: prefix === "/api/v1" ? "v1ExrMetadataLookup" : "legacyExrMetadataLookup",
          summary: "Look up EXR metadata by file path (correlate with SpaceHarbor assets)",
          querystring: {
            type: "object",
            required: ["path"],
            properties: { path: { type: "string" } },
          },
          response: { 200: { type: "object", additionalProperties: true }, 503: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const { path } = request.query;
        const result = await proxyToVastdbQuery(`/api/v1/exr-metadata/lookup?path=${encodeURIComponent(path)}`);
        if (!result.ok) {
          return sendError(request, reply, result.status, "EXR_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );
  }
}
