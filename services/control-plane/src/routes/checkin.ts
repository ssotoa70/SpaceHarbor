/**
 * Atomic media check-in — TACTIC BaseCheckin._execute() equivalent.
 *
 * Two-call client protocol, one durable transaction boundary. Supports
 * multi-file version manifests (EXR sequences + sidecars, ProRes + timecode,
 * etc.) via a `files[]` array on reserve/commit. A single-file call (legacy
 * `filename` + `fileSizeBytes`) is equivalent to `files: [{ role: "primary", ... }]`
 * and remains supported for backward compatibility.
 *
 *   1. POST /assets/checkin { files: [{filename,role,fileSizeBytes,...}] }
 *      ├─ Reserve versionId, allocate versionNumber (context-scoped)
 *      ├─ For EACH file: S3 CreateMultipartUpload + per-part presigned URLs
 *      ├─ Write one s3_compensation_log row per file (pending,
 *      │  inverse=AbortMultipartUpload)
 *      ├─ Write checkins row in state="reserved" with part_plan_json
 *      │  containing the full files[] plan
 *      └─ Return { checkinId, versionId, files[], deadline }
 *
 *   2. POST /assets/checkin/:id/commit { files: [{role, parts:[{partNumber,eTag}]}] }
 *      ├─ Validate every file's part count matches the stored plan
 *      ├─ For EACH file: S3 CompleteMultipartUpload
 *      │  (parts sorted by partNumber — S3 requires it)
 *      ├─ On ANY file failure: inline compensation for ALL files in this tx,
 *      │  state=aborted, return 503
 *      ├─ On success: updateVersionStatus=completed,
 *      │  createVersionFiles([...]) — ONE row per file,
 *      │  upsertVersionSentinel("latest"),
 *      │  markS3CompensationCommitted(tx), state=committed
 *      ├─ Publish checkin.committed event onto the bus
 *      └─ Return { checkinId, versionId, committedAt, sentinel, files[] }
 *
 *   3. POST /assets/checkin/:id/abort
 *      ├─ Run inline compensation for all files (AbortMultipartUpload N times)
 *      ├─ Update version status=failed, state=aborted
 *      └─ Publish checkin.aborted event
 *
 *   4. GET /assets/checkin/:id
 *      └─ Inspect state for clients + reaper
 *
 *   Reaper (separate worker — land in Phase 3) watches checkins table for
 *   state=reserved AND deadline_at < now() and issues /abort automatically.
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
import type { PersistenceAdapter, WriteContext, VersionFileRole, VersionFileInput } from "../persistence/types.js";
import { getStorageEndpoints } from "./platform-settings.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";
import { eventBus } from "../events/bus.js";

// ---------------------------------------------------------------------------
// Types (client-facing)
// ---------------------------------------------------------------------------

const VALID_ROLES: VersionFileRole[] = ["primary", "sidecar", "proxy", "frame_range", "audio", "reference"];

export interface FileSpec {
  filename: string;
  role?: VersionFileRole;
  contentType?: string;
  fileSizeBytes: number;
  preferredPartSizeBytes?: number;
  frameRangeStart?: number;
  frameRangeEnd?: number;
  framePadding?: number;
}

export interface CheckinReserveInput {
  shotId: string;
  projectId: string;
  sequenceId: string;
  context?: string;
  versionLabel: string;
  notes?: string;
  endpointId?: string;
  /** Multi-file form (preferred). At most one may be role="primary". */
  files?: FileSpec[];
  /** Single-file form (legacy — equivalent to files:[{role:"primary", ...}]) */
  filename?: string;
  contentType?: string;
  fileSizeBytes?: number;
  preferredPartSizeBytes?: number;
}

export interface CheckinFileResponse {
  role: VersionFileRole;
  filename: string;
  s3: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; presignedUrl: string; sizeBytes: number }>;
  };
}

export interface CheckinReservation {
  checkinId: string;
  versionId: string;
  versionNumber: number;
  context: string;
  files: CheckinFileResponse[];
  deadline: string;
}

export interface CheckinCommitFileInput {
  role: VersionFileRole;
  filename?: string;
  parts: Array<{ partNumber: number; eTag: string }>;
}

