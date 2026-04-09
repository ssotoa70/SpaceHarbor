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

    // --- GET /storage/media-urls --- Resolve presigned URLs for source, thumbnail, and proxy
    // Uses the DataEngine `.proxies/` convention to derive paths.
    app.get<{
      Querystring: { sourceUri: string; endpointId?: string };
    }>(
      withPrefix(prefix, "/storage/media-urls"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StorageMediaUrls" : "legacyStorageMediaUrls",
          summary: "Get presigned URLs for source, thumbnail, and proxy by convention",
          querystring: {
            type: "object",
            required: ["sourceUri"],
            properties: {
              sourceUri: { type: "string" },
              endpointId: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                source: { type: "string" },
                thumbnail: { type: "string" },
                preview: { type: "string" },
                proxy: { type: "string" },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const { sourceUri, endpointId } = request.query;

        // Resolve bucket and key from sourceUri (supports both s3://bucket/key and /key formats)
        let bucket: string | null = null;
        let key: string;

        const s3Match = sourceUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (s3Match) {
          bucket = s3Match[1];
          key = s3Match[2];
        } else {
          // Bare path like /uploads/uuid/file.exr — use first endpoint's bucket
          key = sourceUri.startsWith("/") ? sourceUri.slice(1) : sourceUri;
        }

        const endpoints = getStorageEndpoints();
        const ep = endpointId
          ? endpoints.find((e) => e.id === endpointId)
          : bucket
            ? endpoints.find((e) => e.bucket === bucket) ?? endpoints[0]
            : endpoints[0];

        if (!ep) {
          return reply.send({ source: null, thumbnail: null, proxy: null });
        }

        const resolvedBucket = bucket ?? ep.bucket;

        // Derive proxy paths using DataEngine convention:
        // source: bucket/path/to/file.exr
        // thumb:  bucket/path/to/.proxies/file_thumb.jpg
        // proxy:  bucket/path/to/.proxies/file_proxy.mp4
        const dir = key.includes("/") ? key.substring(0, key.lastIndexOf("/")) : "";
        const filename = key.includes("/") ? key.substring(key.lastIndexOf("/") + 1) : key;
        const baseName = filename.replace(/\.[^.]+$/, "");
        // Artifact naming conventions (tracked with the DataEngine function):
        //   - _thumb.jpg  : 256×256 thumbnail for grid cards
        //   - _preview.jpg: full-res still (not yet produced — future function rev)
        //   - _proxy.jpg  : higher-res still image proxy (current output for EXR)
        //   - _proxy.mp4  : H.264 video proxy (for video sources; not used for still EXRs)
        // Both _proxy.jpg and _proxy.mp4 are checked — _proxy.mp4 is the legacy
        // name from earlier function revisions and may still exist for video inputs.
        const thumbKey = dir ? `${dir}/.proxies/${baseName}_thumb.jpg` : `.proxies/${baseName}_thumb.jpg`;
        const previewKey = dir ? `${dir}/.proxies/${baseName}_preview.jpg` : `.proxies/${baseName}_preview.jpg`;
        const proxyJpgKey = dir ? `${dir}/.proxies/${baseName}_proxy.jpg` : `.proxies/${baseName}_proxy.jpg`;
        const proxyMp4Key = dir ? `${dir}/.proxies/${baseName}_proxy.mp4` : `.proxies/${baseName}_proxy.mp4`;

        // Browser-native image extensions — can use source as thumbnail fallback
        const BROWSER_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"]);
        const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
        const isBrowserImage = BROWSER_IMAGE_EXTS.has(ext);

        setVastTlsSkip();
        try {
          const s3 = makeS3Client(ep);
          const expiresIn = 3600;

          // Check if .proxies/ files exist (using authenticated HEAD, not presigned)
          const exists = async (k: string): Promise<boolean> => {
            try {
              await s3.send(new HeadObjectCommand({ Bucket: resolvedBucket, Key: k }));
              return true;
            } catch {
              return false;
            }
          };

          // Run existence checks in parallel with source presigning
          const [sourceUrl, thumbExists, previewExists, proxyJpgExists, proxyMp4Exists] = await Promise.all([
            getSignedUrl(s3, new GetObjectCommand({ Bucket: resolvedBucket, Key: key }), { expiresIn }),
            exists(thumbKey),
            exists(previewKey),
            exists(proxyJpgKey),
            exists(proxyMp4Key),
          ]);

          // Only presign .proxies/ URLs if the objects actually exist.
          // Preview preference: _preview.jpg > _proxy.jpg > source (browser-native)
          // Video proxy is strictly _proxy.mp4 — the UI uses it to render <video>.
          const [thumbUrl, previewJpgUrl, proxyJpgUrl, proxyMp4Url] = await Promise.all([
            thumbExists ? getSignedUrl(s3, new GetObjectCommand({ Bucket: resolvedBucket, Key: thumbKey }), { expiresIn }) : null,
            previewExists ? getSignedUrl(s3, new GetObjectCommand({ Bucket: resolvedBucket, Key: previewKey }), { expiresIn }) : null,
            proxyJpgExists ? getSignedUrl(s3, new GetObjectCommand({ Bucket: resolvedBucket, Key: proxyJpgKey }), { expiresIn }) : null,
            proxyMp4Exists ? getSignedUrl(s3, new GetObjectCommand({ Bucket: resolvedBucket, Key: proxyMp4Key }), { expiresIn }) : null,
          ]);

          s3.destroy();

          return reply.send({
            source: sourceUrl,
            // For browser-native images, fall back to source as thumbnail
            thumbnail: thumbUrl ?? (isBrowserImage ? sourceUrl : null),
            // Full-res preview cascade: _preview.jpg > _proxy.jpg > source (browser-native)
            preview: previewJpgUrl ?? proxyJpgUrl ?? (isBrowserImage ? sourceUrl : null),
            // Video proxy: .mp4 only
            proxy: proxyMp4Url,
          });
        } catch {
          return reply.send({ source: null, thumbnail: null, proxy: null });
        } finally {
          restoreVastTls();
        }
      },
    );

    // --- POST /storage/processing-status ---
    // Batch-query the processing state of a list of S3 objects. Returns, for
    // each sourceUri, which derived artifacts exist on disk (.proxies/_thumb,
    // _preview, _proxy) plus any in-flight / failed processing_requests row.
    //
    // The UI calls this after a browse to decorate each row with a status icon.
    // We intentionally use POST (not GET) so the request body can carry up to
    // 200 sourceUris at once without hitting URL length limits.
    app.post<{
      Body: { sourceUris: string[] };
    }>(
      withPrefix(prefix, "/storage/processing-status"),
      {
        schema: {
          tags: ["storage"],
          operationId: prefix === "/api/v1" ? "v1StorageProcessingStatus" : "legacyStorageProcessingStatus",
          summary: "Batch-query processing state (artifacts + in-flight jobs) for S3 objects",
          body: {
            type: "object",
            required: ["sourceUris"],
            properties: {
              sourceUris: {
                type: "array",
                items: { type: "string" },
                maxItems: 200,
              },
            },
          },
          response: {
            200: {
              type: "object",
              required: ["results"],
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sourceUri: { type: "string" },
                      thumb_ready: { type: "boolean" },
                      preview_ready: { type: "boolean" },
                      proxy_ready: { type: "boolean" },
                      metadata_ready: { type: "boolean" },
                      in_flight_job_id: { type: ["string", "null"] },
                      last_status: { type: ["string", "null"] },
                      last_error: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { sourceUris } = request.body ?? { sourceUris: [] };
        if (!Array.isArray(sourceUris) || sourceUris.length === 0) {
          return reply.send({ results: [] });
        }

        const endpoints = getStorageEndpoints();
        if (endpoints.length === 0) {
          return sendError(request, reply, 503, "STORAGE_NOT_CONFIGURED",
            "No S3 storage endpoints configured.");
        }

        // Lazy-build S3 clients keyed by endpoint id — many sourceUris will
        // share the same bucket so we avoid reconstructing the client per key.
        const clientCache = new Map<string, S3Client>();
        const getClient = (ep: typeof endpoints[number]): S3Client => {
          const cached = clientCache.get(ep.id);
          if (cached) return cached;
          const fresh = makeS3Client(ep);
          clientCache.set(ep.id, fresh);
          return fresh;
        };

        // NB: this helper is deliberately copy-pasted from the /storage/media-urls
        // handler above rather than extracted to a shared function. The two
        // routes serve different response shapes and we want to keep them
        // loosely coupled until both have proven behavior in production. A
        // follow-up cleanup commit will consolidate.
        const headExists = async (client: S3Client, bucket: string, key: string): Promise<boolean> => {
          try {
            await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return true;
          } catch {
            return false;
          }
        };

        setVastTlsSkip();
        try {
          const results = await Promise.all(sourceUris.map(async (sourceUri) => {
            // Parse bucket + key. Accept both s3://bucket/key and bare /key.
            let bucket: string | null = null;
            let key: string;
            const match = sourceUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
            if (match) {
              bucket = match[1];
              key = match[2];
            } else {
              key = sourceUri.startsWith("/") ? sourceUri.slice(1) : sourceUri;
            }

            const ep = bucket
              ? endpoints.find((e) => e.bucket === bucket) ?? endpoints[0]
              : endpoints[0];
            const resolvedBucket = bucket ?? ep.bucket;

            // Derive sibling proxy paths via the DataEngine convention.
            // See media-urls handler above for the convention reference.
            const dir = key.includes("/") ? key.substring(0, key.lastIndexOf("/")) : "";
            const filename = key.includes("/") ? key.substring(key.lastIndexOf("/") + 1) : key;
            const baseName = filename.replace(/\.[^.]+$/, "");
            const thumbKey = dir ? `${dir}/.proxies/${baseName}_thumb.jpg` : `.proxies/${baseName}_thumb.jpg`;
            const previewKey = dir ? `${dir}/.proxies/${baseName}_preview.jpg` : `.proxies/${baseName}_preview.jpg`;
            const proxyJpgKey = dir ? `${dir}/.proxies/${baseName}_proxy.jpg` : `.proxies/${baseName}_proxy.jpg`;
            const proxyMp4Key = dir ? `${dir}/.proxies/${baseName}_proxy.mp4` : `.proxies/${baseName}_proxy.mp4`;

            const client = getClient(ep);
            const [thumbReady, previewFileReady, proxyJpgReady, proxyMp4Ready] = await Promise.all([
              headExists(client, resolvedBucket, thumbKey),
              headExists(client, resolvedBucket, previewKey),
              headExists(client, resolvedBucket, proxyJpgKey),
              headExists(client, resolvedBucket, proxyMp4Key),
            ]);
            // preview_ready = dedicated _preview.jpg OR _proxy.jpg (the DataEngine
            //   function currently emits _proxy.jpg as the higher-res still).
            // proxy_ready   = only the video .mp4 proxy. Still-image EXRs won't
            //   have one; the UI falls back to the preview JPG instead.
            const previewReady = previewFileReady || proxyJpgReady;
            const proxyReady = proxyMp4Ready;

            // Metadata readiness — currently only EXR files have a metadata
            // sidecar table. Other file types report metadata_ready=false and
            // the UI won't surface a "missing metadata" indicator for them.
            // TODO(commit 3): query processing_requests for in_flight_job_id
            // once the insert path exists. For now always return null.
            const isExr = filename.toLowerCase().endsWith(".exr");
            let metadataReady = false;
            if (isExr) {
              // Best-effort EXR metadata lookup via the existing route helper.
              // If the vastdb-query service is unreachable we return false and
              // the UI shows a "no metadata" state — a safe default.
              try {
                const { proxyToVastdbQuery } = await import("./exr-metadata.js");
                const lookup = await proxyToVastdbQuery(
                  `/api/v1/exr-metadata/lookup?path=${encodeURIComponent(filename)}`,
                );
                if (lookup.ok && lookup.data && typeof lookup.data === "object" && "found" in lookup.data) {
                  metadataReady = Boolean((lookup.data as { found: boolean }).found);
                }
              } catch {
                metadataReady = false;
              }
            }

            return {
              sourceUri,
              thumb_ready: thumbReady,
              preview_ready: previewReady,
              proxy_ready: proxyReady,
              metadata_ready: metadataReady,
              in_flight_job_id: null as string | null,
              last_status: null as string | null,
              last_error: null as string | null,
            };
          }));

          // Clean up cached clients
          for (const client of clientCache.values()) {
            client.destroy();
          }

          return reply.send({ results });
        } catch (err) {
          return sendError(request, reply, 503, "STATUS_CHECK_FAILED",
            err instanceof Error ? err.message : "Failed to query processing status");
        } finally {
          restoreVastTls();
        }
      },
    );
  }
}
