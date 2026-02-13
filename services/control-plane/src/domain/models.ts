export type WorkflowStatus = "pending" | "processing" | "completed" | "failed" | "needs_replay";

export interface Asset {
  id: string;
  title: string;
  sourceUri: string;
  createdAt: string;
}

export interface WorkflowJob {
  id: string;
  assetId: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface IngestResult {
  asset: Asset;
  job: WorkflowJob;
}

export interface AssetQueueRow {
  id: string;
  title: string;
  sourceUri: string;
  status: WorkflowStatus;
}

export interface AuditEvent {
  id: string;
  message: string;
  at: string;
}
