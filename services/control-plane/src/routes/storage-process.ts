/**
 * Storage processing trigger route.
 *
 *   POST /api/v1/storage/process
 *   Body: { sourceUri: "s3://bucket/key" }
 *
 * Triggers DataEngine processing for a file by performing an S3
 * CopyObject in-place (same bucket, same key, same metadata). This
 * fires an `ObjectCreated:Copy` event on the VAST cluster, which
 * matches the element triggers (configured as `ObjectCreated:*`) and
 * starts the associated DataEngine pipeline (proxy generation +
 * metadata extraction).
 *
 * Why copy-in-place instead of publishing a CloudEvent to Kafka?
 * ---------------------------------------------------------------------------
 * The VAST DataEngine triggers on the dev cluster use element-level
 * event notifications tied to S3 object lifecycle events. A copy-in-
 * place reuses the exact same trigger path as a real upload:
 *
 *   S3 CopyObject → VAST fires ObjectCreated:Copy → element trigger
 *   matches extension suffix → pipeline runs → artifacts land in
 *   .proxies/
 *
 * This approach requires ZERO Kafka infrastructure — no broker URL, no
 * SASL credentials, no producer lifecycle, no CloudEvent schema. It
 * works TODAY with the existing S3 endpoint configuration.
 *
 * Future: Kafka CloudEvent path (Option B)
 * ---------------------------------------------------------------------------
 * When the Event Broker is configured (`VAST_EVENT_BROKER_URL` + SASL
 * credentials in Platform Settings), this route should be upgraded to
 * the full Kafka pipeline for richer semantics:
 *
 * 1. Write a `processing_requests` row (migration 015) with status
 *    "in_progress", deadline_at = now + 5min, and a unique job_id.
 *    Partial unique index on (s3_bucket, s3_key) WHERE status =
 *    "in_progress" prevents duplicate in-flight requests.
 *
 * 2. Publish a CloudEvent to the Event Broker topic that the VAST
 *    element triggers subscribe to:
 *      {
 *        specversion: "1.0",
 *        type: "vastdata.com:Element.ObjectCreated",
 *        source: "vastdata.com:<triggerName>.<triggerId>",
 *        subject: "vastdata.com:<broker>.<topic>",
 *        id: <uuid>,
 *        time: <RFC3339>,
 *        datacontenttype: "application/json",
 *        data: { s3_bucket: <bucket>, s3_key: <key> }
 *      }
 *    The builder function should live at
 *    `src/events/vms-element-event.ts` — pure, unit-testable, no I/O.
 *
 * 3. The VastEventSubscriber (already listening for
 *    `vast.dataengine.pipeline.completed`) should update the
 *    processing_requests row on completion, setting status to
 *    "completed" or "failed" with error details.
 *
 * 4. A sweeper loop (5-minute interval) should mark timed-out
 *    in-flight requests as "failed" with reason "deadline exceeded"
 *    as a safety net.
 *
 * 5. `POST /storage/processing-status` should read from the
 *    processing_requests table to populate `in_flight_job_id`,
 *    `last_status`, and `last_error` (currently hardcoded null at
 *    storage-browse.ts:759-761).
 *
 * 6. The web-ui should show a progress spinner while the request is
 *    in-flight (status === "processing") and auto-refresh on
 *    completion via the EventSource SSE stream.
 *
 * Prerequisites for Option B:
 *   - VAST_EVENT_BROKER_URL configured (currently empty in .env)
 *   - SASL credentials for the broker
 *   - Kafka producer singleton bootstrapped in app.ts
 *   - Trigger GUIDs + topic names from VMS (stored in Platform Settings
 *     alongside the pipeline config — extend DataEnginePipelineConfig
 *     with `triggerGuid`, `triggerTopic` fields)
 *   - processing_requests table deployed via vast-migrate.py
 *   - DataEngine functions confirmed idempotent on reprocess
 *
 * Plan reference: docs/plans/2026-04-09-storage-process-wiring-sow.md
 * ---------------------------------------------------------------------------
 */

import type { FastifyInstance } from "fastify";

import { S3Client, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { getStorageEndpoints } from "./platform-settings.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";
import { inferFileKind } from "../storage/file-kinds.js";

function makeS3Client(ep: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathStyle: boolean;
}): S3Client {
  return new S3Client({
    endpoint: ep.endpoint,
    region: ep.region || "us-east-1",
    credentials:
      ep.accessKeyId && ep.secretAccessKey
        ? { accessKeyId: ep.accessKeyId, secretAccessKey: ep.secretAccessKey }
        : undefined,
    forcePathStyle: ep.pathStyle !== false,
  });
}

const S3_URI_PATTERN = /^s3:\/\/([^/]+)\/(.+)$/;

