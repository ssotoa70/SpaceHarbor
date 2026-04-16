/**
 * Atomic media check-in — TACTIC BaseCheckin._execute() equivalent.
 *
 * ╔════════════════════════════════════════════════════════════════════╗
 * ║  STATUS: SCAFFOLD (Phase 1 of MAM readiness roadmap)               ║
 * ║                                                                    ║
 * ║  Endpoints, types, state machine, and compensation-log wiring      ║
 * ║  are in place. Multipart upload orchestration and sentinel writes  ║
 * ║  are stubbed with clear TODOs; full implementation lands in the    ║
 * ║  Phase 2 atomic-checkin completion PR.                             ║
 * ╚════════════════════════════════════════════════════════════════════╝
 *
 * Problem
 * -------
 * Today SpaceHarbor's ingest is a single INSERT plus an enqueued job.
 * A failed upload or mid-flight worker crash leaves orphan S3 objects
 * (no DB row) or orphan DB rows (no S3 object). Studios doing 10–100 GB
 * EXR sequence ingests hit this on every flaky connection.
 *
 * Design
 * ------
 * Two-call client protocol, one durable transaction boundary:
 *
 *   1. POST /assets/checkin
 *      ├─ Reserve versionId, allocate versionNumber (context-scoped)
 *      ├─ Initiate S3 multipart upload, get uploadId
 *      ├─ Generate presigned URLs for N parts (5 MB min, 10,000 max per VAST)
 *      ├─ Write s3_compensation_log rows (status=pending) for every part
 *      │  plus the AbortMultipartUpload inverse for the whole upload
 *      └─ Return { checkinId, versionId, uploadId, parts[], deadline }
 *
 *   2. POST /assets/checkin/:id/commit
 *      ├─ Client provides { parts: [{ partNumber, eTag }] } from S3 UploadPart
 *      │  responses (see pipeline engineer note: MUST use UploadPart response
 *      │  ETags, not cached client-side values — VAST firmware variance)
 *      ├─ S3 CompleteMultipartUpload with the provided part ETags
 *      ├─ Write Version row (already reserved in phase 1; this is the flip
 *      │  to status="completed")
 *      ├─ Upsert sentinel row (latest / current) under a single txn that
 *      │  either commits both or compensates via s3_compensation_log
 *      └─ Return { asset, version, sentinel }
 *
 *   Failure modes:
 *     - Client abandons between reserve and commit
 *       → reaper (separate worker) watches s3_compensation_log for rows
 *         older than `deadline` and issues AbortMultipartUpload
 *     - Commit fails mid-sentinel
 *       → compensation log replays the inverse ops to rollback S3 state
 *
 *   Why NOT expose sentinel-update as a third endpoint?
 *     A separate endpoint creates a failure window between "parts complete"
 *     and "sentinel written" with no durable rollback signal for the reaper.
 *     Collapsing commit+sentinel into a single transaction gives the client
 *     one success/failure response and the reaper one clear state machine.
 *     (See media-pipeline-specialist consultation 2026-04-16.)
 *
 * State machine
 * -------------
 *   reserved ─── commit success ──> committed
 *        │             │
 *        │             └─ sentinel write fails ──> compensating ──> aborted
 *        │
 *        └─ deadline passes without commit ──> reaped ──> aborted
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

// ---------------------------------------------------------------------------
// Types (client-facing)
// ---------------------------------------------------------------------------

export interface CheckinReserveInput {
  shotId: string;
  projectId: string;
  sequenceId: string;
  /** Parallel version stream. Defaults to "main". */
  context?: string;
  /** Human-friendly label (e.g. "v003_comp_final"). */
  versionLabel: string;
  /** Primary file being checked in. */
  filename: string;
  /** Content type for S3 Content-Type header. */
  contentType?: string;
  /** Total file size in bytes — used to pre-allocate parts. */
  fileSizeBytes: number;
  /** Optional part size override (default: auto-compute based on file size). */
  preferredPartSizeBytes?: number;
  /** Optional S3 endpoint ID to upload to. */
  endpointId?: string;
  /** Free-form release notes attached to the version. */
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
  /** Client must call /commit before this timestamp or the upload is aborted. */
  deadline: string;
}

export interface CheckinCommitInput {
  parts: Array<{
    partNumber: number;
    eTag: string;
  }>;
}

