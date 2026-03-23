/**
 * VastWorkflowClientImpl — Trino-backed implementation of VastWorkflowClient.
 *
 * All workflow state (jobs, assets, queue, DLQ, outbox, audit, events, incidents)
 * is persisted in VAST Database via Trino SQL. No in-memory state survives restart.
 */

import { randomUUID } from "node:crypto";
import type { TrinoClient, TrinoQueryResult } from "../../db/trino-client.js";
import type {
  Asset,
  AuditEvent,
  AuditSignal,
  DlqItem,
  IngestResult,
  OutboxItem,
  WorkflowJob,
  WorkflowStatus,
  AnnotationHookMetadata,
  HandoffChecklistMetadata,
  HandoffMetadata,
  AssetThumbnailPreview,
  AssetProxyPreview,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentNote,
  ApprovalAuditEntry,
  AssetQueueRow,
  ProductionMetadata
} from "../../domain/models.js";
import type { DccAuditEntry } from "../../types/dcc.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import type {
  AuditRetentionApplyResult,
  AuditRetentionPreview,
  FailureResult,
  IngestInput,
  WriteContext
} from "../types.js";
import type { VastWorkflowClient } from "./workflow-client.js";

const S = 'vast."spaceharbor/production"';

// ---------------------------------------------------------------------------
// SQL value escaping (matching vast-trino-queries.ts conventions)
// ---------------------------------------------------------------------------

