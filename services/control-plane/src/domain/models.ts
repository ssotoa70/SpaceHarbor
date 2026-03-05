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

export interface VfxMetadata {
  codec?: string;
  channels?: string[];
  resolution?: { width: number; height: number };
  color_space?: string;
  frame_count?: number;
  bit_depth?: number;
  duration_ms?: number;
  thumbnail_url?: string;
  frame_range?: { start: number; end: number };
  frame_rate?: number;
  pixel_aspect_ratio?: number;
  display_window?: { x: number; y: number; width: number; height: number };
  data_window?: { x: number; y: number; width: number; height: number };
  compression_type?: string;
  file_size_bytes?: number;
  md5_checksum?: string;
}

export interface AssetVersion {
  version_label: string;
  parent_version_id?: string;
}

export interface AssetIntegrity {
  file_size_bytes?: number;
  checksum: { type: string; value: string };
  verified_at?: string;
}

export interface Asset {
  id: string;
  title: string;
  sourceUri: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: VfxMetadata;
  version?: AssetVersion;
  integrity?: AssetIntegrity;
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

export interface HandoffChecklistMetadata {
  releaseNotesReady: boolean;
  verificationComplete: boolean;
  commsDraftReady: boolean;
  ownerAssigned: boolean;
}

export interface HandoffMetadata {
  status: "not_ready" | "ready_for_release";
  owner: string | null;
  lastUpdatedAt: string | null;
}

export interface WorkflowJob {
  id: string;
  assetId: string;
  sourceUri: string;
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
  handoffChecklist: HandoffChecklistMetadata;
  handoff: HandoffMetadata;
}

export interface IngestResult {
  asset: Asset;
  job: WorkflowJob;
}

export type AssetPriority = "low" | "normal" | "high" | "urgent";

export interface ProductionMetadata {
  show: string | null;
  episode: string | null;
  sequence: string | null;
  shot: string | null;
  version: number | null;
  vendor: string | null;
  priority: AssetPriority | null;
  dueDate: string | null;
  owner: string | null;
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
  handoffChecklist: HandoffChecklistMetadata;
  handoff: HandoffMetadata;
  productionMetadata: ProductionMetadata;
}

export interface AuditEvent {
  id: string;
  message: string;
  at: string;
  signal?: AuditSignal;
}

export interface AuditSignal {
  type: "fallback";
  code: "VAST_FALLBACK";
  severity: "warning" | "critical";
}

export interface IncidentGuidedActions {
  acknowledged: boolean;
  owner: string;
  escalated: boolean;
  nextUpdateEta: string | null;
  updatedAt: string | null;
}

export type IncidentHandoffState = "none" | "handoff_requested" | "handoff_accepted";

export interface IncidentHandoff {
  state: IncidentHandoffState;
  fromOwner: string;
  toOwner: string;
  summary: string;
  updatedAt: string | null;
}

export interface IncidentNote {
  id: string;
  message: string;
  correlationId: string;
  author: string;
  at: string;
}

export interface IncidentCoordination {
  guidedActions: IncidentGuidedActions;
  handoff: IncidentHandoff;
  notes: IncidentNote[];
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

export interface ApprovalAuditEntry {
  id: string;
  assetId: string;
  action: "request_review" | "approve" | "reject";
  performedBy: string;
  note: string | null;
  at: string;
}