export interface CheckinCommitInput {
  /** Multi-file form. Required when reserve used files[]. */
  files?: CheckinCommitFileInput[];
  /** Single-file form (legacy — applies to the one reserved file). */
  parts?: Array<{ partNumber: number; eTag: string }>;
}

// ---------------------------------------------------------------------------
// Internal stored plan (stuffed into checkins.part_plan_json)
// ---------------------------------------------------------------------------

interface StoredFilePlan {
  role: VersionFileRole;
  filename: string;
  contentType: string;
  fileSizeBytes: number;
  partSizeBytes: number;
  partCount: number;
  s3Bucket: string;
  s3Key: string;
  s3UploadId: string;
  frameRangeStart?: number;
  frameRangeEnd?: number;
  framePadding?: number;
}

interface StoredPlan {
  endpointId: string;
  files: StoredFilePlan[];
  /** schema version — bump when shape changes. */
  schema: 1;
}

// Legacy shape from Phase 1 single-file reservations. When we load a plan
// in the commit handler we migrate legacy → current shape in-memory.
interface LegacyPlan {
  partSizeBytes: number;
  partCount: number;
  fileSizeBytes: number;
  endpointId: string;
  filename: string;
}

function migrateLegacyPlan(
  checkin: { s3Bucket: string; s3Key: string; s3UploadId: string },
  legacy: LegacyPlan,
): StoredPlan {
  return {
    endpointId: legacy.endpointId,
    schema: 1,
    files: [
      {
        role: "primary",
        filename: legacy.filename,
        contentType: "application/octet-stream",
        fileSizeBytes: legacy.fileSizeBytes,
        partSizeBytes: legacy.partSizeBytes,
        partCount: legacy.partCount,
        s3Bucket: checkin.s3Bucket,
        s3Key: checkin.s3Key,
        s3UploadId: checkin.s3UploadId,
      },
    ],
  };
}

function parseStoredPlan(
  raw: string,
  checkin: { s3Bucket: string; s3Key: string; s3UploadId: string },
): StoredPlan | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const maybe = parsed as Partial<StoredPlan> & Partial<LegacyPlan>;
  if (maybe.schema === 1 && Array.isArray(maybe.files)) return maybe as StoredPlan;
  if (typeof maybe.filename === "string" && typeof maybe.partCount === "number") {
    return migrateLegacyPlan(checkin, maybe as LegacyPlan);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Part plan
// ---------------------------------------------------------------------------

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
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
    // SDK v3 3.729+ defaults inject x-amz-checksum-crc32=AAAAAA== into
    // presigned UploadPart URLs, which third-party clients can't recompute.
    // WHEN_REQUIRED keeps presigned URLs vanilla.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

// ---------------------------------------------------------------------------
// Filename safety
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
  ".pdf", ".doc", ".docx", ".ai", ".txt",
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

function buildStorageKey(
  input: CheckinReserveInput,
  context: string,
  versionNumber: number,
  filename: string,
): string {
  const ext = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, ext);
  return `assets/${input.projectId}/${input.shotId}/${context}/v${String(versionNumber).padStart(4, "0")}/${stem}${ext}`;
}

function resolveActor(request: FastifyRequest): string {
  const identity = (request as FastifyRequest & { identity?: string }).identity;
  return identity ?? "anonymous";
}

