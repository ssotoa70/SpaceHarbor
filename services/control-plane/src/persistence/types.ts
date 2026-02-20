import type {
  AnnotationHookMetadata,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  IngestResult,
  OutboxItem,
  WorkflowJob,
  WorkflowStatus
} from "../domain/models.js";

export type PersistenceBackend = "local" | "vast";

export interface IngestInput {
  title: string;
  sourceUri: string;
  annotationHook?: AnnotationHookMetadata | null;
}

export interface WriteContext {
  correlationId: string;
  now?: string;
}

export interface FailureResult {
  accepted: boolean;
  status?: WorkflowStatus;
  movedToDlq?: boolean;
  retryScheduled?: boolean;
  message?: string;
}

export interface WorkflowStats {
  assets: {
    total: number;
  };
  jobs: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    needsReplay: number;
  };
  queue: {
    pending: number;
    leased: number;
  };
  outbox: {
    pending: number;
    published: number;
  };
  dlq: {
    total: number;
  };
  degradedMode: {
    fallbackEvents: number;
  };
}

export interface PersistenceAdapter {
  readonly backend: PersistenceBackend;
  reset(): void;
  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult;
  setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): WorkflowJob | null;
  getJobById(jobId: string): WorkflowJob | null;
  getPendingJobs(): WorkflowJob[];
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null;
  reapStaleLeases(nowIso: string): number;
  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult;
  replayJob(jobId: string, context: WriteContext): WorkflowJob | null;
  getDlqItems(): DlqItem[];
  getOutboxItems(): OutboxItem[];
  publishOutbox(context: WriteContext): Promise<number>;
  getWorkflowStats(nowIso?: string): WorkflowStats;
  listAssetQueueRows(): AssetQueueRow[];
  getAuditEvents(): AuditEvent[];
  hasProcessedEvent(eventId: string): boolean;
  markProcessedEvent(eventId: string): void;
}
