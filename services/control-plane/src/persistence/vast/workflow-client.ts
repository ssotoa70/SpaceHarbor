import type {
  ApprovalAuditEntry,
  Asset,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentNote,
  IngestResult,
  OutboxItem,
  WorkflowJob,
  WorkflowStatus
} from "../../domain/models.js";
import type { DccAuditEntry } from "../../types/dcc.js";

import type {
  AuditRetentionApplyResult,
  AuditRetentionPreview,
  FailureResult,
  IncidentGuidedActionsUpdate,
  IncidentHandoffUpdate,
  IncidentNoteInput,
  IngestInput,
  WriteContext
} from "../types.js";

/**
 * VastWorkflowClient — async interface for VAST-backed workflow persistence.
 *
 * All methods return Promises because the underlying Trino operations are async.
 * The VastPersistenceAdapter handles sync-to-async bridging where needed.
 */
export interface VastWorkflowClient {
  // Core ingest
  createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult>;

  // Asset operations
  getAssetById(assetId: string): Promise<Asset | null>;
  updateAsset(
    assetId: string,
    updates: Partial<Pick<Asset, "metadata" | "version" | "integrity">>,
    context: WriteContext
  ): Promise<Asset | null>;

  // Job operations
  setJobStatus(jobId: string, status: WorkflowStatus, lastError: string | null | undefined, context: WriteContext): Promise<WorkflowJob | null>;
  updateJobStatus(jobId: string, expectedStatus: WorkflowStatus, newStatus: WorkflowStatus, context: WriteContext): Promise<boolean>;
  getJobById(jobId: string): Promise<WorkflowJob | null>;
  getPendingJobs(limit?: number): Promise<WorkflowJob[]>;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;
  reapStaleLeases(nowIso: string): Promise<number>;
  handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult>;
  replayJob(jobId: string, context: WriteContext): Promise<WorkflowJob | null>;

  // DLQ
  getDlqItems(): Promise<DlqItem[]>;
  getDlqItem(jobId: string): Promise<DlqItem | null>;
  purgeDlqItems(beforeIso: string): Promise<number>;

  // Outbox
  getOutboxItems(): Promise<OutboxItem[]>;

  // Queue
  listAssetQueueRows(): Promise<AssetQueueRow[]>;

  // Audit
  getAuditEvents(): Promise<AuditEvent[]>;
  previewAuditRetention(cutoffIso: string): Promise<AuditRetentionPreview>;
  applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): Promise<AuditRetentionApplyResult>;

  // Incident coordination
  getIncidentCoordination(): Promise<IncidentCoordination>;
  updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext): Promise<IncidentGuidedActions>;
  addIncidentNote(input: IncidentNoteInput, context: WriteContext): Promise<IncidentNote>;
  updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext): Promise<IncidentHandoff>;

  // Approval audit
  appendApprovalAuditEntry(entry: ApprovalAuditEntry): Promise<void>;
  getApprovalAuditLog(): Promise<ApprovalAuditEntry[]>;
  getApprovalAuditLogByAssetId(assetId: string): Promise<ApprovalAuditEntry[]>;

  // DCC audit
  appendDccAuditEntry(entry: DccAuditEntry): Promise<void>;
  getDccAuditTrail(): Promise<DccAuditEntry[]>;

  // Event dedup
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markProcessedEvent(eventId: string): Promise<void>;

  /**
   * Atomically mark an event as processed only if it has not been marked yet.
   * Returns `true` if newly marked, `false` if already present (duplicate).
   *
   * Implementations MUST use a database-level atomic primitive (e.g.
   * INSERT … ON CONFLICT DO NOTHING with a UNIQUE constraint) to prevent
   * the TOCTOU race (CWE-367).
   */
  markIfNotProcessed(eventId: string): Promise<boolean>;
}
