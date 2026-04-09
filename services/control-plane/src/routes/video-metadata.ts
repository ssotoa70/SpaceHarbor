/**
 * Video metadata routes.
 *
 * Proxies requests to the vastdb-query Python sidecar, which queries the
 * video-metadata-extractor DataEngine function's output table via the vastdb
 * Python SDK. Mirrors the exr-metadata route shape — same proxy helper, same
 * response contract, different schema (env-configurable via VASTDB_VIDEO_SCHEMA
 * on the sidecar).
 *
 * The control-plane holds ZERO knowledge of VAST DB schemas or table names.
 * All schema/table routing lives in the sidecar, configured via env vars.
 * Never hardcode schema or table names here.
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { proxyToVastdbQuery } from "./exr-metadata.js";

export async function registerVideoMetadataRoutes(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    // --- GET /video-metadata/stats ---
    app.get(
      withPrefix(prefix, "/video-metadata/stats"),
      {
        schema: {
          tags: ["video-metadata"],
          operationId: `${opPrefix}VideoMetadataStats`,
          summary: "Get summary counts from video-metadata-extractor table",
          response: {
            200: { type: "object", additionalProperties: true },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const result = await proxyToVastdbQuery("/api/v1/video-metadata/stats");
        if (!result.ok) {
          return sendError(request, reply, result.status, "VIDEO_METADATA_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /video-metadata/files ---
    app.get<{
      Querystring: { pathPrefix?: string; limit?: number; offset?: number };
    }>(
      withPrefix(prefix, "/video-metadata/files"),
      {
        schema: {
          tags: ["video-metadata"],
          operationId: `${opPrefix}VideoMetadataFiles`,
          summary: "List video metadata rows with optional path-prefix filter",
          querystring: {
            type: "object",
            properties: {
              pathPrefix: { type: "string" },
              limit: { type: "number", minimum: 1, maximum: 500, default: 50 },
              offset: { type: "number", minimum: 0, default: 0 },
            },
          },
          response: {
            200: { type: "object", additionalProperties: true },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const params = new URLSearchParams();
        const q = request.query;
        if (q.pathPrefix) params.set("pathPrefix", q.pathPrefix);
        if (q.limit != null) params.set("limit", String(q.limit));
        if (q.offset != null) params.set("offset", String(q.offset));
        const result = await proxyToVastdbQuery(`/api/v1/video-metadata/files?${params}`);
        if (!result.ok) {
          return sendError(request, reply, result.status, "VIDEO_METADATA_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /video-metadata/files/:fileId ---
    app.get<{ Params: { fileId: string } }>(
      withPrefix(prefix, "/video-metadata/files/:fileId"),
      {
        schema: {
          tags: ["video-metadata"],
          operationId: `${opPrefix}VideoMetadataFileDetail`,
          summary: "Get full detail for one video file by id",
          response: {
            200: { type: "object", additionalProperties: true },
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { fileId } = request.params;
        const result = await proxyToVastdbQuery(
          `/api/v1/video-metadata/files/${encodeURIComponent(fileId)}`,
        );
        if (!result.ok) {
          return sendError(request, reply, result.status, "VIDEO_METADATA_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );

    // --- GET /video-metadata/lookup ---
    app.get<{ Querystring: { path: string } }>(
      withPrefix(prefix, "/video-metadata/lookup"),
      {
        schema: {
          tags: ["video-metadata"],
          operationId: `${opPrefix}VideoMetadataLookup`,
          summary: "Look up video metadata by file path",
          querystring: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" },
            },
          },
          response: {
            200: { type: "object", additionalProperties: true },
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { path } = request.query;
        const result = await proxyToVastdbQuery(
          `/api/v1/video-metadata/lookup?path=${encodeURIComponent(path)}`,
        );
        if (!result.ok) {
          return sendError(request, reply, result.status, "VIDEO_METADATA_QUERY_FAILED",
            (result.data as { detail?: string })?.detail ?? "Query failed");
        }
        return reply.send(result.data);
      },
    );
  }
}