export interface CheckinCommitResult {
  checkinId: string;
  versionId: string;
  committedAt: string;
  sentinel: {
    name: "latest" | "current" | "approved";
    versionId: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Part sizing
// ---------------------------------------------------------------------------

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — AWS S3 / VAST minimum
const MAX_PARTS = 10_000;                    // AWS S3 / VAST maximum
const DEFAULT_PART_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB default

/**
 * Compute the part size and count for a given file size. Strategy:
 *  - Honor `preferred` if it's >= MIN_PART_SIZE_BYTES and keeps count <= MAX_PARTS
 *  - Otherwise use DEFAULT and scale up if the file would exceed MAX_PARTS
 */
export function computePartPlan(
  fileSizeBytes: number,
  preferred?: number,
): { partSizeBytes: number; partCount: number } {
  if (fileSizeBytes <= 0) {
    throw new Error("fileSizeBytes must be positive");
  }
  let partSize = Math.max(preferred ?? DEFAULT_PART_SIZE_BYTES, MIN_PART_SIZE_BYTES);
  let partCount = Math.ceil(fileSizeBytes / partSize);
  // Scale up part size if necessary so we stay under MAX_PARTS
  while (partCount > MAX_PARTS) {
    partSize *= 2;
    partCount = Math.ceil(fileSizeBytes / partSize);
  }
  return { partSizeBytes: partSize, partCount };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerCheckinRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    // ── POST /assets/checkin (phase 1: reserve + initiate multipart) ──
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
            501: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        // TODO(atomic-checkin, phase-2): implement
        //   1. Validate shot/sequence/project exist (persistence.getShotById etc.)
        //   2. Validate file extension via routes/upload.ts ALLOWED_EXTENSIONS
        //   3. Compute part plan via computePartPlan()
        //   4. Resolve S3 endpoint (getStorageEndpoints + endpointId)
        //   5. S3 CreateMultipartUpload → capture uploadId
        //   6. Write s3_compensation_log row with inverse_operation="AbortMultipartUpload"
        //      and inverse_payload={bucket, key, uploadId}
        //   7. Create Version row via persistence.createVersion with status="reserved"
        //      and context from input (defaults to "main")
        //   8. Per-part presigned URLs via getSignedUrl(UploadPartCommand, ...)
        //   9. Return CheckinReservation
        //
        // Until implemented, return 501 with a helpful pointer so callers know
        // this endpoint is scaffolded but not yet functional.
        return sendError(
          request,
          reply,
          501,
          "NOT_IMPLEMENTED",
          "Atomic check-in reserve is scaffolded but not yet implemented. "
            + "Tracked under Phase 2 of the MAM readiness roadmap "
            + "(docs/plans/2026-04-16-mam-readiness-phase1.md).",
          {
            phase: "reserve",
            plannedEndpoints: [
              "POST /assets/checkin",
              "POST /assets/checkin/:id/commit",
              "POST /assets/checkin/:id/abort",
              "GET /assets/checkin/:id",
            ],
          },
        );
      },
    );

    // ── POST /assets/checkin/:id/commit (phase 2: finalize multipart + sentinel) ──
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
            501: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        // TODO(atomic-checkin, phase-2): implement
        //   1. Load checkin state (TBD — probably a `checkins` table or a
        //      JSON blob in s3_compensation_log.inverse_payload)
        //   2. Call S3 CompleteMultipartUpload with parts[]
        //      NOTE: ETags MUST come from the client's UploadPart responses,
        //      not from cached presigned-url metadata. VAST firmware has
        //      shown variance here — see media-pipeline-specialist note.
        //   3. Flip s3_compensation_log status pending→committed for all rows
        //      attached to this tx_id
        //   4. Update Version row: status="published", publishedAt=now
        //   5. Upsert sentinel row (context-scoped, is_sentinel=true, sentinel_name="latest")
        //      pointing at the new versionId
        //   6. All DB writes share a single correlation_id for audit clarity
        //   7. On any failure: run compensation worker synchronously to unwind S3
        //      (same-process so the client gets one deterministic error)
        //   8. Return CheckinCommitResult
        return sendError(
          request,
          reply,
          501,
          "NOT_IMPLEMENTED",
          "Atomic check-in commit is scaffolded but not yet implemented.",
          { phase: "commit", checkinId: request.params.id },
        );
      },
    );

    // ── POST /assets/checkin/:id/abort (client-initiated abandon) ──
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
            501: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        // TODO(atomic-checkin, phase-2): implement
        //   1. Load checkin state
        //   2. Issue S3 AbortMultipartUpload
        //   3. Mark s3_compensation_log rows compensated=now
        //   4. Soft-delete the reserved Version row
        return sendError(
          request,
          reply,
          501,
          "NOT_IMPLEMENTED",
          "Atomic check-in abort is scaffolded but not yet implemented.",
          { checkinId: request.params.id },
        );
      },
    );

    // ── GET /assets/checkin/:id (inspect state for clients + reaper) ──
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
                state: {
                  type: "string",
                  enum: ["reserved", "committed", "compensating", "aborted"],
                },
                deadline: { type: "string" },
                createdAt: { type: "string" },
              },
            },
            404: errorEnvelopeSchema,
            501: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        // TODO(atomic-checkin, phase-2): implement
        return sendError(
          request,
          reply,
          501,
          "NOT_IMPLEMENTED",
          "Atomic check-in state inspection is scaffolded but not yet implemented.",
          { checkinId: request.params.id },
        );
      },
    );

    // Suppress "unused" lint — persistence is plumbed in so phase-2 can land
    // without touching the registration signature.
    void persistence;
  }
}
