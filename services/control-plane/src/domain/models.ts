export type ReviewStatus = "wip" | "internal_review" | "client_review" | "approved";

export type WorkflowStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "needs_replay"
  | "qc_pending"
  | "qc_in_review"
  | "qc_approved"
  | "qc_rejected"
  | "revision_required"
  | "retake"
  | "client_submitted"
  | "client_approved"
  | "client_rejected";

export interface VfxMetadata {
  codec?: string;
  channels?: string[];
  resolution?: { width: number; height: number };
  color_space?: string;
  frame_count?: number;
  bit_depth?: number;
  duration_ms?: number;
  thumbnail_url?: string;
  proxy_url?: string;
  frame_range?: { start: number; end: number };
  frame_rate?: number;
  pixel_aspect_ratio?: number;
  display_window?: { x: number; y: number; width: number; height: number };
  data_window?: { x: number; y: number; width: number; height: number };
  compression_type?: string;
  file_size_bytes?: number;
  md5_checksum?: string;
  frame_head_handle?: number;  // padding frames before frameRangeStart
  frame_tail_handle?: number;  // padding frames after frameRangeEnd
  // Provenance metadata (Phase C — extracted from EXR headers / DCC metadata)
  provenance?: {
    dcc?: string;                   // e.g. "Nuke", "Houdini", "Maya"
    dccVersion?: string;            // e.g. "15.0v4"
    renderEngine?: string;          // e.g. "Karma", "Arnold", "V-Ray"
    renderEngineVersion?: string;   // e.g. "7.2.1"
    renderJobId?: string;           // render farm job ID
    renderFarmNode?: string;        // hostname of render node
    pipelineStage?: string;         // e.g. "comp", "lighting", "fx"
    sceneFilePath?: string;         // path to source scene file
  };
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
  // Optional VFX hierarchy context — populated when ingested via ScannerFunction
  shotId?: string;
  projectId?: string;
  versionLabel?: string;
  review_uri?: string;  // rvlink:// URI for OpenRV launch
  currentVersionId?: string;  // FK to active Version in VFX hierarchy
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
  /**
   * SHA-256 hash of this row's canonical payload chained to prev_hash.
   * Computed as sha256(prev_hash || canonical_json({id, message, at, signal})).
   * The first row in a chain uses prev_hash = "0000...0000" (32 zero bytes hex).
   * Verification: re-compute this hash for every row; if it diverges, the
   * chain has been tampered with.
   */
  prevHash?: string;
  rowHash?: string;
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
  versionId?: string;  // links approval to a specific version
  sessionId?: string;  // links approval to a review session
}

// ---------------------------------------------------------------------------
// VFX Hierarchy: Project → Sequence → Shot → Version → VersionApproval
// ---------------------------------------------------------------------------

export type ProjectType = "feature" | "episodic" | "commercial" | "vfx_only";
export type ProjectStatus = "active" | "archived" | "delivered";
export type SequenceStatus = "active" | "locked" | "delivered";
export type ShotStatus = "active" | "omit" | "locked" | "delivered";
export type VersionStatus =
  | "draft"
  | "review"
  | "approved"
  | "rejected"
  | "published"
  | "archived";
export type MediaType =
  | "exr_sequence"
  | "mov"
  | "dpx"
  | "audio"
  | "vdb"
  | "usd"
  | "plate"
  | "mtlx";
export type VersionAssetRole = "primary" | "proxy" | "thumbnail" | "aov" | "reference";
export type ApprovalAction =
  | "submit_for_review"
  | "approve"
  | "reject"
  | "request_changes";

