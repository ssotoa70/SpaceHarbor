export type ApprovalStatus = "qc_pending" | "qc_in_review" | "qc_approved" | "qc_rejected";

export type WorkflowStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "needs_replay"
  | ApprovalStatus;

export interface AssetMetadata {
  codec?: string;
  resolution?: { width: number; height: number };
  frame_range?: { start: number; end: number };
  frame_rate?: number;
  pixel_aspect_ratio?: number;
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

export type AssetPriority = "low" | "normal" | "high" | "urgent";

export interface ProductionMetadata {
  show?: string | null;
  episode?: string | null;
  sequence?: string | null;
  shot?: string | null;
  version?: number | null;
  vendor?: string | null;
  priority?: AssetPriority | null;
  dueDate?: string | null;
  owner?: string | null;
}

export interface AssetRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: WorkflowStatus;
  createdAt?: string;
  metadata?: AssetMetadata;
  version?: AssetVersion;
  productionMetadata?: ProductionMetadata;
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
}

export type SortField = "created_at" | "name";
export type SortDirection = "asc" | "desc";
