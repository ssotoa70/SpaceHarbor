/**
 * Storage metadata route — single-file sidecar reader.
 *
 *   GET /storage/metadata?sourceUri=s3://bucket/path/shot.mov
 *
 * This is the "single-file detail view" data path from the
 * storage-layer routing matrix: it reads the `_metadata.json` sidecar
 * produced by the video-metadata-extractor / oiio-proxy-generator
 * DataEngine functions directly from S3 and returns it as-is, so the
 * web-ui can render the dynamic metadata panel without the control-plane
 * owning or translating any schema.
 *
 * Contract:
 *   200 → { schema_version, file_kind, source_uri, sidecar_key, data }
 *         where `data` is the raw sidecar JSON object, untouched.
 *   400 → malformed sourceUri
 *   404 → sidecar does not exist in S3
 *   415 → file kind has no sidecar (e.g. pdf, txt)
 *   502 → sidecar exists but is not valid JSON
 *   503 → no storage endpoint configured / S3 infrastructure error
 *
 * No schema translation, no column filtering, no VastDB query. Callers
 * that need filter-by-HDR or cross-asset search must use a different
 * route backed by VastDB.
 */

import type { FastifyInstance } from "fastify";

import { S3Client } from "@aws-sdk/client-s3";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import {
  fetchSidecar,
  DEFAULT_SIDECAR_FETCH_CONFIG,
} from "../storage/sidecar-fetcher.js";
import {
  resolveSidecarLocation,
  InvalidSourceUriError,
} from "../storage/sidecar-resolver.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";

import { getStorageEndpoints } from "./platform-settings.js";

interface ResolvedEndpoint {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathStyle: boolean;
}

function makeS3Client(ep: ResolvedEndpoint): S3Client {
  return new S3Client({
    endpoint: ep.endpoint,
    region: ep.region || "us-east-1",
    credentials: ep.accessKeyId && ep.secretAccessKey
      ? { accessKeyId: ep.accessKeyId, secretAccessKey: ep.secretAccessKey }
      : undefined,
    forcePathStyle: ep.pathStyle !== false,
  });
}

const storageMetadataResponseSchema = {
  type: "object",
  required: ["schema_version", "file_kind", "source_uri", "sidecar_key", "data"],
  properties: {
    schema_version: { type: ["string", "number", "null"] },
    file_kind: { type: "string", enum: ["image", "video", "raw_camera"] },
    source_uri: { type: "string" },
    sidecar_key: { type: "string" },
    bucket: { type: "string" },
    bytes: { type: "number" },
    data: { type: "object", additionalProperties: true },
  },
} as const;

export async function registerStorageMetadataRoutes(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    app.get<{ Querystring: { sourceUri: string; endpointId?: string } }>(
      withPrefix(prefix, "/storage/metadata"),
      {
        schema: {
          tags: ["storage"],
          operationId: `${opPrefix}StorageMetadataLookup`,
          summary: "Read the _metadata.json sidecar for a source asset from S3",
          querystring: {
            type: "object",
            required: ["sourceUri"],
            properties: {
              sourceUri: { type: "string", description: "S3 URI (s3://bucket/key) or bare /key" },
              endpointId: { type: "string", description: "Optional endpoint override" },
            },
          },
          response: {
            200: storageMetadataResponseSchema,
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            415: errorEnvelopeSchema,
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { sourceUri, endpointId } = request.query;

        // Parse & classify. InvalidSourceUriError → 400, null → 415.
        let location;
        try {
          location = resolveSidecarLocation(sourceUri);
        } catch (err) {
          if (err instanceof InvalidSourceUriError) {
            return sendError(request, reply, 400, "INVALID_SOURCE_URI", err.message);
          }
          throw err;
        }
        if (!location) {
          return sendError(
            request,
            reply,
            415,
            "FILE_KIND_NOT_SUPPORTED",
            "sourceUri has no metadata sidecar (unsupported file kind)",
          );
        }

        const endpoints = getStorageEndpoints();
        const ep = endpointId
          ? endpoints.find((e) => e.id === endpointId)
          : location.bucket
            ? endpoints.find((e) => e.bucket === location.bucket) ?? endpoints[0]
            : endpoints[0];
        if (!ep) {
          return sendError(
            request,
            reply,
            503,
            "STORAGE_NOT_CONFIGURED",
            "No storage endpoints configured",
          );
        }
        const resolvedBucket = location.bucket ?? ep.bucket;

        setVastTlsSkip();
        const s3 = makeS3Client(ep);
        try {
          const fetched = await fetchSidecar(
            s3,
            resolvedBucket,
            location.sidecarKey,
            DEFAULT_SIDECAR_FETCH_CONFIG,
          );
          switch (fetched.kind) {
            case "ok": {
              const schemaVersion = readSchemaVersion(fetched.data);
              return reply.send({
                schema_version: schemaVersion,
                file_kind: location.fileKind,
                source_uri: sourceUri,
                sidecar_key: location.sidecarKey,
                bucket: resolvedBucket,
                bytes: fetched.bytes,
                data: fetched.data,
              });
            }
            case "not-found":
              return sendError(
                request,
                reply,
                404,
                "SIDECAR_NOT_FOUND",
                `No sidecar at ${location.sidecarKey} — metadata extraction may not have run yet`,
              );
            case "too-large":
              request.log.warn(
                { sidecar_key: location.sidecarKey, limit: fetched.limit },
                "Sidecar exceeded max body size",
              );
              return sendError(
                request,
                reply,
                502,
                "SIDECAR_TOO_LARGE",
                `Sidecar exceeds max body size of ${fetched.limit} bytes`,
              );
            case "invalid-json":
              request.log.warn(
                { sidecar_key: location.sidecarKey, snippet: fetched.snippet },
                "Sidecar is not valid JSON",
              );
              return sendError(
                request,
                reply,
                502,
                "SIDECAR_INVALID_JSON",
                "Sidecar exists but does not contain a JSON object",
              );
            case "error":
              request.log.error(
                { sidecar_key: location.sidecarKey, error: fetched.error.message },
                "S3 sidecar fetch failed",
              );
              return sendError(
                request,
                reply,
                503,
                "SIDECAR_FETCH_FAILED",
                fetched.error.message,
              );
          }
        } finally {
          s3.destroy();
          restoreVastTls();
        }
      },
    );
  }
}

function readSchemaVersion(data: Record<string, unknown>): string | number | null {
  const v = data.schema_version;
  if (typeof v === "string" || typeof v === "number") return v;
  return null;
}
