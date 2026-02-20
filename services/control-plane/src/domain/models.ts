export type WorkflowStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "needs_replay"
  | "qc_pending"
  | "qc_in_review"
  | "qc_approved"
  | "qc_rejected";

export interface Asset {
  id: string;
  title: string;
  sourceUri: string;
  createdAt: string;
}

export interface AssetThumbnailPreview {
  uri: string;
  width: number;
  height: number;
  generatedAt: string;
}

export interface AssetProxyPreview {
  uri: string;
  durationSeconds: number;
  codec: string;
  generatedAt: string;
}

export interface AnnotationHookMetadata {
  enabled: boolean;
  provider: string | null;
  contextId: string | null;
}

export interface WorkflowJob {
  id: string;
  assetId: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  thumbnail: AssetThumbnailPreview | null;
  proxy: AssetProxyPreview | null;
  annotationHook: AnnotationHookMetadata;
}

export interface IngestResult {
  asset: Asset;
  job: WorkflowJob;
}

export interface AssetQueueRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: WorkflowStatus;
  thumbnail: AssetThumbnailPreview | null;
  proxy: AssetProxyPreview | null;
  annotationHook: AnnotationHookMetadata;
}

export interface AuditEvent {
  id: string;
  message: string;
  at: string;
}

export interface OutboxItem {
  id: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  publishedAt: string | null;
}

export interface DlqItem {
  id: string;
  jobId: string;
  assetId: string;
  error: string;
  attemptCount: number;
  failedAt: string;
}
