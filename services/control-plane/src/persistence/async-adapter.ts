/**
 * AsyncPersistenceAdapter Interface
 *
 * All persistence operations are async (Promise-based), enabling:
 * - Real VAST Database calls (VastDbAdapter)
 * - Mock responses for testing (MockVastAdapter)
 * - In-memory for tests (LocalAdapter)
 */

import type {
  Asset,
  WorkflowJob,
  WorkflowStatus,
  OutboxItem,
  AuditEvent,
  DlqItem,
  IngestResult,
  FailureResult,
  WorkflowStats,
  AssetQueueRow,
  IngestInput,
  WriteContext,
  PersistenceBackend,
} from "../domain/models";

export interface AssetFilter {
  project_id?: string;
  shot_id?: string;
  status?: string;
  tags?: string[];
}

export interface JobFilter {
  status?: string;
  asset_id?: string;
  worker_id?: string;
}

export interface AuditFilter {
  asset_id?: string;
  job_id?: string;
  user_id?: string;
  action?: string;
  since?: Date;
}

export interface Lease {
  lease_holder: string;
  lease_acquired_at: string;
  lease_duration_secs?: number;
}

export interface Metrics {
  queue_pending: number;
  queue_claimed: number;
  queue_completed: number;
  dlq_count: number;
  outbox_count: number;
  assets_total: number;
}

export interface AsyncPersistenceAdapter {
  readonly backend: PersistenceBackend;

  // Lifecycle
  reset(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Asset operations
  createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult>;
  listAssets(filters?: AssetFilter): Promise<Asset[]>;
  updateAssetMetadata(
    id: string,
    metadata: Partial<Record<string, unknown>>
  ): Promise<Asset>;
  deleteAsset(id: string): Promise<void>;

  // Job operations
  createJob(job: Omit<WorkflowJob, "createdAt" | "updatedAt">): Promise<WorkflowJob>;
  getJobById(id: string): Promise<WorkflowJob | null>;
  listJobs(filters?: JobFilter): Promise<WorkflowJob[]>;
  setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): Promise<WorkflowJob | null>;
  updateJobStatus(
    jobId: string,
    expectedStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    context: WriteContext
  ): Promise<boolean>;

  // Queue operations
  getPendingJobs(): Promise<WorkflowJob[]>;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;

  // Lease operations
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;
  reapStaleLeasees(maxAgeSecs: number): Promise<number>;

  // DLQ operations
  handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult>;
  replayJob(jobId: string, context: WriteContext): Promise<WorkflowJob | null>;
  getDlqItems(): Promise<DlqItem[]>;

  // Event/idempotency
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markProcessedEvent(eventId: string): Promise<void>;

  // Outbox
  getOutboxItems(): Promise<OutboxItem[]>;
  publishOutbox(context: WriteContext): Promise<number>;

  // Audit trail
  recordAudit(entry: AuditEvent, context: WriteContext): Promise<void>;
  getAuditEvents(): Promise<AuditEvent[]>;

  // Metrics
  getWorkflowStats(nowIso?: string): WorkflowStats;
  listAssetQueueRows(): Promise<AssetQueueRow[]>;
}
