/**
 * Atomic media check-in — TACTIC BaseCheckin._execute() equivalent.
 *
 * Two-call client protocol, one durable transaction boundary:
 *
 *   1. POST /assets/checkin
 *      ├─ Reserve versionId, allocate versionNumber (context-scoped)
 *      ├─ Initiate S3 multipart upload, get uploadId
 *      ├─ Generate presigned URLs for N parts (5 MB min, 10 000 max per VAST)
 *      ├─ Write s3_compensation_log row (status=pending) with AbortMultipartUpload
 *      │  inverse_operation and (bucket, key, uploadId) in inverse_payload
 *      ├─ Write checkins row in state="reserved"
 *      └─ Return { checkinId, versionId, uploadId, parts[], deadline }
 *
 *   2. POST /assets/checkin/:id/commit
 *      ├─ Client provides { parts: [{ partNumber, eTag }] } from S3 UploadPart
 *      │  responses (NOT cached client-side values — VAST firmware variance
 *      │  on ETag computation, confirmed with media-pipeline-specialist).
 *      ├─ S3 CompleteMultipartUpload with the provided part ETags
 *      ├─ Flip Version row to status="completed", publishedAt=now
 *      ├─ Upsert `latest` sentinel row (context-scoped)
 *      ├─ Mark compensation rows pending→committed
 *      └─ Return { checkinId, versionId, committedAt, sentinel }
 *
 *   If any step in /commit fails, the handler runs compensations synchronously
 *   so the client gets one deterministic error response.
 *
 *   3. POST /assets/checkin/:id/abort
 *      ├─ S3 AbortMultipartUpload
 *      ├─ Mark compensation rows compensated
 *      └─ Soft-delete the reserved Version row (state → aborted)
 *
 *   4. GET /assets/checkin/:id
 *      └─ Inspect state for clients + reaper
 *
 *   Reaper (separate worker, lands alongside Phase 2 atomic-checkin roadmap
 *   work) watches checkins table for `state="reserved" AND deadline_at < now()`
 *   and issues /abort automatically.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";
import { getStorageEndpoints } from "./platform-settings.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";

// ---------------------------------------------------------------------------
// Types (client-facing)
// ---------------------------------------------------------------------------

export interface CheckinReserveInput {
  shotId: string;
  projectId: string;
  sequenceId: string;
  context?: string;
  versionLabel: string;
  filename: string;
  contentType?: string;
  fileSizeBytes: number;
  preferredPartSizeBytes?: number;
  endpointId?: string;
  notes?: string;
}

export interface CheckinReservation {
  checkinId: string;
  versionId: string;
  versionNumber: number;
  context: string;
  s3: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{
      partNumber: number;
      presignedUrl: string;
      sizeBytes: number;
    }>;
  };
  deadline: string;
}

export interface CheckinCommitInput {
  parts: Array<{
    partNumber: number;
    eTag: string;
  }>;
}

// ---------------------------------------------------------------------------
// Part plan
// ---------------------------------------------------------------------------

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — AWS S3 / VAST minimum
const MAX_PARTS = 10_000;
const DEFAULT_PART_SIZE_BYTES = 50 * 1024 * 1024;

export function computePartPlan(
  fileSizeBytes: number,
  preferred?: number,
): { partSizeBytes: number; partCount: number } {
  if (fileSizeBytes <= 0) {
    throw new Error("fileSizeBytes must be positive");
  }
  let partSize = Math.max(preferred ?? DEFAULT_PART_SIZE_BYTES, MIN_PART_SIZE_BYTES);
  let partCount = Math.ceil(fileSizeBytes / partSize);
  while (partCount > MAX_PARTS) {
    partSize *= 2;
    partCount = Math.ceil(fileSizeBytes / partSize);
  }
  return { partSizeBytes: partSize, partCount };
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

interface ResolvedS3Endpoint {
  id: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
}

function resolveEndpoint(endpointId?: string): ResolvedS3Endpoint | null {
  const endpoints = getStorageEndpoints();
  const resolved = endpointId
    ? endpoints.find((e) => e.id === endpointId)
    : endpoints[0];
  if (!resolved || !resolved.endpoint || !resolved.bucket || !resolved.accessKeyId || !resolved.secretAccessKey) {
    return null;
  }
  return {
    id: resolved.id,
    endpoint: resolved.endpoint,
    region: resolved.region || "us-east-1",
    bucket: resolved.bucket,
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    pathStyle: resolved.pathStyle !== false,
  };
}

function makeS3Client(ep: ResolvedS3Endpoint): S3Client {
  return new S3Client({
    endpoint: ep.endpoint,
    region: ep.region,
    credentials: {
      accessKeyId: ep.accessKeyId,
      secretAccessKey: ep.secretAccessKey,
    },
    forcePathStyle: ep.pathStyle,
  });
}

// ---------------------------------------------------------------------------
// Filename safety (reused from upload.ts)
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
  ".exr", ".dpx", ".tiff", ".tif", ".png", ".jpg", ".jpeg", ".hdr", ".tx", ".tex", ".psd",
  ".mov", ".mp4", ".mxf", ".avi", ".mkv", ".webm",
  ".r3d", ".cr3", ".cr2", ".arw", ".nef", ".dng",
  ".wav", ".aif", ".aiff", ".mp3", ".flac", ".ogg",
  ".abc", ".usd", ".usda", ".usdc", ".usdz", ".fbx", ".obj", ".gltf", ".glb", ".vdb",
  ".mtlx", ".osl", ".oso",
  ".nk", ".hip", ".ma", ".mb",
  ".otio", ".edl", ".xml", ".aaf",
  ".cube", ".3dl", ".csp", ".lut",
  ".pdf", ".doc", ".docx", ".ai",
  ".zip", ".tar", ".gz",
  ".json", ".yaml", ".yml",
]);

function validateFilename(filename: string): { ok: true } | { ok: false; message: string } {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return { ok: false, message: "invalid filename: must not contain path separators" };
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, message: `file type not allowed: ${ext || "(none)"}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Storage key — keep it simple and deterministic for Phase 1.
// A future "naming template engine" (Phase 2 of the roadmap) will let
// admins configure the layout without a code deploy.
// ---------------------------------------------------------------------------

function buildStorageKey(input: CheckinReserveInput, context: string, versionNumber: number): string {
  const ext = path.extname(input.filename).toLowerCase();
  const stem = path.basename(input.filename, ext);
  return `assets/${input.projectId}/${input.shotId}/${context}/v${String(versionNumber).padStart(4, "0")}/${stem}${ext}`;
}

// ---------------------------------------------------------------------------
// Identity helper
// ---------------------------------------------------------------------------

function resolveActor(request: FastifyRequest): string {
  const identity = (request as FastifyRequest & { identity?: string }).identity;
  return identity ?? "anonymous";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const RESERVATION_TTL_MS = 60 * 60 * 1000; // 1h default; reaper sweeps expired reservations

export async function registerCheckinRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    // ── POST /assets/checkin (reserve + initiate multipart) ──
    app.post<{ Body: CheckinReserveInput }>(
      withPrefix(prefix, "/assets/checkin"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}ReserveCheckin`,
          summary: "Phase 1: reserve a versionId and initiate S3 multipart upload",
          body: {
            type: "object",
            required: ["shotId", "projectId", "sequenceId", "versionLabel", "filename", "fileSizeBytes"],
            properties: {
              shotId: { type: "string" },
              projectId: { type: "string" },
              sequenceId: { type: "string" },
              context: { type: "string", maxLength: 64 },
              versionLabel: { type: "string", minLength: 1, maxLength: 64 },
              filename: { type: "string", minLength: 1, maxLength: 255 },
              contentType: { type: "string" },
              fileSizeBytes: { type: "integer", minimum: 1 },
              preferredPartSizeBytes: { type: "integer" },
              endpointId: { type: "string" },
              notes: { type: "string", maxLength: 2000 },
            },
          },
          response: {
            201: {
              type: "object",
              properties: {
                checkinId: { type: "string" },
                versionId: { type: "string" },
                versionNumber: { type: "integer" },
                context: { type: "string" },
                s3: {
                  type: "object",
                  properties: {
                    bucket: { type: "string" },
                    key: { type: "string" },
                    uploadId: { type: "string" },
                    parts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          partNumber: { type: "integer" },
                          presignedUrl: { type: "string" },
                          sizeBytes: { type: "integer" },
                        },
                      },
                    },
                  },
                },
                deadline: { type: "string" },
              },
            },
            400: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        // Validate filename
        const fnCheck = validateFilename(body.filename);
        if (!fnCheck.ok) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", fnCheck.message);
        }

        // Validate shot exists
        const shot = await persistence.getShotById(body.shotId);
        if (!shot) {
          return sendError(request, reply, 404, "NOT_FOUND", `Shot not found: ${body.shotId}`);
        }

        // Compute part plan
        let plan: { partSizeBytes: number; partCount: number };
        try {
          plan = computePartPlan(body.fileSizeBytes, body.preferredPartSizeBytes);
        } catch (e) {
          return sendError(
            request, reply, 400, "VALIDATION_ERROR",
            e instanceof Error ? e.message : String(e),
          );
        }

        // Resolve S3 endpoint
        const ep = resolveEndpoint(body.endpointId);
        if (!ep) {
          return sendError(
            request, reply, 503, "S3_NOT_CONFIGURED",
            "No S3 endpoint is configured. Set endpointId or configure endpoints in Platform Settings.",
          );
        }

        const context = body.context ?? "main";
        const actor = resolveActor(request);
        const correlationId = request.id;
        const txId = randomUUID();
        const writeCtx: WriteContext = { correlationId, now: new Date().toISOString() };

        // Reserve a Version row. The retry-on-conflict loop in insertVersion
        // + createVersion handles the (shot_id, context, version_number)
        // uniqueness race.
        const version = await persistence.createVersion(
          {
            shotId: body.shotId,
            projectId: body.projectId,
            sequenceId: body.sequenceId,
            versionLabel: body.versionLabel,
            status: "draft",
            mediaType: "mov", // best-effort; real media_type is learned from the file post-upload
            createdBy: actor,
            notes: body.notes,
            context,
          },
          writeCtx,
        );

        const storageKey = buildStorageKey(body, context, version.versionNumber);

        // Initiate S3 multipart upload
        setVastTlsSkip();
        const s3 = makeS3Client(ep);
        let uploadId: string;
        try {
          const resp = await s3.send(
            new CreateMultipartUploadCommand({
              Bucket: ep.bucket,
              Key: storageKey,
              ContentType: body.contentType ?? "application/octet-stream",
            }),
          );
          if (!resp.UploadId) {
            throw new Error("S3 CreateMultipartUpload returned no UploadId");
          }
          uploadId = resp.UploadId;
        } catch (e) {
          s3.destroy();
          restoreVastTls();
          // Compensate the Version reservation so we don't orphan it.
          await persistence.updateVersionStatus(version.id, "failed", writeCtx);
          return sendError(
            request, reply, 503, "S3_INITIATE_FAILED",
            e instanceof Error ? e.message : String(e),
          );
        }

        // Write compensation-log row FIRST so if we crash before presigning
        // parts, the reaper can still abort the multipart upload.
        await persistence.createS3CompensationLog(
          {
            txId,
            correlationId,
            s3Bucket: ep.bucket,
            s3Key: storageKey,
            operation: "CreateMultipartUpload",
            inverseOperation: "AbortMultipartUpload",
            inversePayload: { uploadId, endpointId: ep.id },
            actor,
          },
          writeCtx,
        );

        // Generate per-part presigned URLs
        const parts: CheckinReservation["s3"]["parts"] = [];
        try {
          for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
            const isLast = partNumber === plan.partCount;
            const sizeBytes = isLast
              ? body.fileSizeBytes - (plan.partCount - 1) * plan.partSizeBytes
              : plan.partSizeBytes;
            const url = await getSignedUrl(
              s3,
              new UploadPartCommand({
                Bucket: ep.bucket,
                Key: storageKey,
                UploadId: uploadId,
                PartNumber: partNumber,
              }),
              { expiresIn: 3600 },
            );
            parts.push({ partNumber, presignedUrl: url, sizeBytes });
          }
        } finally {
          s3.destroy();
          restoreVastTls();
        }

        // Create checkin state row
        const deadline = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
        const checkin = await persistence.createCheckin(
          {
            txId,
            versionId: version.id,
            shotId: body.shotId,
            projectId: body.projectId,
            sequenceId: body.sequenceId,
            context,
            s3Bucket: ep.bucket,
            s3Key: storageKey,
            s3UploadId: uploadId,
            partPlanJson: JSON.stringify({
              partSizeBytes: plan.partSizeBytes,
              partCount: plan.partCount,
              fileSizeBytes: body.fileSizeBytes,
              endpointId: ep.id,
              filename: body.filename,
            }),
            correlationId,
            actor,
            deadlineAt: deadline,
          },
          writeCtx,
        );

        const response: CheckinReservation = {
          checkinId: checkin.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          context,
          s3: {
            bucket: ep.bucket,
            key: storageKey,
            uploadId,
            parts,
          },
          deadline,
        };
        return reply.status(201).send(response);
      },
    );

    // ── POST /assets/checkin/:id/commit (finalize multipart + sentinel) ──
    app.post<{ Params: { id: string }; Body: CheckinCommitInput }>(
      withPrefix(prefix, "/assets/checkin/:id/commit"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}CommitCheckin`,
          summary: "Phase 2: complete multipart upload and write sentinel (atomic)",
          body: {
            type: "object",
            required: ["parts"],
            properties: {
              parts: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  required: ["partNumber", "eTag"],
                  properties: {
                    partNumber: { type: "integer", minimum: 1 },
                    eTag: { type: "string" },
                  },
                },
              },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                checkinId: { type: "string" },
                versionId: { type: "string" },
                committedAt: { type: "string" },
                sentinel: {
                  type: ["object", "null"],
                  properties: {
                    name: { type: "string" },
                    versionId: { type: "string" },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const checkin = await persistence.getCheckin(request.params.id);
        if (!checkin) {
          return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        }
        if (checkin.state !== "reserved") {
          return sendError(request, reply, 409, "INVALID_STATE", `Checkin is in state "${checkin.state}", not "reserved"`);
        }
        if (new Date(checkin.deadlineAt).getTime() < Date.now()) {
          return sendError(request, reply, 409, "EXPIRED", `Checkin deadline ${checkin.deadlineAt} has passed`);
        }

        const body = request.body;

        // Parse the stored part plan to validate client-submitted parts count
        let partPlan: { partCount: number; endpointId: string };
        try {
          partPlan = JSON.parse(checkin.partPlanJson);
        } catch {
          return sendError(request, reply, 500, "INTERNAL_ERROR", "Stored part plan is corrupt");
        }
        if (body.parts.length !== partPlan.partCount) {
          return sendError(
            request, reply, 400, "PART_COUNT_MISMATCH",
            `Expected ${partPlan.partCount} parts, got ${body.parts.length}`,
          );
        }

        const ep = resolveEndpoint(partPlan.endpointId);
        if (!ep) {
          return sendError(request, reply, 503, "S3_NOT_CONFIGURED", "Original S3 endpoint no longer configured");
        }

        const writeCtx: WriteContext = { correlationId: request.id, now: new Date().toISOString() };
        const actor = resolveActor(request);
        void actor;

        // Sort parts by partNumber (S3 requires this)
        const completedParts: CompletedPart[] = [...body.parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag }));

        setVastTlsSkip();
        const s3 = makeS3Client(ep);

        // ── CompleteMultipartUpload ──
        try {
          await s3.send(
            new CompleteMultipartUploadCommand({
              Bucket: checkin.s3Bucket,
              Key: checkin.s3Key,
              UploadId: checkin.s3UploadId,
              MultipartUpload: { Parts: completedParts },
            }),
          );
        } catch (e) {
          s3.destroy();
          restoreVastTls();
          const msg = e instanceof Error ? e.message : String(e);
          await persistence.updateCheckinState(
            checkin.id,
            { state: "compensating", lastError: msg },
            writeCtx,
          );
          // Try to run the AbortMultipartUpload compensation inline so we
          // don't leak the incomplete upload.
          await runCompensationInline(persistence, checkin.txId, writeCtx).catch(() => {});
          await persistence.updateCheckinState(
            checkin.id,
            { state: "aborted", abortedAt: new Date().toISOString() },
            writeCtx,
          );
          return sendError(request, reply, 503, "S3_COMPLETE_FAILED", msg);
        } finally {
          s3.destroy();
          restoreVastTls();
        }

        // ── Flip version to published + write sentinels ──
        try {
          await persistence.updateVersionStatus(checkin.versionId, "completed", writeCtx);
          await persistence.upsertVersionSentinel(
            checkin.shotId,
            checkin.context,
            "latest",
            checkin.versionId,
            writeCtx,
          );
          await persistence.markS3CompensationCommitted(checkin.txId, writeCtx);
          const committedAt = new Date().toISOString();
          await persistence.updateCheckinState(
            checkin.id,
            { state: "committed", committedAt },
            writeCtx,
          );

          return reply.send({
            checkinId: checkin.id,
            versionId: checkin.versionId,
            committedAt,
            sentinel: { name: "latest", versionId: checkin.versionId },
          });
        } catch (e) {
          // The S3 object was written successfully but DB flip failed.
          // We don't try to delete the S3 object here — it contains valid
          // data and can be reclaimed from the checkin row by an operator.
          // Mark the checkin as compensating for manual triage.
          const msg = e instanceof Error ? e.message : String(e);
          await persistence.updateCheckinState(
            checkin.id,
            { state: "compensating", lastError: msg },
            writeCtx,
          );
          return sendError(
            request, reply, 500, "POST_COMMIT_DB_FAILURE",
            `S3 object is committed but DB update failed: ${msg}. Operator intervention required.`,
          );
        }
      },
    );

    // ── POST /assets/checkin/:id/abort ──
    app.post<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/checkin/:id/abort"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}AbortCheckin`,
          summary: "Client-initiated abort of an in-flight check-in",
          response: {
            204: { type: "null" },
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const checkin = await persistence.getCheckin(request.params.id);
        if (!checkin) {
          return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        }
        if (checkin.state === "committed") {
          return sendError(request, reply, 409, "ALREADY_COMMITTED", "Cannot abort a committed check-in");
        }
        if (checkin.state === "aborted") {
          return reply.status(204).send();
        }

        const writeCtx: WriteContext = { correlationId: request.id, now: new Date().toISOString() };

        await runCompensationInline(persistence, checkin.txId, writeCtx);
        await persistence.updateVersionStatus(checkin.versionId, "failed", writeCtx);
        await persistence.updateCheckinState(
          checkin.id,
          { state: "aborted", abortedAt: new Date().toISOString() },
          writeCtx,
        );

        return reply.status(204).send();
      },
    );

    // ── GET /assets/checkin/:id ──
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/assets/checkin/:id"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}GetCheckinState`,
          summary: "Inspect the state of an in-flight or completed check-in",
          response: {
            200: {
              type: "object",
              properties: {
                checkinId: { type: "string" },
                versionId: { type: "string" },
                state: { type: "string", enum: ["reserved", "committed", "compensating", "aborted"] },
                s3: {
                  type: "object",
                  properties: {
                    bucket: { type: "string" },
                    key: { type: "string" },
                  },
                },
                deadline: { type: "string" },
                createdAt: { type: "string" },
                committedAt: { type: ["string", "null"] },
                abortedAt: { type: ["string", "null"] },
                lastError: { type: ["string", "null"] },
              },
            },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const checkin = await persistence.getCheckin(request.params.id);
        if (!checkin) {
          return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        }
        return {
          checkinId: checkin.id,
          versionId: checkin.versionId,
          state: checkin.state,
          s3: { bucket: checkin.s3Bucket, key: checkin.s3Key },
          deadline: checkin.deadlineAt,
          createdAt: checkin.createdAt,
          committedAt: checkin.committedAt,
          abortedAt: checkin.abortedAt,
          lastError: checkin.lastError,
        };
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Compensation runner — inline (synchronous) version used by /abort and by
// /commit's failure path so the client gets one deterministic response.
// The reaper worker (separate process, Phase 2 of the roadmap) reuses the
// same compensation log but runs asynchronously.
// ---------------------------------------------------------------------------

async function runCompensationInline(
  persistence: PersistenceAdapter,
  txId: string,
  writeCtx: WriteContext,
): Promise<void> {
  const rows = await persistence.listS3CompensationByTxId(txId);
  for (const row of rows) {
    if (row.status !== "pending") continue;
    try {
      await executeInverse(row);
      await persistence.markS3CompensationCompensated(row.id, writeCtx);
    } catch (e) {
      await persistence.markS3CompensationFailed(
        row.id,
        e instanceof Error ? e.message : String(e),
        writeCtx,
      );
    }
  }
}

async function executeInverse(row: {
  s3Bucket: string;
  s3Key: string;
  inverseOperation: string;
  inversePayload: Record<string, unknown> | null;
}): Promise<void> {
  if (row.inverseOperation === "noop") return;
  if (row.inverseOperation === "AbortMultipartUpload") {
    const endpointId = row.inversePayload?.endpointId as string | undefined;
    const uploadId = row.inversePayload?.uploadId as string | undefined;
    if (!uploadId) {
      throw new Error(`AbortMultipartUpload inverse missing uploadId`);
    }
    const ep = resolveEndpoint(endpointId);
    if (!ep) {
      throw new Error(`S3 endpoint not configured for compensation (endpointId=${endpointId ?? "default"})`);
    }
    setVastTlsSkip();
    const s3 = makeS3Client(ep);
    try {
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: row.s3Bucket,
          Key: row.s3Key,
          UploadId: uploadId,
        }),
      );
    } finally {
      s3.destroy();
      restoreVastTls();
    }
    return;
  }
  // DeleteObject + PutObject not needed for Phase 1 MVP — atomic-checkin
  // only writes multipart uploads. Add them in Phase 2 when single-shot
  // PutObject copy-in-place operations start using the compensation log.
  throw new Error(`Unsupported inverse_operation: ${row.inverseOperation}`);
}
