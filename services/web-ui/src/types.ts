export type ApprovalStatus = "qc_pending" | "qc_in_review" | "qc_approved" | "qc_rejected";

export type ReviewStatus = "wip" | "internal_review" | "client_review" | "approved";

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

export type LineageChangeType =
  | "new_frames"
  | "compression_change"
  | "color_space_change"
  | "full_re_render"
  | "alternate_take";

export interface AssetVersion {
  version_label: string;
  parent_version_id?: string;
  branch_label?: string;
  change_description?: string;
  changed_frames?: number[];
  color_space_changed?: boolean;
  compression_changed?: boolean;
}

export type AssetPriority = "low" | "normal" | "high" | "urgent";

export type PipelineStage =
  | "animation"
  | "lighting"
  | "comp"
  | "fx"
  | "lookdev"
  | "roto"
  | "paint"
  | "editorial";

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
  pipeline_stage?: PipelineStage | null;
}

export interface AssetRow {
  id: string;
  jobId: string | null;
  title: string;
  sourceUri: string;
  status: WorkflowStatus;
  currentVersionId?: string;
  elementPath?: string;
  createdAt?: string;
  metadata?: AssetMetadata;
  version?: AssetVersion;
  productionMetadata?: ProductionMetadata;
  reviewStatus?: ReviewStatus;
  thumbnail?: {
    uri: string;
    width: number;
    height: number;
    generatedAt: string;
  } | null;
  proxy?: {
    uri: string;
    durationSeconds: number;
    codec: string;
    generatedAt: string;
  } | null;
  annotationHook?: {
    enabled: boolean;
    provider: string | null;
    contextId: string | null;
  };
  handoffChecklist?: {
    releaseNotesReady: boolean;
    verificationComplete: boolean;
    commsDraftReady: boolean;
    ownerAssigned: boolean;
  };
  handoff?: {
    status: "not_ready" | "ready_for_release";
    owner: string | null;
    lastUpdatedAt: string | null;
  };
}

/** A rejected asset enriched with rejection details and linked frame comments */
export interface RejectedAssetRow extends AssetRow {
  rejectionReason: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  comments: Array<{
    id: string;
    body: string;
    frameNumber: number | null;
    timecode: string | null;
    authorId: string;
    status: string;
    createdAt: string;
  }>;
}

export interface AuditRow {
  id: string;
  message: string;
  at: string;
}

export type SortField = "created_at" | "name";
export type SortDirection = "asc" | "desc";
