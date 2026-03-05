import type {
  AnnotationHookMetadata,
  Asset,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentHandoffState,
  IncidentNote,
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
  outbound: {
    attempts: number;
    success: number;
    failure: number;
    byTarget: {
      slack: { attempts: number; success: number; failure: number };
      teams: { attempts: number; success: number; failure: number };
      production: { attempts: number; success: number; failure: number };
    };
  };
}

export interface IncidentGuidedActionsUpdate {
  acknowledged: boolean;
  owner: string;
  escalated: boolean;
  nextUpdateEta: string | null;
}

export interface IncidentNoteInput {
  message: string;
  correlationId: string;
  author: string;
}

export interface IncidentHandoffUpdate {
  state: IncidentHandoffState;
  fromOwner: string;
  toOwner: string;
  summary: string;
}

export interface AuditRetentionPreview {
  eligibleCount: number;
  oldestEligibleAt: string | null;
  newestEligibleAt: string | null;
}

export interface AuditRetentionApplyResult {
  deletedCount: number;
  remainingCount: number;
}

export interface PersistenceAdapter {
  readonly backend: PersistenceBackend;
  reset(): void;
  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult;
  getAssetById(assetId: string): Asset | null;
  updateAsset(
    assetId: string,
    updates: Partial<Pick<Asset, "metadata" | "version" | "integrity">>,
    context: WriteContext
  ): Asset | null;
  setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): WorkflowJob | null;
  updateJobStatus(
    jobId: string,
    expectedStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    context: WriteContext
  ): boolean;
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
  previewAuditRetention(cutoffIso: string): AuditRetentionPreview;
  applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): AuditRetentionApplyResult;
  getIncidentCoordination(): IncidentCoordination;
  updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext): IncidentGuidedActions;
  addIncidentNote(input: IncidentNoteInput, context: WriteContext): IncidentNote;
  updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext): IncidentHandoff;
  hasProcessedEvent(eventId: string): boolean;
  markProcessedEvent(eventId: string): void;
}
