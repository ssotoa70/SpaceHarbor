export type WorkflowStatus = "pending" | "processing" | "completed" | "failed" | "needs_replay" | "qc_pending" | "qc_in_review" | "qc_approved" | "qc_rejected";

export interface ApprovalAuditEntry {
  id: string;
  assetId: string;
  action: "request_review" | "approve" | "reject";
  performedBy: string;
  note: string | null;
  at: string;
}

export interface AssetMetadata {
  codec?: string;
  resolution?: { width: number; height: number };
  frame_range?: { start: number; end: number };
  frame_rate?: number;
  pixel_aspect_ratio?: number;
  display_window?: { x: number; y: number; width: number; height: number };
  data_window?: { x: number; y: number; width: number; height: number };
  compression_type?: string;
  channels?: string[];
  color_space?: string;
  bit_depth?: number;
  file_size_bytes?: number;
  md5_checksum?: string;
}

export interface AssetVersion {
  version_label: string;
  parent_version_id?: string;
}

export interface AssetIntegrity {
  file_size_bytes: number;
  checksum: { type: "md5" | "xxhash"; value: string };
  verified_at: string;
}

export interface Asset {
  id: string;
  title: string;
  sourceUri: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: AssetMetadata;
  version?: AssetVersion;
  integrity?: AssetIntegrity;
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
