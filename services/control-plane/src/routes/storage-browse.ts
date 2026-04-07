/**
 * S3 storage browse routes.
 *
 * Provides file discovery by listing objects in configured S3 buckets.
 * Uses platform settings S3 endpoints — no Trino required.
 * Enables Capability 2: map existing storage locations.
 */

import type { FastifyInstance } from "fastify";

import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { getStorageEndpoints } from "./platform-settings.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTENSION_MEDIA_MAP: Record<string, string> = {
  ".exr": "image", ".dpx": "image", ".tiff": "image", ".tif": "image",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".hdr": "image",
  ".tx": "texture", ".tex": "texture",
  ".mov": "video", ".mp4": "video", ".mxf": "video", ".avi": "video", ".mkv": "video",
  ".r3d": "video", ".braw": "video", ".ari": "video",
  ".wav": "audio", ".aif": "audio", ".aiff": "audio", ".mp3": "audio", ".flac": "audio",
  ".abc": "3d", ".usd": "3d", ".usda": "3d", ".usdc": "3d", ".usdz": "3d",
  ".fbx": "3d", ".obj": "3d", ".gltf": "3d", ".glb": "3d",
  ".mtlx": "material", ".osl": "material", ".oso": "material",
  ".otio": "editorial", ".edl": "editorial", ".xml": "editorial", ".aaf": "editorial",
  ".nk": "comp", ".hip": "fx", ".ma": "scene", ".mb": "scene",
};

function inferMediaType(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "unknown";
  const ext = path.substring(lastDot).toLowerCase();
  return EXTENSION_MEDIA_MAP[ext] ?? "other";
}