// Coerce reserve input to a normalized files[] array. Backwards-compatible
// with the legacy single-file form.
function normalizeFiles(body: CheckinReserveInput): FileSpec[] | { error: string } {
  if (body.files && body.files.length > 0) {
    if (body.filename || body.fileSizeBytes !== undefined) {
      return { error: "Cannot combine top-level filename/fileSizeBytes with files[]" };
    }
    // Exactly one "primary" is allowed; missing role defaults to "sidecar"
    // for indices > 0 and "primary" for index 0.
    const normalized = body.files.map((f, i) => ({
      ...f,
      role: f.role ?? (i === 0 ? "primary" : "sidecar"),
    }));
    const primaryCount = normalized.filter((f) => f.role === "primary").length;
    if (primaryCount > 1) return { error: "At most one file may have role=primary" };
    return normalized;
  }
  if (!body.filename || body.fileSizeBytes === undefined) {
    return { error: "Either files[] or (filename + fileSizeBytes) must be provided" };
  }
  return [
    {
      role: "primary",
      filename: body.filename,
      contentType: body.contentType,
      fileSizeBytes: body.fileSizeBytes,
      preferredPartSizeBytes: body.preferredPartSizeBytes,
    },
  ];
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const RESERVATION_TTL_MS = 60 * 60 * 1000;

export async function registerCheckinRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    // ── POST /assets/checkin (reserve + initiate multipart uploads) ──
    app.post<{ Body: CheckinReserveInput }>(
      withPrefix(prefix, "/assets/checkin"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}ReserveCheckin`,
          summary: "Reserve a version + initiate S3 multipart uploads for one or more files",
          body: {
            type: "object",
            required: ["shotId", "projectId", "sequenceId", "versionLabel"],
            properties: {
              shotId: { type: "string" },
              projectId: { type: "string" },
              sequenceId: { type: "string" },
              context: { type: "string", maxLength: 64 },
              versionLabel: { type: "string", minLength: 1, maxLength: 64 },
              notes: { type: "string", maxLength: 2000 },
              endpointId: { type: "string" },
              files: {
                type: "array",
                minItems: 1,
                maxItems: 500,
                items: {
                  type: "object",
                  required: ["filename", "fileSizeBytes"],
                  properties: {
                    filename: { type: "string", minLength: 1, maxLength: 512 },
                    role: { type: "string", enum: VALID_ROLES as readonly string[] },
                    contentType: { type: "string" },
                    fileSizeBytes: { type: "integer", minimum: 1 },
                    preferredPartSizeBytes: { type: "integer" },
                    frameRangeStart: { type: "integer" },
                    frameRangeEnd: { type: "integer" },
                    framePadding: { type: "integer" },
                  },
                },
              },
              filename: { type: "string", minLength: 1, maxLength: 255 },
              contentType: { type: "string" },
              fileSizeBytes: { type: "integer", minimum: 1 },
              preferredPartSizeBytes: { type: "integer" },
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
                deadline: { type: "string" },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      filename: { type: "string" },
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
                    },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        const shot = await persistence.getShotById(body.shotId);
        if (!shot) {
          return sendError(request, reply, 404, "NOT_FOUND", `Shot not found: ${body.shotId}`);
        }

        const normalized = normalizeFiles(body);
        if ("error" in normalized) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", normalized.error);
        }

        // Validate each filename + compute part plans
        const plans: Array<Omit<StoredFilePlan, "s3Bucket" | "s3Key" | "s3UploadId">> = [];
        for (const f of normalized) {
          const chk = validateFilename(f.filename);
          if (!chk.ok) return sendError(request, reply, 400, "VALIDATION_ERROR", chk.message);
          try {
            const pp = computePartPlan(f.fileSizeBytes, f.preferredPartSizeBytes);
            plans.push({
              role: f.role as VersionFileRole,
              filename: f.filename,
              contentType: f.contentType ?? "application/octet-stream",
              fileSizeBytes: f.fileSizeBytes,
              partSizeBytes: pp.partSizeBytes,
              partCount: pp.partCount,
              frameRangeStart: f.frameRangeStart,
              frameRangeEnd: f.frameRangeEnd,
              framePadding: f.framePadding,
            });
          } catch (e) {
            return sendError(request, reply, 400, "VALIDATION_ERROR",
              e instanceof Error ? e.message : String(e));
          }
        }

        const ep = resolveEndpoint(body.endpointId);
        if (!ep) {
          return sendError(request, reply, 503, "S3_NOT_CONFIGURED",
            "No S3 endpoint is configured. Configure endpoints in Platform Settings.");
        }

        const context = body.context ?? "main";
        const actor = resolveActor(request);
        const correlationId = request.id;
        const txId = randomUUID();
        const writeCtx: WriteContext = { correlationId, now: new Date().toISOString() };

        // Reserve version row (context-scoped, race-safe via insertVersion retry)
        const primaryFilename = plans.find((p) => p.role === "primary")?.filename ?? plans[0].filename;
        const mediaType = inferMediaType(primaryFilename);
        const version = await persistence.createVersion(
          {
            shotId: body.shotId,
            projectId: body.projectId,
            sequenceId: body.sequenceId,
            versionLabel: body.versionLabel,
            status: "draft",
            mediaType,
            createdBy: actor,
            notes: body.notes,
            context,
          },
          writeCtx,
        );

        // For each file: CreateMultipartUpload + compensation log + part presigned URLs
        setVastTlsSkip();
        const s3 = makeS3Client(ep);
        const files: StoredFilePlan[] = [];
        const responseFiles: CheckinFileResponse[] = [];

        try {
          for (const plan of plans) {
            const key = buildStorageKey(body, context, version.versionNumber, plan.filename);

            let uploadId: string;
            try {
              const resp = await s3.send(
                new CreateMultipartUploadCommand({
                  Bucket: ep.bucket,
                  Key: key,
                  ContentType: plan.contentType,
                }),
              );
              if (!resp.UploadId) throw new Error("S3 CreateMultipartUpload returned no UploadId");
              uploadId = resp.UploadId;
            } catch (e) {
              // Roll back any multipart uploads already opened in this reserve call
              for (const opened of files) {
                try {
                  await s3.send(new AbortMultipartUploadCommand({
                    Bucket: opened.s3Bucket,
                    Key: opened.s3Key,
                    UploadId: opened.s3UploadId,
                  }));
                } catch { /* best-effort */ }
              }
              await persistence.updateVersionStatus(version.id, "failed", writeCtx);
              return sendError(request, reply, 503, "S3_INITIATE_FAILED",
                e instanceof Error ? e.message : String(e));
            }

            // Write compensation log row FIRST so reaper can clean up even if
            // we crash before presigning completes.
            await persistence.createS3CompensationLog(
              {
                txId,
                correlationId,
                s3Bucket: ep.bucket,
                s3Key: key,
                operation: "CreateMultipartUpload",
                inverseOperation: "AbortMultipartUpload",
                inversePayload: { uploadId, endpointId: ep.id, role: plan.role, filename: plan.filename },
                actor,
              },
              writeCtx,
            );

            const parts: CheckinFileResponse["s3"]["parts"] = [];
            for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
              const isLast = partNumber === plan.partCount;
              const sizeBytes = isLast
                ? plan.fileSizeBytes - (plan.partCount - 1) * plan.partSizeBytes
                : plan.partSizeBytes;
              const url = await getSignedUrl(
                s3,
                new UploadPartCommand({
                  Bucket: ep.bucket,
                  Key: key,
                  UploadId: uploadId,
                  PartNumber: partNumber,
                }),
                { expiresIn: 3600 },
              );
              parts.push({ partNumber, presignedUrl: url, sizeBytes });
            }

            const stored: StoredFilePlan = {
              ...plan,
              s3Bucket: ep.bucket,
              s3Key: key,
              s3UploadId: uploadId,
            };
            files.push(stored);
            responseFiles.push({
              role: plan.role,
              filename: plan.filename,
              s3: { bucket: ep.bucket, key, uploadId, parts },
            });
          }
        } finally {
          s3.destroy();
          restoreVastTls();
        }

        // Create checkin state row
        const deadline = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
        const storedPlan: StoredPlan = { endpointId: ep.id, schema: 1, files };
        const primaryFile = files.find((f) => f.role === "primary") ?? files[0];
        const checkin = await persistence.createCheckin(
          {
            txId,
            versionId: version.id,
            shotId: body.shotId,
            projectId: body.projectId,
            sequenceId: body.sequenceId,
            context,
            // s3_bucket/key/upload_id on the checkin row carry the PRIMARY file
            // for backward-compat with tooling that expects one file per checkin.
            s3Bucket: primaryFile.s3Bucket,
            s3Key: primaryFile.s3Key,
            s3UploadId: primaryFile.s3UploadId,
            partPlanJson: JSON.stringify(storedPlan),
            correlationId,
            actor,
            deadlineAt: deadline,
          },
          writeCtx,
        );

        eventBus.publish({
          type: "checkin.reserved",
          subject: `checkin:${checkin.id}`,
          data: {
            checkinId: checkin.id,
            versionId: version.id,
            shotId: body.shotId,
            projectId: body.projectId,
            fileCount: files.length,
          },
          actor,
          correlationId,
        });

        const response: CheckinReservation = {
          checkinId: checkin.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          context,
          files: responseFiles,
          deadline,
        };
        return reply.status(201).send(response);
      },
    );

    // ── POST /assets/checkin/:id/commit ──
    app.post<{ Params: { id: string }; Body: CheckinCommitInput }>(
      withPrefix(prefix, "/assets/checkin/:id/commit"),
      {
        schema: {
          tags: ["checkin"],
          operationId: `${opPrefix}CommitCheckin`,
          summary: "Complete all multipart uploads and write version manifest (atomic)",
          body: {
            type: "object",
            properties: {
              files: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  required: ["role", "parts"],
                  properties: {
                    role: { type: "string", enum: VALID_ROLES as readonly string[] },
                    filename: { type: "string" },
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
              },
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
                  properties: { name: { type: "string" }, versionId: { type: "string" } },
                },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      role: { type: "string" },
                      filename: { type: "string" },
                      s3Key: { type: "string" },
                    },
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
        if (!checkin) return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        if (checkin.state !== "reserved") {
          return sendError(request, reply, 409, "INVALID_STATE", `Checkin is in state "${checkin.state}", not "reserved"`);
        }
        if (new Date(checkin.deadlineAt).getTime() < Date.now()) {
          return sendError(request, reply, 409, "EXPIRED", `Checkin deadline ${checkin.deadlineAt} has passed`);
        }

        const storedPlan = parseStoredPlan(checkin.partPlanJson, checkin);
        if (!storedPlan) {
          return sendError(request, reply, 500, "INTERNAL_ERROR", "Stored part plan is corrupt");
        }

        // Normalize the client's commit body to per-file parts
        const commitEntries = normalizeCommitBody(request.body, storedPlan);
        if ("error" in commitEntries) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", commitEntries.error);
        }

        // Validate part counts
        for (const entry of commitEntries) {
          if (entry.parts.length !== entry.planned.partCount) {
            return sendError(request, reply, 400, "PART_COUNT_MISMATCH",
              `${entry.planned.role} (${entry.planned.filename}): expected ${entry.planned.partCount} parts, got ${entry.parts.length}`);
          }
        }

        const ep = resolveEndpoint(storedPlan.endpointId);
        if (!ep) {
          return sendError(request, reply, 503, "S3_NOT_CONFIGURED", "Original S3 endpoint no longer configured");
        }

        const writeCtx: WriteContext = { correlationId: request.id, now: new Date().toISOString() };
        const actor = resolveActor(request);

        setVastTlsSkip();
        const s3 = makeS3Client(ep);

        // ── CompleteMultipartUpload for each file (serial) ──
        // On first failure, abort; inline compensation unwinds ALL files.
        try {
          for (const entry of commitEntries) {
            const sortedParts: CompletedPart[] = [...entry.parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag }));
            try {
              await s3.send(
                new CompleteMultipartUploadCommand({
                  Bucket: entry.planned.s3Bucket,
                  Key: entry.planned.s3Key,
                  UploadId: entry.planned.s3UploadId,
                  MultipartUpload: { Parts: sortedParts },
                }),
              );
            } catch (e) {
              s3.destroy();
              restoreVastTls();
              const msg = e instanceof Error ? e.message : String(e);
              await persistence.updateCheckinState(checkin.id, { state: "compensating", lastError: msg }, writeCtx);
              await runCompensationInline(persistence, checkin.txId, writeCtx).catch(() => {});
              await persistence.updateCheckinState(checkin.id, { state: "aborted", abortedAt: new Date().toISOString() }, writeCtx);
              eventBus.publish({
                type: "checkin.failed",
                subject: `checkin:${checkin.id}`,
                data: { checkinId: checkin.id, versionId: checkin.versionId, failedFile: entry.planned.filename, error: msg },
                actor,
                correlationId: request.id,
              });
              return sendError(request, reply, 503, "S3_COMPLETE_FAILED", `${entry.planned.filename}: ${msg}`);
            }
          }
        } finally {
          s3.destroy();
          restoreVastTls();
        }

        // ── Write version_files + flip version + sentinel (atomic intent) ──
        try {
          const versionFileInputs: VersionFileInput[] = storedPlan.files.map((f) => ({
            versionId: checkin.versionId,
            role: f.role,
            filename: f.filename,
            s3Bucket: f.s3Bucket,
            s3Key: f.s3Key,
            contentType: f.contentType,
            sizeBytes: f.fileSizeBytes,
            frameRangeStart: f.frameRangeStart,
            frameRangeEnd: f.frameRangeEnd,
            framePadding: f.framePadding,
            checkinId: checkin.id,
          }));
          const createdFiles = await persistence.createVersionFiles(versionFileInputs, writeCtx);

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

          eventBus.publish({
            type: "checkin.committed",
            subject: `version:${checkin.versionId}`,
            data: {
              checkinId: checkin.id,
              versionId: checkin.versionId,
              shotId: checkin.shotId,
              projectId: checkin.projectId,
              context: checkin.context,
              fileCount: createdFiles.length,
              files: createdFiles.map((f) => ({ role: f.role, filename: f.filename, s3Key: f.s3Key })),
            },
            actor,
            correlationId: request.id,
          });

          return reply.send({
            checkinId: checkin.id,
            versionId: checkin.versionId,
            committedAt,
            sentinel: { name: "latest", versionId: checkin.versionId },
            files: createdFiles.map((f) => ({ id: f.id, role: f.role, filename: f.filename, s3Key: f.s3Key })),
          });
        } catch (e) {
          // S3 is committed but DB update failed. Mark for triage — do not
          // delete S3 objects (they contain valid data).
          const msg = e instanceof Error ? e.message : String(e);
          await persistence.updateCheckinState(checkin.id, { state: "compensating", lastError: msg }, writeCtx);
          eventBus.publish({
            type: "checkin.failed",
            subject: `checkin:${checkin.id}`,
            data: { checkinId: checkin.id, versionId: checkin.versionId, error: msg, phase: "post-commit-db" },
            actor,
            correlationId: request.id,
          });
          return sendError(request, reply, 500, "POST_COMMIT_DB_FAILURE",
            `S3 objects committed but DB update failed: ${msg}. Operator intervention required.`);
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
        if (!checkin) return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        if (checkin.state === "committed") {
          return sendError(request, reply, 409, "ALREADY_COMMITTED", "Cannot abort a committed check-in");
        }
        if (checkin.state === "aborted") return reply.status(204).send();

        const writeCtx: WriteContext = { correlationId: request.id, now: new Date().toISOString() };
        const actor = resolveActor(request);

        await runCompensationInline(persistence, checkin.txId, writeCtx);
        await persistence.updateVersionStatus(checkin.versionId, "failed", writeCtx);
        await persistence.updateCheckinState(
          checkin.id,
          { state: "aborted", abortedAt: new Date().toISOString() },
          writeCtx,
        );

        eventBus.publish({
          type: "checkin.aborted",
          subject: `checkin:${checkin.id}`,
          data: { checkinId: checkin.id, versionId: checkin.versionId },
          actor,
          correlationId: request.id,
        });

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
          summary: "Inspect an in-flight or completed check-in",
          response: {
            200: {
              type: "object",
              properties: {
                checkinId: { type: "string" },
                versionId: { type: "string" },
                state: { type: "string", enum: ["reserved", "committed", "compensating", "aborted"] },
                s3: { type: "object", properties: { bucket: { type: "string" }, key: { type: "string" } } },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      role: { type: "string" },
                      filename: { type: "string" },
                      s3Bucket: { type: "string" },
                      s3Key: { type: "string" },
                      partCount: { type: "integer" },
                      fileSizeBytes: { type: "integer" },
                    },
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
        if (!checkin) return sendError(request, reply, 404, "NOT_FOUND", `Checkin not found: ${request.params.id}`);
        const plan = parseStoredPlan(checkin.partPlanJson, checkin);
        return {
          checkinId: checkin.id,
          versionId: checkin.versionId,
          state: checkin.state,
          s3: { bucket: checkin.s3Bucket, key: checkin.s3Key },
          files: (plan?.files ?? []).map((f) => ({
            role: f.role,
            filename: f.filename,
            s3Bucket: f.s3Bucket,
            s3Key: f.s3Key,
            partCount: f.partCount,
            fileSizeBytes: f.fileSizeBytes,
          })),
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
// Normalize commit body
// ---------------------------------------------------------------------------

interface NormalizedCommitEntry {
  planned: StoredFilePlan;
  parts: Array<{ partNumber: number; eTag: string }>;
}

function normalizeCommitBody(
  body: CheckinCommitInput,
  plan: StoredPlan,
): NormalizedCommitEntry[] | { error: string } {
  if (body.files && body.files.length > 0) {
    if (body.parts) return { error: "Cannot combine top-level parts[] with files[]" };
    const entries: NormalizedCommitEntry[] = [];
    const remaining = new Set(plan.files.map((f) => f.role));
    for (const clientEntry of body.files) {
      const planned =
        plan.files.find((f) => f.role === clientEntry.role && (!clientEntry.filename || f.filename === clientEntry.filename));
      if (!planned) {
        return { error: `No planned file matches role=${clientEntry.role}${clientEntry.filename ? ` filename=${clientEntry.filename}` : ""}` };
      }
      remaining.delete(planned.role);
      entries.push({ planned, parts: clientEntry.parts });
    }
    if (remaining.size > 0) {
      return { error: `Missing commit entries for roles: ${[...remaining].join(", ")}` };
    }
    return entries;
  }
  if (body.parts) {
    if (plan.files.length !== 1) {
      return { error: `Legacy top-level parts[] only valid for single-file check-ins (have ${plan.files.length})` };
    }
    return [{ planned: plan.files[0], parts: body.parts }];
  }
  return { error: "Either files[] or parts[] must be provided" };
}

// ---------------------------------------------------------------------------
// Media-type heuristic (used for Version.mediaType at reserve time; the
// actual MediaType is learned post-upload by DataEngine metadata extraction)
// ---------------------------------------------------------------------------

function inferMediaType(filename: string): "mov" | "exr_sequence" | "dpx" | "audio" | "vdb" | "usd" | "plate" | "mtlx" {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mov" || ext === ".mp4" || ext === ".mxf" || ext === ".avi" || ext === ".mkv" || ext === ".webm") return "mov";
  if (ext === ".exr") return "exr_sequence";
  if (ext === ".dpx") return "dpx";
  if (ext === ".tiff" || ext === ".tif" || ext === ".png" || ext === ".jpg" || ext === ".jpeg") return "plate";
  if (ext === ".wav" || ext === ".aif" || ext === ".aiff" || ext === ".mp3" || ext === ".flac" || ext === ".ogg") return "audio";
  if (ext === ".vdb") return "vdb";
  if (ext === ".usd" || ext === ".usda" || ext === ".usdc" || ext === ".usdz") return "usd";
  if (ext === ".mtlx") return "mtlx";
  // Fallback: treat anything else as a plate (safest since "mov" is the other
  // common catch-all and would mislead downstream DataEngine routing).
  return "plate";
}

// ---------------------------------------------------------------------------
// Compensation runner — iterates all compensation rows for a tx_id.
// Works for multi-file check-ins: each file's AbortMultipartUpload is a
// separate row with its own inverse_payload.
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
    if (!uploadId) throw new Error(`AbortMultipartUpload inverse missing uploadId`);
    const ep = resolveEndpoint(endpointId);
    if (!ep) throw new Error(`S3 endpoint not configured for compensation (endpointId=${endpointId ?? "default"})`);
    setVastTlsSkip();
    const s3 = makeS3Client(ep);
    try {
      await s3.send(
        new AbortMultipartUploadCommand({ Bucket: row.s3Bucket, Key: row.s3Key, UploadId: uploadId }),
      );
    } finally {
      s3.destroy();
      restoreVastTls();
    }
    return;
  }
  throw new Error(`Unsupported inverse_operation: ${row.inverseOperation}`);
}