export interface Project {
  id: string;
  code: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  frameRate: number | null;
  colorSpace: string | null;
  resolutionW: number | null;
  resolutionH: number | null;
  startDate: string | null;
  deliveryDate: string | null;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sequence {
  id: string;
  projectId: string;
  code: string;
  episode: string | null;
  episodeId: string | null;
  name: string | null;
  status: SequenceStatus;
  shotCount: number;
  frameRangeStart: number | null;
  frameRangeEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  projectId: string;
  sequenceId: string;
  code: string;
  name: string | null;
  status: ShotStatus;
  frameRangeStart: number;
  frameRangeEnd: number;
  frameCount: number;
  frameRate: number | null;
  vendor: string | null;
  lead: string | null;
  priority: AssetPriority | null;
  dueDate: string | null;
  notes: string | null;
  latestVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayDataWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Version {
  id: string;
  shotId: string;
  projectId: string;
  sequenceId: string;
  versionLabel: string;
  versionNumber: number;
  parentVersionId: string | null;
  status: VersionStatus;
  mediaType: MediaType;
  // VFX technical metadata (from VAST DataEngine exr_inspector)
  codec: string | null;
  resolutionW: number | null;
  resolutionH: number | null;
  frameRate: number | null;
  frameRangeStart: number | null;
  frameRangeEnd: number | null;
  headHandle: number | null;
  tailHandle: number | null;
  pixelAspectRatio: number | null;
  displayWindow: DisplayDataWindow | null;
  dataWindow: DisplayDataWindow | null;
  compressionType: string | null;
  colorSpace: string | null;
  bitDepth: number | null;
  channelCount: number | null;
  fileSizeBytes: number | null;
  md5Checksum: string | null;
  vastElementHandle: string | null;
  vastPath: string | null;
  elementPath: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  notes: string | null;
  taskId: string | null;
  reviewStatus: ReviewStatus;
  // Parallel version stream (migration 017). Defaults to "main" when the
  // column is absent or NULL (pre-existing rows).
  context: string;
  // Sentinel pointer bookkeeping. `isSentinel=true` marks a synthetic row
  // whose only purpose is to carry `sentinelName` ∈ {latest,current,approved}.
  isSentinel: boolean;
  sentinelName: string | null;
  manifestId: string | null;
}

export interface VersionApproval {
  id: string;
  versionId: string;
  shotId: string;
  projectId: string;
  action: ApprovalAction;
  performedBy: string;
  role: string | null;
  note: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// VFX Hierarchy: Episode + Task (SERGIO-136)
// ---------------------------------------------------------------------------

export type EpisodeStatus = "active" | "locked" | "delivered";
export type TaskType = "comp" | "fx" | "roto" | "paint" | "matchmove" | "layout" | "lighting" | "other";
export type TaskStatus = "not_started" | "in_progress" | "pending_review" | "approved" | "on_hold";

export interface Episode {
  id: string;
  projectId: string;
  code: string;
  name: string | null;
  status: EpisodeStatus;
  sequenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  shotId: string;
  projectId: string;
  sequenceId: string;
  code: string;
  type: TaskType;
  status: TaskStatus;
  assignee: string | null;
  dueDate: string | null;
  taskNumber: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// MaterialX domain types
// ---------------------------------------------------------------------------

export type MaterialStatus = "active" | "deprecated" | "archived";

export type TextureType =
  | "albedo" | "roughness" | "normal" | "sss"
  | "displacement" | "emission" | "opacity" | "other";

export interface Material {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: MaterialStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialVersion {
  id: string;
  materialId: string;
  versionNumber: number;
  versionLabel: string;
  parentVersionId: string | null;
  status: VersionStatus;
  sourcePath: string;
  contentHash: string;
  usdMaterialPath: string | null;
  renderContexts: string[];
  colorspaceConfig: string | null;
  mtlxSpecVersion: string | null;
  lookNames: string[];
  vastElementHandle: string | null;
  vastPath: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface LookVariant {
  id: string;
  materialVersionId: string;
  lookName: string;
  description: string | null;
  materialAssigns: string | null;
  createdAt: string;
}

export interface VersionMaterialBinding {
  id: string;
  lookVariantId: string;
  versionId: string;
  boundBy: string;
  boundAt: string;
}

export interface MaterialDependency {
  id: string;
  materialVersionId: string;
  texturePath: string;
  contentHash: string;
  textureType: TextureType | null;
  colorspace: string | null;
  dependencyDepth: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Timeline / OTIO domain types
// ---------------------------------------------------------------------------

export type TimelineStatus = "ingested" | "conforming" | "conformed" | "failed";
export type ClipConformStatus = "pending" | "matched" | "unmatched";

export interface Timeline {
  id: string;
  name: string;
  projectId: string;
  frameRate: number;
  durationFrames: number;
  status: TimelineStatus;
  sourceUri: string;
  createdAt: string;
}

export interface TimelineClip {
  id: string;
  timelineId: string;
  trackName: string;
  clipName: string;
  sourceUri: string | null;
  inFrame: number;
  outFrame: number;
  durationFrames: number;
  shotId: string | null;
  assetId: string | null;
  conformStatus: ClipConformStatus;
  vfxCutIn: number | null;
  vfxCutOut: number | null;
  handleHead: number | null;
  handleTail: number | null;
  deliveryIn: number | null;
  deliveryOut: number | null;
  sourceTimecode: string | null;
}

export type TimelineChangeType = "added" | "removed" | "modified";

export interface TimelineChange {
  clipName: string;
  sourceUri: string | null;
  changeType: TimelineChangeType;
  previousInFrame?: number;
  previousOutFrame?: number;
  newInFrame?: number;
  newOutFrame?: number;
}

export interface TimelineChangeSet {
  id: string;
  timelineId: string;
  previousTimelineId: string;
  changes: TimelineChange[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Review Session domain types (dailies-oriented)
// ---------------------------------------------------------------------------

export type ReviewSessionStatus = "open" | "in_progress" | "closed";
export type ReviewSessionType = "dailies" | "client_review" | "final";
export type SubmissionStatus = "pending" | "in_review" | "approved" | "rejected" | "revision_required";

export interface ReviewSession {
  id: string;
  projectId: string;
  department: string | null;
  sessionDate: string;
  sessionType: ReviewSessionType;
  supervisorId: string | null;
  status: ReviewSessionStatus;
  createdAt: string;
}

export interface ReviewSessionSubmission {
  id: string;
  sessionId: string;
  assetId: string;
  versionId: string | null;
  submissionOrder: number;
  status: SubmissionStatus;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Review Comment domain types (Phase B — timecoded review workflow)
// ---------------------------------------------------------------------------

export type CommentStatus = "open" | "resolved" | "archived";
export type AnnotationType = "text" | "drawing" | "arrow" | "rect" | "circle";

export interface ReviewComment {
  id: string;
  sessionId: string | null;
  submissionId: string | null;
  versionId: string | null;
  parentCommentId: string | null;
  authorId: string;
  authorRole: string | null;
  body: string;
  frameNumber: number | null;
  timecode: string | null;
  annotationType: AnnotationType | null;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAnnotation {
  id: string;
  commentId: string;
  annotationData: string;  // JSON: drawing coordinates, shapes
  frameNumber: number;
}

// ---------------------------------------------------------------------------
// Version Comparison (Phase B — Review Workflow Parity)
// ---------------------------------------------------------------------------

export type ComparisonType = "flip" | "wipe" | "overlay" | "pixel_diff";

export interface VersionComparison {
  id: string;
  versionAId: string;
  versionBId: string;
  comparisonType: ComparisonType;
  diffMetadata: string | null;  // JSON: diff details
  pixelDiffPercentage: number | null;
  frameDiffCount: number | null;
  resolutionMatch: boolean;
  colorspaceMatch: boolean;
  createdAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Collection & Playlist (Phase B.6 — Collection & Playlist System)
// ---------------------------------------------------------------------------

export type CollectionType = "playlist" | "selection" | "deliverable";
export type CollectionStatus = "active" | "archived";

export interface Collection {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  collectionType: CollectionType;
  ownerId: string;
  status: CollectionStatus;
  createdAt: string;
  updatedAt: string;
}

export type CollectionEntityType = "asset" | "version" | "shot" | "material";

export interface CollectionItem {
  id: string;
  collectionId: string;
  entityType: CollectionEntityType;
  entityId: string;
  sortOrder: number;
  addedBy: string;
  addedAt: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Playlist / Dailies Workflow (Phase B.7)
// ---------------------------------------------------------------------------

export type PlaylistItemDecision = "approve" | "reject" | "hold";

export interface Playlist {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdBy: string;
  sessionDate: string;
  status: CollectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  shotId: string;
  versionId: string;
  sortOrder: number;
  notes: string | null;
  decision: PlaylistItemDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
  addedBy: string;
  addedAt: string;
}

export interface DailiesReportEntry {
  shotId: string;
  shotCode: string | null;
  versionId: string;
  versionLabel: string | null;
  decision: PlaylistItemDecision | null;
  decidedBy: string | null;
  notes: string | null;
  commentCount: number;
}

// ---------------------------------------------------------------------------
// Asset Provenance & Version Lineage (Phase C — Asset Genealogy)
// ---------------------------------------------------------------------------

export type LineageRelationshipType = "parent" | "derived_from" | "referenced_by" | "retake_of";

export interface AssetProvenance {
  id: string;
  versionId: string;
  creator: string | null;
  softwareUsed: string | null;
  softwareVersion: string | null;
  renderJobId: string | null;
  pipelineStage: string | null;
  vastStoragePath: string | null;
  vastElementHandle: string | null;
  sourceHost: string | null;
  sourceProcessId: string | null;
  createdAt: string;
}

export interface VersionLineage {
  id: string;
  ancestorVersionId: string;
  descendantVersionId: string;
  relationshipType: LineageRelationshipType;
  depth: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dependency Intelligence (Phase C.4 — cross-entity dependency graph)
// ---------------------------------------------------------------------------

export type DependencyType =
  | "uses_material"
  | "references_texture"
  | "in_shot"
  | "derived_from_plate"
  | "uses_simulation"
  | "conform_source";

export type DependencyStrength = "hard" | "soft" | "optional";

export type UsageType =
  | "comp_input"
  | "lighting_ref"
  | "plate"
  | "matchmove_data"
  | "fx_cache"
  | "roto_mask";

export interface AssetDependency {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  dependencyType: DependencyType;
  dependencyStrength: DependencyStrength;
  discoveredBy: string | null;
  discoveredAt: string;
}

export interface ShotAssetUsage {
  id: string;
  shotId: string;
  versionId: string;
  usageType: UsageType;
  layerName: string | null;
  isActive: boolean;
  addedAt: string;
  removedAt: string | null;
}

// ---------------------------------------------------------------------------
// Capacity Planning (Phase C.7 — storage & render metrics)
// ---------------------------------------------------------------------------

export type StorageTier = "hot" | "warm" | "cold" | "archive";

export interface StorageMetric {
  id: string;
  entityType: string;
  entityId: string;
  totalBytes: number;
  fileCount: number;
  proxyBytes: number;
  thumbnailBytes: number;
  storageTier: StorageTier;
  measuredAt: string;
}

export interface RenderFarmMetric {
  id: string;
  projectId: string;
  shotId: string | null;
  versionId: string | null;
  renderEngine: string | null;
  renderTimeSeconds: number | null;
  coreHours: number | null;
  peakMemoryGb: number | null;
  frameCount: number | null;
  submittedAt: string | null;
  completedAt: string;
}

export interface DownstreamUsageCount {
  entityType: string;
  entityId: string;
  directDependents: number;
  transitiveDependents: number;
  shotCount: number;
  lastComputedAt: string;
}