function makeS3Client(ep: { endpoint: string; accessKeyId: string; secretAccessKey: string; region: string; pathStyle: boolean; useSsl: boolean }): S3Client {
  return new S3Client({
    endpoint: ep.endpoint,
    region: ep.region || "us-east-1",
    credentials: ep.accessKeyId && ep.secretAccessKey
      ? { accessKeyId: ep.accessKeyId, secretAccessKey: ep.secretAccessKey }
      : undefined,
    forcePathStyle: ep.pathStyle !== false,
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const browseFileSchema = {
  type: "object",
  required: ["key", "sizeBytes", "lastModified", "inferredMediaType"],
  properties: {
    key: { type: "string" },
    sizeBytes: { type: "number" },
    lastModified: { type: "string" },
    inferredMediaType: { type: "string" },
    sourceUri: { type: "string" },
  },
} as const;

const browseFolderSchema = {
  type: "object",
  required: ["prefix"],
  properties: {
    prefix: { type: "string" },
  },
} as const;

const browseResponseSchema = {
  type: "object",
  required: ["endpointId", "bucket", "prefix", "files", "folders", "truncated"],
  properties: {
    endpointId: { type: "string" },
    bucket: { type: "string" },
    prefix: { type: "string" },
    files: { type: "array", items: browseFileSchema },
    folders: { type: "array", items: browseFolderSchema },
    truncated: { type: "boolean" },
    continuationToken: { type: "string" },
  },
} as const;

const endpointListSchema = {
  type: "object",
  required: ["endpoints"],
  properties: {
    endpoints: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "bucket"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          endpoint: { type: "string" },
          bucket: { type: "string" },
          region: { type: "string" },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerStorageBrowseRoutes(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    // --- GET /storage/endpoints --- List configured S3 endpoints
    app.get(
      withPrefix(prefix, "/storage/endpoints"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StorageEndpoints" : "legacyStorageEndpoints",
          summary: "List configured S3 storage endpoints",
          response: {
            200: endpointListSchema,
          },
        },
      },
      async (_request, reply) => {
        const endpoints = getStorageEndpoints();
        return reply.send({
          endpoints: endpoints.map(({ id, label, endpoint, bucket, region }) => ({
            id, label, endpoint, bucket, region,
          })),
        });
      },
    );

    // --- GET /storage/browse --- List objects in a configured S3 bucket
    app.get<{
      Querystring: {
        endpointId?: string;
        prefix?: string;
        maxKeys?: number;
        continuationToken?: string;
      };
    }>(
      withPrefix(prefix, "/storage/browse"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StorageBrowse" : "legacyStorageBrowse",
          summary: "Browse files in a configured S3 storage location",
          querystring: {
            type: "object",
            properties: {
              endpointId: { type: "string", description: "S3 endpoint ID from platform settings" },
              prefix: { type: "string", description: "S3 key prefix to filter (folder path)" },
              maxKeys: { type: "number", minimum: 1, maximum: 1000, default: 100 },
              continuationToken: { type: "string", description: "Pagination token from previous response" },
            },
          },
          response: {
            200: browseResponseSchema,
            400: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const endpoints = getStorageEndpoints();
        if (endpoints.length === 0) {
          return sendError(request, reply, 503, "STORAGE_NOT_CONFIGURED",
            "No S3 storage endpoints configured. Add endpoints in Settings > Storage.");
        }

        const { endpointId, prefix: pathPrefix, maxKeys, continuationToken } = request.query;

        // Use first endpoint by default, or find by ID
        const ep = endpointId
          ? endpoints.find((e) => e.id === endpointId)
          : endpoints[0];

        if (!ep) {
          return sendError(request, reply, 400, "ENDPOINT_NOT_FOUND",
            `S3 endpoint "${endpointId}" not found. Use GET /storage/endpoints to list available endpoints.`);
        }

        setVastTlsSkip();
        try {
          const s3 = makeS3Client(ep);
          const result = await s3.send(new ListObjectsV2Command({
            Bucket: ep.bucket,
            Prefix: pathPrefix || undefined,
            Delimiter: "/",
            MaxKeys: maxKeys || 100,
            ContinuationToken: continuationToken || undefined,
          }));
          s3.destroy();

          const files = (result.Contents ?? []).map((obj) => ({
            key: obj.Key ?? "",
            sizeBytes: obj.Size ?? 0,
            lastModified: obj.LastModified?.toISOString() ?? "",
            inferredMediaType: inferMediaType(obj.Key ?? ""),
            sourceUri: `s3://${ep.bucket}/${obj.Key ?? ""}`,
          }));

          const folders = (result.CommonPrefixes ?? []).map((cp) => ({
            prefix: cp.Prefix ?? "",
          }));

          return reply.send({
            endpointId: ep.id,
            bucket: ep.bucket,
            prefix: pathPrefix ?? "",
            files,
            folders,
            truncated: result.IsTruncated ?? false,
            ...(result.NextContinuationToken ? { continuationToken: result.NextContinuationToken } : {}),
          });
        } catch (err) {
          return sendError(request, reply, 503, "S3_BROWSE_FAILED",
            err instanceof Error ? err.message : "Failed to list S3 objects");
        } finally {
          restoreVastTls();
        }
      },
    );

    // --- GET /storage/object-info/:endpointId/* --- Get metadata for a specific S3 object
    app.get<{
      Params: { endpointId: string; "*": string };
    }>(
      withPrefix(prefix, "/storage/object-info/:endpointId/*"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StorageObjectInfo" : "legacyStorageObjectInfo",
          summary: "Get S3 object metadata (HEAD)",
          response: {
            200: {
              type: "object",
              properties: {
                key: { type: "string" },
                bucket: { type: "string" },
                sizeBytes: { type: "number" },
                lastModified: { type: "string" },
                contentType: { type: "string" },
                eTag: { type: "string" },
                metadata: { type: "object", additionalProperties: { type: "string" } },
                sourceUri: { type: "string" },
              },
            },
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { endpointId } = request.params;
        const key = (request.params as any)["*"];

        const endpoints = getStorageEndpoints();
        const ep = endpoints.find((e) => e.id === endpointId);
        if (!ep) {
          return sendError(request, reply, 400, "ENDPOINT_NOT_FOUND", `S3 endpoint "${endpointId}" not found`);
        }

        setVastTlsSkip();
        try {
          const s3 = makeS3Client(ep);
          const result = await s3.send(new HeadObjectCommand({
            Bucket: ep.bucket,
            Key: key,
          }));
          s3.destroy();

          return reply.send({
            key,
            bucket: ep.bucket,
            sizeBytes: result.ContentLength ?? 0,
            lastModified: result.LastModified?.toISOString() ?? "",
            contentType: result.ContentType ?? "",
            eTag: result.ETag ?? "",
            metadata: result.Metadata ?? {},
            sourceUri: `s3://${ep.bucket}/${key}`,
          });
        } catch (err) {
          const statusCode = (err as any)?.$metadata?.httpStatusCode;
          if (statusCode === 404) {
            return sendError(request, reply, 404, "NOT_FOUND", `Object not found: ${key}`);
          }
          return sendError(request, reply, 503, "S3_HEAD_FAILED",
            err instanceof Error ? err.message : "Failed to get object metadata");
        } finally {
          restoreVastTls();
        }
      },
    );

    // --- GET /storage/presign --- Generate a presigned download URL for an S3 object
    app.get<{
      Querystring: { sourceUri: string; endpointId?: string; expiresIn?: number };
    }>(
      withPrefix(prefix, "/storage/presign"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StoragePresign" : "legacyStoragePresign",
          summary: "Generate a presigned download URL for an S3 object",
          querystring: {
            type: "object",
            required: ["sourceUri"],
            properties: {
              sourceUri: { type: "string", description: "S3 URI (s3://bucket/key)" },
              endpointId: { type: "string", description: "S3 endpoint ID (auto-detected from URI if omitted)" },
              expiresIn: { type: "number", minimum: 60, maximum: 86400, default: 3600 },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                url: { type: "string" },
                expiresAt: { type: "string" },
                sourceUri: { type: "string" },
              },
            },
            400: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { sourceUri, endpointId, expiresIn = 3600 } = request.query;

        // Parse s3://bucket/key
        const s3Match = sourceUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (!s3Match) {
          return sendError(request, reply, 400, "INVALID_URI",
            "sourceUri must be in s3://bucket/key format");
        }
        const [, bucket, key] = s3Match;

        const endpoints = getStorageEndpoints();
        // Find endpoint matching the bucket, or by ID
        const ep = endpointId
          ? endpoints.find((e) => e.id === endpointId)
          : endpoints.find((e) => e.bucket === bucket) ?? endpoints[0];

        if (!ep) {
          return sendError(request, reply, 503, "STORAGE_NOT_CONFIGURED",
            "No matching S3 endpoint found for this bucket");
        }

        setVastTlsSkip();
        try {
          const s3 = makeS3Client(ep);
          const command = new GetObjectCommand({ Bucket: bucket, Key: key });
          const url = await getSignedUrl(s3, command, { expiresIn });
          s3.destroy();

          return reply.send({
            url,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            sourceUri,
          });
        } catch (err) {
          return sendError(request, reply, 503, "PRESIGN_FAILED",
            err instanceof Error ? err.message : "Failed to generate presigned URL");
        } finally {
          restoreVastTls();
        }
      },
    );
  }
}