const processResponseSchema = {
  type: "object",
  required: ["triggered", "sourceUri", "fileKind", "method"],
  properties: {
    triggered: { type: "boolean" },
    sourceUri: { type: "string" },
    bucket: { type: "string" },
    key: { type: "string" },
    fileKind: { type: "string" },
    method: { type: "string", enum: ["s3-copy-in-place"] },
    message: { type: "string" },
  },
} as const;

export async function registerStorageProcessRoutes(
  app: FastifyInstance,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    app.post<{ Body: { sourceUri: string; endpointId?: string } }>(
      withPrefix(prefix, "/storage/process"),
      {
        schema: {
          tags: ["storage"],
          operationId: `${opPrefix}TriggerStorageProcessing`,
          summary:
            "Trigger DataEngine processing for a file via S3 copy-in-place",
          description:
            "Performs an S3 CopyObject of the file onto itself, which fires " +
            "an ObjectCreated event on the VAST cluster and triggers any " +
            "matching DataEngine element triggers (proxy generation, " +
            "metadata extraction). The operation is idempotent — calling " +
            "it multiple times simply re-triggers the pipeline.",
          body: {
            type: "object",
            required: ["sourceUri"],
            properties: {
              sourceUri: {
                type: "string",
                description: 'S3 URI (s3://bucket/key) or bare /key',
              },
              endpointId: {
                type: "string",
                description: "Optional S3 endpoint override",
              },
            },
          },
          response: {
            200: processResponseSchema,
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            415: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { sourceUri, endpointId } = request.body;

        // Parse sourceUri
        if (!sourceUri || typeof sourceUri !== "string") {
          return sendError(
            request,
            reply,
            400,
            "INVALID_SOURCE_URI",
            "sourceUri must be a non-empty string",
          );
        }

        let bucket: string | null = null;
        let key: string;
        const s3Match = sourceUri.match(S3_URI_PATTERN);
        if (s3Match) {
          bucket = s3Match[1];
          key = s3Match[2];
        } else if (sourceUri.startsWith("s3://")) {
          return sendError(
            request,
            reply,
            400,
            "INVALID_SOURCE_URI",
            "sourceUri has malformed s3:// form",
          );
        } else {
          key = sourceUri.replace(/^\/+/, "");
          if (key.length === 0) {
            return sendError(
              request,
              reply,
              400,
              "INVALID_SOURCE_URI",
              "sourceUri has empty key",
            );
          }
        }

        // Classify file kind — only trigger processing for kinds the
        // pipeline actually handles
        const filename = key.includes("/")
          ? key.substring(key.lastIndexOf("/") + 1)
          : key;
        const fileKind = inferFileKind(filename);
        if (fileKind === "other") {
          return sendError(
            request,
            reply,
            415,
            "FILE_KIND_NOT_SUPPORTED",
            `File kind "other" is not processed by any DataEngine pipeline`,
          );
        }

        // Resolve the S3 endpoint
        const endpoints = getStorageEndpoints();
        const ep = endpointId
          ? endpoints.find((e) => e.id === endpointId)
          : bucket
            ? endpoints.find((e) => e.bucket === bucket) ?? endpoints[0]
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

        const resolvedBucket = bucket ?? ep.bucket;

        setVastTlsSkip();
        const s3 = makeS3Client(ep);
        try {
          // Verify the source object exists before copying
          try {
            await s3.send(
              new HeadObjectCommand({ Bucket: resolvedBucket, Key: key }),
            );
          } catch {
            return sendError(
              request,
              reply,
              404,
              "OBJECT_NOT_FOUND",
              `S3 object not found: ${resolvedBucket}/${key}`,
            );
          }

          // Copy-in-place — triggers ObjectCreated:Copy on VAST, which
          // fires all element triggers matching this extension.
          //
          // AWS S3 (and VAST) requires MetadataDirective: "REPLACE" when
          // copying an object onto itself. With "COPY" the API rejects
          // because source === destination. "REPLACE" means "keep the
          // same content but re-stamp metadata" — since we pass no new
          // metadata headers the effective result is a no-op on content
          // and metadata, but the S3 event fires as ObjectCreated:Copy.
          const encodedKey = key
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/");
          const copySource = `${resolvedBucket}/${encodedKey}`;
          await s3.send(
            new CopyObjectCommand({
              Bucket: resolvedBucket,
              Key: key,
              CopySource: copySource,
              MetadataDirective: "REPLACE",
            }),
          );

          request.log.info(
            {
              sourceUri,
              bucket: resolvedBucket,
              key,
              fileKind,
              method: "s3-copy-in-place",
            },
            "Processing triggered via S3 copy-in-place",
          );

          return reply.send({
            triggered: true,
            sourceUri,
            bucket: resolvedBucket,
            key,
            fileKind,
            method: "s3-copy-in-place",
            message: `Processing triggered for ${filename}. DataEngine pipeline will run asynchronously — artifacts will appear in .proxies/ when complete.`,
          });
        } finally {
          s3.destroy();
          restoreVastTls();
        }
      },
    );
  }
}
