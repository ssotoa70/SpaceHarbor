import type {
  AssetQueueRow,
  AuditEvent,
  IngestResult,
  WorkflowJob,
  WorkflowStatus
} from "../domain/models.js";

export type PersistenceBackend = "local" | "vast";

export interface IngestInput {
  title: string;
  sourceUri: string;
}

export interface PersistenceAdapter {
  readonly backend: PersistenceBackend;
  reset(): void;
  createIngestAsset(input: IngestInput): IngestResult;
  setJobStatus(jobId: string, status: WorkflowStatus, lastError?: string | null): WorkflowJob | null;
  getJobById(jobId: string): WorkflowJob | null;
  getPendingJobs(): WorkflowJob[];
  listAssetQueueRows(): AssetQueueRow[];
  getAuditEvents(): AuditEvent[];
  hasProcessedEvent(eventId: string): boolean;
  markProcessedEvent(eventId: string): void;
}