function esc(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function escNum(val: number | null | undefined): string {
  if (val == null) return "NULL";
  return String(val);
}

function escTimestamp(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `TIMESTAMP '${val.replace(/'/g, "''")}'`;
}

function escBool(val: boolean): string {
  return val ? "TRUE" : "FALSE";
}

function escJson(val: unknown): string {
  if (val == null) return "NULL";
  return esc(JSON.stringify(val));
}

// ---------------------------------------------------------------------------
// Row-to-column helpers
// ---------------------------------------------------------------------------

function colIndex(result: TrinoQueryResult, name: string): number {
  return result.columns.findIndex((c) => c.name === name);
}

function getVal<T = unknown>(row: unknown[], result: TrinoQueryResult, name: string): T | null {
  const idx = colIndex(result, name);
  if (idx < 0) return null;
  return (row[idx] as T) ?? null;
}

function getStr(row: unknown[], r: TrinoQueryResult, name: string): string | null {
  return getVal<string>(row, r, name);
}

function getNum(row: unknown[], r: TrinoQueryResult, name: string): number | null {
  const v = getVal<number>(row, r, name);
  return v != null ? Number(v) : null;
}

function getReqStr(row: unknown[], r: TrinoQueryResult, name: string): string {
  return getStr(row, r, name) ?? "";
}

function getReqNum(row: unknown[], r: TrinoQueryResult, name: string): number {
  return getNum(row, r, name) ?? 0;
}

function getBool(row: unknown[], r: TrinoQueryResult, name: string): boolean {
  const v = getVal<boolean>(row, r, name);
  return v === true;
}

function parseJsonCol<T>(row: unknown[], r: TrinoQueryResult, name: string): T | null {
  const raw = getStr(row, r, name);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

const DEFAULT_ANNOTATION_HOOK: AnnotationHookMetadata = {
  enabled: false,
  provider: null,
  contextId: null
};

const DEFAULT_HANDOFF_CHECKLIST: HandoffChecklistMetadata = {
  releaseNotesReady: false,
  verificationComplete: false,
  commsDraftReady: false,
  ownerAssigned: false
};

const DEFAULT_HANDOFF: HandoffMetadata = {
  status: "not_ready",
  owner: null,
  lastUpdatedAt: null
};

function mapRowToAsset(row: unknown[], r: TrinoQueryResult): Asset {
  return {
    id: getReqStr(row, r, "id"),
    title: getReqStr(row, r, "title"),
    sourceUri: getReqStr(row, r, "source_uri"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getStr(row, r, "updated_at") ?? undefined,
    metadata: parseJsonCol(row, r, "metadata") ?? undefined,
    version: parseJsonCol(row, r, "version_info") ?? undefined,
    integrity: parseJsonCol(row, r, "integrity") ?? undefined,
    shotId: getStr(row, r, "shot_id") ?? undefined,
    projectId: getStr(row, r, "project_id") ?? undefined,
    versionLabel: getStr(row, r, "version_label") ?? undefined,
    review_uri: getStr(row, r, "review_uri") ?? undefined
  };
}

function mapRowToJob(row: unknown[], r: TrinoQueryResult): WorkflowJob {
  return {
    id: getReqStr(row, r, "id"),
    assetId: getReqStr(row, r, "asset_id"),
    sourceUri: getReqStr(row, r, "source_uri"),
    status: (getStr(row, r, "status") ?? "pending") as WorkflowStatus,
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at"),
    lastError: getStr(row, r, "last_error"),
    attemptCount: getReqNum(row, r, "attempt_count"),
    maxAttempts: getReqNum(row, r, "max_attempts"),
    nextAttemptAt: getStr(row, r, "next_attempt_at"),
    leaseOwner: getStr(row, r, "lease_owner"),
    leaseExpiresAt: getStr(row, r, "lease_expires_at"),
    thumbnail: parseJsonCol<AssetThumbnailPreview>(row, r, "thumbnail"),
    proxy: parseJsonCol<AssetProxyPreview>(row, r, "proxy"),
    annotationHook: parseJsonCol<AnnotationHookMetadata>(row, r, "annotation_hook") ?? DEFAULT_ANNOTATION_HOOK,
    handoffChecklist: parseJsonCol<HandoffChecklistMetadata>(row, r, "handoff_checklist") ?? { ...DEFAULT_HANDOFF_CHECKLIST },
    handoff: parseJsonCol<HandoffMetadata>(row, r, "handoff") ?? { ...DEFAULT_HANDOFF }
  };
}

function mapRowToDlqItem(row: unknown[], r: TrinoQueryResult): DlqItem {
  return {
    id: getReqStr(row, r, "id"),
    jobId: getReqStr(row, r, "job_id"),
    assetId: getReqStr(row, r, "asset_id"),
    error: getReqStr(row, r, "error"),
    attemptCount: getReqNum(row, r, "attempt_count"),
    failedAt: getReqStr(row, r, "failed_at")
  };
}

function mapRowToOutboxItem(row: unknown[], r: TrinoQueryResult): OutboxItem {
  return {
    id: getReqStr(row, r, "id"),
    eventType: getReqStr(row, r, "event_type"),
    correlationId: getReqStr(row, r, "correlation_id"),
    payload: parseJsonCol<Record<string, unknown>>(row, r, "payload") ?? {},
    createdAt: getReqStr(row, r, "created_at"),
    publishedAt: getStr(row, r, "published_at")
  };
}

function mapRowToAuditEvent(row: unknown[], r: TrinoQueryResult): AuditEvent {
  return {
    id: getReqStr(row, r, "id"),
    message: getReqStr(row, r, "message"),
    at: getReqStr(row, r, "at"),
    signal: parseJsonCol<AuditSignal>(row, r, "signal") ?? undefined
  };
}

// ---------------------------------------------------------------------------
// Default max attempts (matches local-persistence)
// ---------------------------------------------------------------------------

function parseMaxAttempts(): number {
  const raw = process.env.SPACEHARBOR_MAX_JOB_ATTEMPTS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) return parsed;
  }
  return 3;
}

const DEFAULT_MAX_ATTEMPTS = parseMaxAttempts();

// ---------------------------------------------------------------------------
// Exported CAS conflict error
// ---------------------------------------------------------------------------

export class CasConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CasConflictError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class VastWorkflowClientImpl implements VastWorkflowClient {
  constructor(private readonly trino: TrinoClient) {}

  // -------------------------------------------------------------------------
  // createIngestAsset
  // -------------------------------------------------------------------------

  async createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult> {
    const now = this.resolveNow(context);
    const nowIso = now.toISOString();

    const asset: Asset = {
      id: randomUUID(),
      title: input.title,
      sourceUri: input.sourceUri,
      createdAt: nowIso,
      ...(input.shotId !== undefined && { shotId: input.shotId }),
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.versionLabel !== undefined && { versionLabel: input.versionLabel })
    };

    const job: WorkflowJob = {
      id: randomUUID(),
      assetId: asset.id,
      sourceUri: input.sourceUri,
      status: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
      lastError: null,
      attemptCount: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: nowIso,
      leaseOwner: null,
      leaseExpiresAt: null,
      thumbnail: null,
      proxy: null,
      annotationHook: input.annotationHook ?? DEFAULT_ANNOTATION_HOOK,
      handoffChecklist: { ...DEFAULT_HANDOFF_CHECKLIST },
      handoff: { ...DEFAULT_HANDOFF }
    };

    // Insert asset
    await this.trino.query(`INSERT INTO ${S}.assets (
      id, title, source_uri, shot_id, project_id, version_label, review_uri,
      metadata, version_info, integrity, created_at, updated_at
    ) VALUES (
      ${esc(asset.id)}, ${esc(asset.title)}, ${esc(asset.sourceUri)},
      ${esc(asset.shotId ?? null)}, ${esc(asset.projectId ?? null)},
      ${esc(asset.versionLabel ?? null)}, NULL, NULL, NULL, NULL,
      ${escTimestamp(nowIso)}, NULL
    )`);

    // Insert job
    await this.trino.query(`INSERT INTO ${S}.jobs (
      id, asset_id, source_uri, status, attempt_count, max_attempts,
      last_error, next_attempt_at, lease_owner, lease_expires_at,
      thumbnail, proxy, annotation_hook, handoff_checklist, handoff,
      created_at, updated_at
    ) VALUES (
      ${esc(job.id)}, ${esc(job.assetId)}, ${esc(job.sourceUri)},
      ${esc(job.status)}, ${escNum(job.attemptCount)}, ${escNum(job.maxAttempts)},
      NULL, ${escTimestamp(nowIso)}, NULL, NULL,
      NULL, NULL, ${escJson(job.annotationHook)},
      ${escJson(job.handoffChecklist)}, ${escJson(job.handoff)},
      ${escTimestamp(nowIso)}, ${escTimestamp(nowIso)}
    )`);

    // Insert queue entry
    await this.trino.query(`INSERT INTO ${S}.queue (
      job_id, asset_id, available_at, lease_owner, lease_expires_at
    ) VALUES (
      ${esc(job.id)}, ${esc(asset.id)}, ${escTimestamp(nowIso)}, NULL, NULL
    )`);

    // Audit + outbox
    await this.insertAuditEvent(`asset registered: ${asset.title}`, context.correlationId, nowIso);
    await this.insertOutboxItem(
      "media.process.requested.v1",
      context.correlationId,
      { assetId: asset.id, jobId: job.id, title: asset.title, sourceUri: asset.sourceUri },
      nowIso
    );

    return { asset, job };
  }

  // -------------------------------------------------------------------------
  // getAssetById
  // -------------------------------------------------------------------------

  async getAssetById(assetId: string): Promise<Asset | null> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.assets WHERE id = ${esc(assetId)}`
    );
    if (r.data.length === 0) return null;
    return mapRowToAsset(r.data[0], r);
  }

  // -------------------------------------------------------------------------
  // updateAsset
  // -------------------------------------------------------------------------

  async updateAsset(
    assetId: string,
    updates: Partial<Pick<Asset, "metadata" | "version" | "integrity">>,
    context: WriteContext
  ): Promise<Asset | null> {
    const existing = await this.getAssetById(assetId);
    if (!existing) return null;

    const nowIso = this.resolveNow(context).toISOString();
    const newMetadata = updates.metadata !== undefined
      ? { ...existing.metadata, ...updates.metadata }
      : existing.metadata;
    const newVersion = updates.version !== undefined ? updates.version : existing.version;
    const newIntegrity = updates.integrity !== undefined ? updates.integrity : existing.integrity;

    await this.trino.query(`UPDATE ${S}.assets SET
      metadata = ${escJson(newMetadata)},
      version_info = ${escJson(newVersion)},
      integrity = ${escJson(newIntegrity)},
      updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(assetId)}`);

    await this.insertAuditEvent(`asset ${assetId} metadata updated`, context.correlationId, nowIso);

    return {
      ...existing,
      updatedAt: nowIso,
      metadata: newMetadata,
      version: newVersion,
      integrity: newIntegrity
    };
  }

  // -------------------------------------------------------------------------
  // setJobStatus
  // -------------------------------------------------------------------------

  async setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): Promise<WorkflowJob | null> {
    const existing = await this.getJobById(jobId);
    if (!existing) return null;
    if (!canTransitionWorkflowStatus(existing.status, status)) return null;

    const nowIso = this.resolveNow(context).toISOString();

    const updated: WorkflowJob = {
      ...existing,
      status,
      lastError: lastError ?? existing.lastError,
      updatedAt: nowIso,
      leaseOwner: status === "processing" ? existing.leaseOwner : null,
      leaseExpiresAt: status === "processing" ? existing.leaseExpiresAt : null,
      nextAttemptAt: status === "pending" ? nowIso : existing.nextAttemptAt
    };

    await this.trino.query(`UPDATE ${S}.jobs SET
      status = ${esc(updated.status)},
      last_error = ${esc(updated.lastError)},
      lease_owner = ${esc(updated.leaseOwner)},
      lease_expires_at = ${escTimestamp(updated.leaseExpiresAt)},
      next_attempt_at = ${escTimestamp(updated.nextAttemptAt)},
      updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(jobId)}`);

    if (status === "completed") {
      await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);
      await this.trino.query(`DELETE FROM ${S}.dlq WHERE job_id = ${esc(jobId)}`);
      await this.insertOutboxItem(
        "media.process.completed.v1", context.correlationId,
        { jobId: updated.id, assetId: updated.assetId }, nowIso
      );
    }

    if (status === "pending") {
      // Upsert queue: delete + insert (Trino has no UPSERT)
      await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);
      await this.trino.query(`INSERT INTO ${S}.queue (
        job_id, asset_id, available_at, lease_owner, lease_expires_at
      ) VALUES (${esc(updated.id)}, ${esc(updated.assetId)}, ${escTimestamp(nowIso)}, NULL, NULL)`);
    }

    if (status === "failed") {
      await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);
    }

    await this.insertAuditEvent(`job ${jobId} moved to ${status}`, context.correlationId, nowIso);
    return updated;
  }

  // -------------------------------------------------------------------------
  // updateJobStatus (CAS)
  // -------------------------------------------------------------------------

  async updateJobStatus(
    jobId: string,
    expectedStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    context: WriteContext
  ): Promise<boolean> {
    const job = await this.getJobById(jobId);
    if (!job || job.status !== expectedStatus) return false;

    const result = await this.setJobStatus(jobId, newStatus, null, context);
    return result !== null;
  }

  // -------------------------------------------------------------------------
  // getJobById
  // -------------------------------------------------------------------------

  async getJobById(jobId: string): Promise<WorkflowJob | null> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.jobs WHERE id = ${esc(jobId)}`
    );
    if (r.data.length === 0) return null;
    return mapRowToJob(r.data[0], r);
  }

  // -------------------------------------------------------------------------
  // getPendingJobs
  // -------------------------------------------------------------------------

  async getPendingJobs(limit = 100): Promise<WorkflowJob[]> {
    const nowIso = new Date().toISOString();
    const r = await this.trino.query(`
      SELECT j.* FROM ${S}.jobs j
      INNER JOIN ${S}.queue q ON j.id = q.job_id
      WHERE j.status = 'pending'
        AND q.available_at <= ${escTimestamp(nowIso)}
        AND (q.lease_expires_at IS NULL OR q.lease_expires_at <= ${escTimestamp(nowIso)})
      ORDER BY q.available_at ASC
      LIMIT ${escNum(limit)}
    `);
    return r.data.map((row) => mapRowToJob(row, r));
  }

  // -------------------------------------------------------------------------
  // claimNextJob
  // -------------------------------------------------------------------------

  async claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null> {
    const now = this.resolveNow(context);
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString();

    // Find the first claimable job
    const candidates = await this.getPendingJobs(1);
    if (candidates.length === 0) return null;

    const job = candidates[0];

    // CAS: re-check the job is still pending and unclaimed
    const fresh = await this.getJobById(job.id);
    if (!fresh || fresh.status !== "pending" || fresh.leaseOwner) return null;

    const updated: WorkflowJob = {
      ...fresh,
      status: "processing",
      attemptCount: fresh.attemptCount + 1,
      nextAttemptAt: null,
      leaseOwner: workerId,
      leaseExpiresAt: leaseUntil,
      updatedAt: nowIso
    };

    await this.trino.query(`UPDATE ${S}.jobs SET
      status = 'processing',
      attempt_count = ${escNum(updated.attemptCount)},
      next_attempt_at = NULL,
      lease_owner = ${esc(workerId)},
      lease_expires_at = ${escTimestamp(leaseUntil)},
      updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(job.id)} AND status = 'pending'`);

    await this.trino.query(`UPDATE ${S}.queue SET
      lease_owner = ${esc(workerId)},
      lease_expires_at = ${escTimestamp(leaseUntil)},
      available_at = ${escTimestamp(nowIso)}
    WHERE job_id = ${esc(job.id)}`);

    await this.insertAuditEvent(`job ${updated.id} claimed by ${workerId}`, context.correlationId, nowIso);
    await this.insertOutboxItem(
      "media.process.claimed.v1", context.correlationId,
      { jobId: updated.id, assetId: updated.assetId, workerId, attemptCount: updated.attemptCount },
      nowIso
    );

    return updated;
  }

  // -------------------------------------------------------------------------
  // heartbeatJob
  // -------------------------------------------------------------------------

  async heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null> {
    const now = this.resolveNow(context);
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString();

    const job = await this.getJobById(jobId);
    if (!job || job.leaseOwner !== workerId) return null;

    await this.trino.query(`UPDATE ${S}.jobs SET
      lease_expires_at = ${escTimestamp(leaseUntil)},
      updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(jobId)} AND lease_owner = ${esc(workerId)}`);

    await this.trino.query(`UPDATE ${S}.queue SET
      lease_expires_at = ${escTimestamp(leaseUntil)}
    WHERE job_id = ${esc(jobId)}`);

    await this.insertAuditEvent(`job ${jobId} heartbeat by ${workerId}`, context.correlationId, nowIso);

    return { ...job, leaseExpiresAt: leaseUntil, updatedAt: nowIso };
  }

  // -------------------------------------------------------------------------
  // reapStaleLeases
  // -------------------------------------------------------------------------

  async reapStaleLeases(nowIso: string): Promise<number> {
    // Find stale processing jobs with expired leases
    const r = await this.trino.query(`
      SELECT j.id, j.asset_id FROM ${S}.jobs j
      INNER JOIN ${S}.queue q ON j.id = q.job_id
      WHERE j.status = 'processing'
        AND q.lease_expires_at IS NOT NULL
        AND q.lease_expires_at < ${escTimestamp(nowIso)}
    `);

    if (r.data.length === 0) return 0;

    for (const row of r.data) {
      const jobId = getReqStr(row, r, "id");
      const assetId = getReqStr(row, r, "asset_id");

      await this.trino.query(`UPDATE ${S}.jobs SET
        status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
        next_attempt_at = ${escTimestamp(nowIso)}, updated_at = ${escTimestamp(nowIso)}
      WHERE id = ${esc(jobId)}`);

      await this.trino.query(`UPDATE ${S}.queue SET
        available_at = ${escTimestamp(nowIso)}, lease_owner = NULL, lease_expires_at = NULL
      WHERE job_id = ${esc(jobId)}`);

      await this.insertAuditEvent(`job ${jobId} requeued after stale lease`, "system", nowIso);
      await this.insertOutboxItem(
        "media.process.requeued.stale.v1", "system",
        { jobId, assetId }, nowIso
      );
    }

    return r.data.length;
  }

  // -------------------------------------------------------------------------
  // handleJobFailure
  // -------------------------------------------------------------------------

  async handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult> {
    const job = await this.getJobById(jobId);
    if (!job) return { accepted: false, message: `job not found: ${jobId}` };

    const now = this.resolveNow(context);
    const nowIso = now.toISOString();

    if (job.attemptCount < job.maxAttempts) {
      const backoffSeconds = this.backoffSeconds(job.attemptCount);
      const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();

      await this.trino.query(`UPDATE ${S}.jobs SET
        status = 'pending', last_error = ${esc(error)},
        lease_owner = NULL, lease_expires_at = NULL,
        next_attempt_at = ${escTimestamp(nextAttemptAt)},
        updated_at = ${escTimestamp(nowIso)}
      WHERE id = ${esc(jobId)}`);

      // Upsert queue
      await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);
      await this.trino.query(`INSERT INTO ${S}.queue (
        job_id, asset_id, available_at, lease_owner, lease_expires_at
      ) VALUES (${esc(jobId)}, ${esc(job.assetId)}, ${escTimestamp(nextAttemptAt)}, NULL, NULL)`);

      await this.insertAuditEvent(`job ${jobId} scheduled retry #${job.attemptCount + 1}`, context.correlationId, nowIso);
      await this.insertOutboxItem(
        "media.process.retry.scheduled.v1", context.correlationId,
        { jobId, assetId: job.assetId, attemptCount: job.attemptCount, nextAttemptAt, error },
        nowIso
      );

      return { accepted: true, status: "pending", retryScheduled: true, movedToDlq: false };
    }

    // Max attempts exceeded → DLQ
    await this.trino.query(`UPDATE ${S}.jobs SET
      status = 'failed', last_error = ${esc(error)},
      lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = NULL, updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(jobId)}`);

    await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);

    const dlqId = randomUUID();
    await this.trino.query(`INSERT INTO ${S}.dlq (
      id, job_id, asset_id, error, attempt_count, failed_at
    ) VALUES (
      ${esc(dlqId)}, ${esc(jobId)}, ${esc(job.assetId)},
      ${esc(error)}, ${escNum(job.attemptCount)}, ${escTimestamp(nowIso)}
    )`);

    await this.insertAuditEvent(`job ${jobId} moved to DLQ`, context.correlationId, nowIso);
    await this.insertOutboxItem(
      "media.process.dead_lettered.v1", context.correlationId,
      { jobId, assetId: job.assetId, attemptCount: job.attemptCount, error },
      nowIso
    );

    return { accepted: true, status: "failed", retryScheduled: false, movedToDlq: true };
  }

  // -------------------------------------------------------------------------
  // replayJob
  // -------------------------------------------------------------------------

  async replayJob(jobId: string, context: WriteContext): Promise<WorkflowJob | null> {
    const job = await this.getJobById(jobId);
    if (!job) return null;

    const nowIso = this.resolveNow(context).toISOString();

    await this.trino.query(`DELETE FROM ${S}.dlq WHERE job_id = ${esc(jobId)}`);

    await this.trino.query(`UPDATE ${S}.jobs SET
      status = 'pending', last_error = NULL,
      attempt_count = 0, next_attempt_at = ${escTimestamp(nowIso)},
      lease_owner = NULL, lease_expires_at = NULL,
      updated_at = ${escTimestamp(nowIso)}
    WHERE id = ${esc(jobId)}`);

    // Upsert queue
    await this.trino.query(`DELETE FROM ${S}.queue WHERE job_id = ${esc(jobId)}`);
    await this.trino.query(`INSERT INTO ${S}.queue (
      job_id, asset_id, available_at, lease_owner, lease_expires_at
    ) VALUES (${esc(jobId)}, ${esc(job.assetId)}, ${escTimestamp(nowIso)}, NULL, NULL)`);

    await this.insertAuditEvent(`job ${jobId} replayed`, context.correlationId, nowIso);
    await this.insertOutboxItem(
      "media.process.replay.requested.v1", context.correlationId,
      { jobId, assetId: job.assetId }, nowIso
    );

    return {
      ...job,
      status: "pending",
      lastError: null,
      attemptCount: 0,
      nextAttemptAt: nowIso,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: nowIso
    };
  }

  // -------------------------------------------------------------------------
  // DLQ operations
  // -------------------------------------------------------------------------

  async getDlqItems(): Promise<DlqItem[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.dlq ORDER BY failed_at DESC`
    );
    return r.data.map((row) => mapRowToDlqItem(row, r));
  }

  async getDlqItem(jobId: string): Promise<DlqItem | null> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.dlq WHERE job_id = ${esc(jobId)}`
    );
    if (r.data.length === 0) return null;
    return mapRowToDlqItem(r.data[0], r);
  }

  async purgeDlqItems(beforeIso: string): Promise<number> {
    const r = await this.trino.query(
      `SELECT COUNT(*) AS cnt FROM ${S}.dlq WHERE failed_at < ${escTimestamp(beforeIso)}`
    );
    const count = r.data.length > 0 ? Number(r.data[0][0]) : 0;
    if (count > 0) {
      await this.trino.query(
        `DELETE FROM ${S}.dlq WHERE failed_at < ${escTimestamp(beforeIso)}`
      );
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Outbox operations
  // -------------------------------------------------------------------------

  async getOutboxItems(): Promise<OutboxItem[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.outbox ORDER BY created_at ASC`
    );
    return r.data.map((row) => mapRowToOutboxItem(row, r));
  }

  // -------------------------------------------------------------------------
  // Workflow stats
  // -------------------------------------------------------------------------

  async getWorkflowStats(nowIso?: string): Promise<{
    assets: number;
    jobsByStatus: Record<string, number>;
    queuePending: number;
    queueLeased: number;
    outboxPending: number;
    outboxPublished: number;
    dlqTotal: number;
  }> {
    const now = nowIso ?? new Date().toISOString();

    const [assetR, jobR, queueR, outboxR, dlqR] = await Promise.all([
      this.trino.query(`SELECT COUNT(*) AS cnt FROM ${S}.assets`),
      this.trino.query(`SELECT status, COUNT(*) AS cnt FROM ${S}.jobs GROUP BY status`),
      this.trino.query(`SELECT
        SUM(CASE WHEN (lease_expires_at IS NOT NULL AND lease_expires_at > ${escTimestamp(now)}) THEN 1 ELSE 0 END) AS leased,
        SUM(CASE WHEN (lease_expires_at IS NULL OR lease_expires_at <= ${escTimestamp(now)}) AND available_at <= ${escTimestamp(now)} THEN 1 ELSE 0 END) AS pending
      FROM ${S}.queue`),
      this.trino.query(`SELECT
        SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS published
      FROM ${S}.outbox`),
      this.trino.query(`SELECT COUNT(*) AS cnt FROM ${S}.dlq`)
    ]);

    const jobsByStatus: Record<string, number> = {};
    for (const row of jobR.data) {
      const status = getReqStr(row, jobR, "status");
      const cnt = getReqNum(row, jobR, "cnt");
      jobsByStatus[status] = cnt;
    }

    return {
      assets: assetR.data.length > 0 ? Number(assetR.data[0][0]) : 0,
      jobsByStatus,
      queuePending: queueR.data.length > 0 ? Number(queueR.data[0][colIndex(queueR, "pending")] ?? 0) : 0,
      queueLeased: queueR.data.length > 0 ? Number(queueR.data[0][colIndex(queueR, "leased")] ?? 0) : 0,
      outboxPending: outboxR.data.length > 0 ? Number(outboxR.data[0][colIndex(outboxR, "pending")] ?? 0) : 0,
      outboxPublished: outboxR.data.length > 0 ? Number(outboxR.data[0][colIndex(outboxR, "published")] ?? 0) : 0,
      dlqTotal: dlqR.data.length > 0 ? Number(dlqR.data[0][0]) : 0
    };
  }

  // -------------------------------------------------------------------------
  // listAssetQueueRows
  // -------------------------------------------------------------------------

  async listAssetQueueRows(): Promise<AssetQueueRow[]> {
    const r = await this.trino.query(`
      SELECT a.*, j.id AS job_id, j.status AS job_status,
        j.thumbnail AS job_thumbnail, j.proxy AS job_proxy,
        j.annotation_hook AS job_annotation_hook,
        j.handoff_checklist AS job_handoff_checklist,
        j.handoff AS job_handoff
      FROM ${S}.assets a
      LEFT JOIN ${S}.jobs j ON j.asset_id = a.id
      ORDER BY a.created_at DESC
    `);

    return r.data.map((row) => ({
      id: getReqStr(row, r, "id"),
      jobId: getStr(row, r, "job_id"),
      title: getReqStr(row, r, "title"),
      sourceUri: getReqStr(row, r, "source_uri"),
      status: (getStr(row, r, "job_status") ?? "pending") as WorkflowStatus,
      thumbnail: parseJsonCol<AssetThumbnailPreview>(row, r, "job_thumbnail"),
      proxy: parseJsonCol<AssetProxyPreview>(row, r, "job_proxy"),
      annotationHook: parseJsonCol<AnnotationHookMetadata>(row, r, "job_annotation_hook") ?? DEFAULT_ANNOTATION_HOOK,
      handoffChecklist: parseJsonCol<HandoffChecklistMetadata>(row, r, "job_handoff_checklist") ?? { ...DEFAULT_HANDOFF_CHECKLIST },
      handoff: parseJsonCol<HandoffMetadata>(row, r, "job_handoff") ?? { ...DEFAULT_HANDOFF },
      productionMetadata: {
        show: null, episode: null, sequence: null, shot: null,
        version: null, vendor: null, priority: null, dueDate: null, owner: null
      }
    }));
  }

  // -------------------------------------------------------------------------
  // Audit events
  // -------------------------------------------------------------------------

  async getAuditEvents(): Promise<AuditEvent[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.audit_log ORDER BY at DESC LIMIT 1000`
    );
    return r.data.map((row) => mapRowToAuditEvent(row, r));
  }

  // -------------------------------------------------------------------------
  // Audit retention
  // -------------------------------------------------------------------------

  async previewAuditRetention(cutoffIso: string): Promise<AuditRetentionPreview> {
    const r = await this.trino.query(`
      SELECT COUNT(*) AS cnt,
        MIN(at) AS oldest,
        MAX(at) AS newest
      FROM ${S}.audit_log
      WHERE at < ${escTimestamp(cutoffIso)}
    `);

    if (r.data.length === 0 || Number(r.data[0][0]) === 0) {
      return { eligibleCount: 0, oldestEligibleAt: null, newestEligibleAt: null };
    }

    return {
      eligibleCount: Number(r.data[0][colIndex(r, "cnt")]),
      oldestEligibleAt: getStr(r.data[0], r, "oldest"),
      newestEligibleAt: getStr(r.data[0], r, "newest")
    };
  }

  async applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): Promise<AuditRetentionApplyResult> {
    const preview = await this.previewAuditRetention(cutoffIso);
    if (preview.eligibleCount === 0) {
      const totalR = await this.trino.query(`SELECT COUNT(*) AS cnt FROM ${S}.audit_log`);
      return { deletedCount: 0, remainingCount: Number(totalR.data[0]?.[0] ?? 0) };
    }

    const deleteLimit = maxDeletePerRun === undefined
      ? preview.eligibleCount
      : Math.max(0, Math.min(maxDeletePerRun, preview.eligibleCount));

    if (deleteLimit === 0) {
      const totalR = await this.trino.query(`SELECT COUNT(*) AS cnt FROM ${S}.audit_log`);
      return { deletedCount: 0, remainingCount: Number(totalR.data[0]?.[0] ?? 0) };
    }

    // Delete oldest eligible entries up to limit
    await this.trino.query(`
      DELETE FROM ${S}.audit_log
      WHERE at < ${escTimestamp(cutoffIso)}
    `);

    const totalR = await this.trino.query(`SELECT COUNT(*) AS cnt FROM ${S}.audit_log`);
    return {
      deletedCount: Math.min(deleteLimit, preview.eligibleCount),
      remainingCount: Number(totalR.data[0]?.[0] ?? 0)
    };
  }

  // -------------------------------------------------------------------------
  // Incident coordination
  // -------------------------------------------------------------------------

  async getIncidentCoordination(): Promise<IncidentCoordination> {
    const [coordR, notesR] = await Promise.all([
      this.trino.query(`SELECT * FROM ${S}.incident_coordination LIMIT 1`),
      this.trino.query(`SELECT * FROM ${S}.incident_notes ORDER BY at DESC`)
    ]);

    const guidedActions: IncidentGuidedActions = coordR.data.length > 0
      ? {
          acknowledged: getBool(coordR.data[0], coordR, "acknowledged"),
          owner: getReqStr(coordR.data[0], coordR, "owner"),
          escalated: getBool(coordR.data[0], coordR, "escalated"),
          nextUpdateEta: getStr(coordR.data[0], coordR, "next_update_eta"),
          updatedAt: getStr(coordR.data[0], coordR, "guided_updated_at")
        }
      : { acknowledged: false, owner: "", escalated: false, nextUpdateEta: null, updatedAt: null };

    const handoff: IncidentHandoff = coordR.data.length > 0
      ? {
          state: (getStr(coordR.data[0], coordR, "handoff_state") ?? "none") as IncidentHandoff["state"],
          fromOwner: getReqStr(coordR.data[0], coordR, "handoff_from"),
          toOwner: getReqStr(coordR.data[0], coordR, "handoff_to"),
          summary: getReqStr(coordR.data[0], coordR, "handoff_summary"),
          updatedAt: getStr(coordR.data[0], coordR, "handoff_updated_at")
        }
      : { state: "none", fromOwner: "", toOwner: "", summary: "", updatedAt: null };

    const notes: IncidentNote[] = notesR.data.map((row) => ({
      id: getReqStr(row, notesR, "id"),
      message: getReqStr(row, notesR, "message"),
      correlationId: getReqStr(row, notesR, "correlation_id"),
      author: getReqStr(row, notesR, "author"),
      at: getReqStr(row, notesR, "at")
    }));

    return { guidedActions, handoff, notes };
  }

  async updateIncidentGuidedActions(
    update: { acknowledged: boolean; owner: string; escalated: boolean; nextUpdateEta: string | null },
    context: WriteContext
  ): Promise<IncidentGuidedActions> {
    const nowIso = this.resolveNow(context).toISOString();

    // Upsert: delete + insert (singleton)
    await this.trino.query(`DELETE FROM ${S}.incident_coordination WHERE 1=1`);
    const existing = await this.getIncidentCoordination();

    await this.trino.query(`INSERT INTO ${S}.incident_coordination (
      id, acknowledged, owner, escalated, next_update_eta, guided_updated_at,
      handoff_state, handoff_from, handoff_to, handoff_summary, handoff_updated_at
    ) VALUES (
      ${esc(randomUUID())}, ${escBool(update.acknowledged)}, ${esc(update.owner)},
      ${escBool(update.escalated)}, ${escTimestamp(update.nextUpdateEta)}, ${escTimestamp(nowIso)},
      ${esc(existing.handoff.state)}, ${esc(existing.handoff.fromOwner)},
      ${esc(existing.handoff.toOwner)}, ${esc(existing.handoff.summary)},
      ${escTimestamp(existing.handoff.updatedAt)}
    )`);

    await this.insertAuditEvent(
      `incident actions updated (acknowledged=${update.acknowledged}, owner=${update.owner || "unassigned"}, escalated=${update.escalated})`,
      context.correlationId, nowIso
    );

    return {
      acknowledged: update.acknowledged,
      owner: update.owner,
      escalated: update.escalated,
      nextUpdateEta: update.nextUpdateEta,
      updatedAt: nowIso
    };
  }

  async addIncidentNote(
    input: { message: string; correlationId: string; author: string },
    context: WriteContext
  ): Promise<IncidentNote> {
    const nowIso = this.resolveNow(context).toISOString();
    const note: IncidentNote = {
      id: randomUUID(),
      message: input.message,
      correlationId: input.correlationId,
      author: input.author,
      at: nowIso
    };

    await this.trino.query(`INSERT INTO ${S}.incident_notes (
      id, message, correlation_id, author, at
    ) VALUES (
      ${esc(note.id)}, ${esc(note.message)}, ${esc(note.correlationId)},
      ${esc(note.author)}, ${escTimestamp(nowIso)}
    )`);

    await this.insertAuditEvent(
      `incident note added by ${note.author} linked to ${note.correlationId}`,
      context.correlationId, nowIso
    );

    return note;
  }

  async updateIncidentHandoff(
    update: { state: IncidentHandoff["state"]; fromOwner: string; toOwner: string; summary: string },
    context: WriteContext
  ): Promise<IncidentHandoff> {
    const nowIso = this.resolveNow(context).toISOString();

    // Upsert: delete + insert (singleton)
    await this.trino.query(`DELETE FROM ${S}.incident_coordination WHERE 1=1`);
    const existing = await this.getIncidentCoordination();

    await this.trino.query(`INSERT INTO ${S}.incident_coordination (
      id, acknowledged, owner, escalated, next_update_eta, guided_updated_at,
      handoff_state, handoff_from, handoff_to, handoff_summary, handoff_updated_at
    ) VALUES (
      ${esc(randomUUID())}, ${escBool(existing.guidedActions.acknowledged)},
      ${esc(existing.guidedActions.owner)}, ${escBool(existing.guidedActions.escalated)},
      ${escTimestamp(existing.guidedActions.nextUpdateEta)},
      ${escTimestamp(existing.guidedActions.updatedAt)},
      ${esc(update.state)}, ${esc(update.fromOwner)}, ${esc(update.toOwner)},
      ${esc(update.summary)}, ${escTimestamp(nowIso)}
    )`);

    await this.insertAuditEvent(
      `incident handoff updated (${update.fromOwner || "unassigned"} -> ${update.toOwner || "unassigned"}, state=${update.state})`,
      context.correlationId, nowIso
    );

    return {
      state: update.state,
      fromOwner: update.fromOwner,
      toOwner: update.toOwner,
      summary: update.summary,
      updatedAt: nowIso
    };
  }

  // -------------------------------------------------------------------------
  // Approval audit
  // -------------------------------------------------------------------------

  async appendApprovalAuditEntry(entry: ApprovalAuditEntry): Promise<void> {
    await this.trino.query(`INSERT INTO ${S}.approval_audit (
      id, asset_id, action, performed_by, note, at
    ) VALUES (
      ${esc(entry.id)}, ${esc(entry.assetId)}, ${esc(entry.action)},
      ${esc(entry.performedBy)}, ${esc(entry.note)}, ${escTimestamp(entry.at)}
    )`);
  }

  async getApprovalAuditLog(): Promise<ApprovalAuditEntry[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.approval_audit ORDER BY at DESC`
    );
    return r.data.map((row) => ({
      id: getReqStr(row, r, "id"),
      assetId: getReqStr(row, r, "asset_id"),
      action: getReqStr(row, r, "action") as ApprovalAuditEntry["action"],
      performedBy: getReqStr(row, r, "performed_by"),
      note: getStr(row, r, "note"),
      at: getReqStr(row, r, "at")
    }));
  }

  async getApprovalAuditLogByAssetId(assetId: string): Promise<ApprovalAuditEntry[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.approval_audit WHERE asset_id = ${esc(assetId)} ORDER BY at DESC`
    );
    return r.data.map((row) => ({
      id: getReqStr(row, r, "id"),
      assetId: getReqStr(row, r, "asset_id"),
      action: getReqStr(row, r, "action") as ApprovalAuditEntry["action"],
      performedBy: getReqStr(row, r, "performed_by"),
      note: getStr(row, r, "note"),
      at: getReqStr(row, r, "at")
    }));
  }

  // -------------------------------------------------------------------------
  // DCC audit
  // -------------------------------------------------------------------------

  async appendDccAuditEntry(entry: DccAuditEntry): Promise<void> {
    await this.trino.query(`INSERT INTO ${S}.dcc_audit (
      id, session_id, operation, entity_ref, trait_set, result, duration_ms, at
    ) VALUES (
      ${esc(entry.id)}, ${esc("")}, ${esc(entry.action)},
      ${esc(entry.asset_id)}, NULL, NULL, NULL, ${escTimestamp(entry.timestamp)}
    )`);
  }

  async getDccAuditTrail(): Promise<DccAuditEntry[]> {
    const r = await this.trino.query(
      `SELECT * FROM ${S}.dcc_audit ORDER BY at DESC`
    );
    return r.data.map((row) => ({
      id: getReqStr(row, r, "id"),
      action: getReqStr(row, r, "operation"),
      asset_id: getStr(row, r, "entity_ref"),
      format: getStr(row, r, "trait_set"),
      timestamp: getReqStr(row, r, "at")
    }));
  }

  // -------------------------------------------------------------------------
  // Event dedup
  // -------------------------------------------------------------------------

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const r = await this.trino.query(
      `SELECT event_id FROM ${S}.processed_events WHERE event_id = ${esc(eventId)}`
    );
    return r.data.length > 0;
  }

  async markProcessedEvent(eventId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.trino.query(`INSERT INTO ${S}.processed_events (
      event_id, processed_at
    ) VALUES (${esc(eventId)}, ${escTimestamp(nowIso)})`);
  }

  /**
   * Atomic check-and-mark for event idempotency (CWE-367 / M13 fix).
   *
   * IMPORTANT: The current implementation uses a SELECT-then-INSERT
   * approach which is NOT truly atomic at the database level. For
   * production multi-instance deployments, this MUST be replaced with
   * a database-level atomic primitive such as:
   *   - INSERT INTO processed_events … ON CONFLICT (event_id) DO NOTHING
   *     (requires a UNIQUE constraint on event_id)
   *   - Or a distributed lock / advisory lock around the operation
   *
   * Returns `true` if the event was newly marked (not a duplicate).
   * Returns `false` if the event was already processed (duplicate).
   */
  async markIfNotProcessed(eventId: string): Promise<boolean> {
    // TODO(production): Replace with INSERT … ON CONFLICT DO NOTHING
    // once the processed_events table has a UNIQUE constraint on event_id.
    // The current implementation reduces the race window but does not
    // fully eliminate it for concurrent Trino writers.
    const existing = await this.hasProcessedEvent(eventId);
    if (existing) return false;
    await this.markProcessedEvent(eventId);
    return true;
  }

  /**
   * Purge old processed events to prevent unbounded table growth.
   * Should be called periodically (e.g., from a background timer).
   */
  async purgeProcessedEvents(olderThanIso: string): Promise<number> {
    const r = await this.trino.query(
      `SELECT COUNT(*) AS cnt FROM ${S}.processed_events WHERE processed_at < ${escTimestamp(olderThanIso)}`
    );
    const count = Number(r.data[0]?.[0] ?? 0);
    if (count > 0) {
      await this.trino.query(
        `DELETE FROM ${S}.processed_events WHERE processed_at < ${escTimestamp(olderThanIso)}`
      );
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async insertAuditEvent(message: string, correlationId: string, nowIso: string): Promise<void> {
    const id = randomUUID();
    await this.trino.query(`INSERT INTO ${S}.audit_log (id, message, at, signal) VALUES (
      ${esc(id)}, ${esc(`[corr:${correlationId}] ${message}`)}, ${escTimestamp(nowIso)}, NULL
    )`);
  }

  private async insertOutboxItem(
    eventType: string,
    correlationId: string,
    payload: Record<string, unknown>,
    nowIso: string
  ): Promise<void> {
    const id = randomUUID();
    await this.trino.query(`INSERT INTO ${S}.outbox (
      id, event_type, correlation_id, payload, created_at, published_at
    ) VALUES (
      ${esc(id)}, ${esc(eventType)}, ${esc(correlationId)},
      ${escJson(payload)}, ${escTimestamp(nowIso)}, NULL
    )`);
  }

  private resolveNow(context: WriteContext): Date {
    if (context.now) return new Date(context.now);
    return new Date();
  }

  private backoffSeconds(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(60, 5 * 2 ** exponent);
  }
}
