import type {
  AnnotationHookMetadata,
  AnnotationType,
  ApprovalAction,
  ApprovalAuditEntry,
  Asset,
  AssetDependency,
  AssetPriority,
  AssetQueueRow,
  AuditEvent,
  ClipConformStatus,
  CommentAnnotation,
  CommentStatus,
  DependencyStrength,
  DependencyType,
  DlqItem,
  Episode,
  EpisodeStatus,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentHandoffState,
  IncidentNote,
  IngestResult,
  LookVariant,
  Material,
  MaterialDependency,
  MaterialStatus,
  MaterialVersion,
  MediaType,
  OutboxItem,
  Project,
  ProjectStatus,
  ProjectType,
  ReviewComment,
  ReviewSession,
  ReviewSessionStatus,
  ReviewSessionType,
  ReviewSessionSubmission,
  ReviewStatus,
  Sequence,
  SequenceStatus,
  Shot,
  ShotAssetUsage,
  ShotStatus,
  SubmissionStatus,
  Task,
  TaskStatus,
  TaskType,
  TextureType,
  Timeline,
  TimelineChangeSet,
  TimelineClip,
  TimelineStatus,
  UsageType,
  Version,
  AssetProvenance,
  LineageRelationshipType,
  VersionApproval,
  Collection,
  CollectionItem,
  DailiesReportEntry,
  Playlist,
  PlaylistItem,
  PlaylistItemDecision,
  VersionComparison,
  VersionLineage,
  VersionMaterialBinding,
  VersionStatus,
  VfxMetadata,
  WorkflowJob,
  WorkflowStatus,
  StorageMetric,
  StorageTier,
  RenderFarmMetric,
  DownstreamUsageCount,
} from "../domain/models.js";
import type { DccAuditEntry } from "../types/dcc.js";

// ---------------------------------------------------------------------------
// VFX Hierarchy error classes
// ---------------------------------------------------------------------------

export class ReferentialIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferentialIntegrityError";
  }
}

export class ImmutabilityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImmutabilityViolationError";
  }
}

// ---------------------------------------------------------------------------
// VFX Hierarchy input types
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  code: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  frameRate?: number;
  colorSpace?: string;
  resolutionW?: number;
  resolutionH?: number;
  startDate?: string;
  deliveryDate?: string;
  owner?: string;
}

export interface CreateSequenceInput {
  projectId: string;
  code: string;
  episode?: string;
  episodeId?: string;
  name?: string;
  status: SequenceStatus;
  frameRangeStart?: number;
  frameRangeEnd?: number;
}

export interface CreateShotInput {
  projectId: string;
  sequenceId: string;
  code: string;
  name?: string;
  status: ShotStatus;
  frameRangeStart: number;
  frameRangeEnd: number;
  frameCount: number;
  frameRate?: number;
  vendor?: string;
  lead?: string;
  priority?: AssetPriority;
  dueDate?: string;
  notes?: string;
}

export interface CreateVersionInput {
  shotId: string;
  projectId: string;
  sequenceId: string;
  versionLabel: string;
  parentVersionId?: string;
  status: VersionStatus;
  mediaType: MediaType;
  createdBy: string;
  notes?: string;
  taskId?: string;
  reviewStatus?: ReviewStatus;
  headHandle?: number;
  tailHandle?: number;
  /**
   * Parallel version stream (e.g. "main", "comp", "anim", "client").
   * Defaults to "main" when omitted. Versions are numbered independently
   * within each context for the same shot — enables parallel histories.
   *
   * Uniqueness of (shotId, context, versionNumber) is enforced by the
   * persistence adapter via a retry-on-conflict loop (see migration 017).
   */
  context?: string;
}

export interface CreateEpisodeInput {
  projectId: string;
  code: string;
  name?: string;
  status: EpisodeStatus;
}

export interface CreateTaskInput {
  shotId: string;
  projectId: string;
  sequenceId: string;
  code: string;
  type: TaskType;
  status: TaskStatus;
  assignee?: string;
  dueDate?: string;
  notes?: string;
}

export interface CreateVersionApprovalInput {
  versionId: string;
  shotId: string;
  projectId: string;
  action: ApprovalAction;
  performedBy: string;
  role?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// MaterialX input types
// ---------------------------------------------------------------------------

export interface CreateMaterialInput {
  projectId: string;
  name: string;
  description?: string;
  status: MaterialStatus;
  createdBy: string;
}

export interface CreateMaterialVersionInput {
  materialId: string;
  versionLabel: string;
  parentVersionId?: string;
  status: VersionStatus;
  sourcePath: string;
  contentHash: string;
  usdMaterialPath?: string;
  renderContexts?: string[];
  colorspaceConfig?: string;
  mtlxSpecVersion?: string;
  lookNames?: string[];
  createdBy: string;
}

export interface CreateLookVariantInput {
  materialVersionId: string;
  lookName: string;
  description?: string;
  materialAssigns?: string;
}

export interface CreateVersionMaterialBindingInput {
  lookVariantId: string;
  versionId: string;
  boundBy: string;
}

export interface CreateMaterialDependencyInput {
  materialVersionId: string;
  texturePath: string;
  contentHash: string;
  textureType?: TextureType;
  colorspace?: string;
  dependencyDepth: number;
}

// ---------------------------------------------------------------------------
// Timeline / OTIO input types
// ---------------------------------------------------------------------------

export interface CreateTimelineInput {
  name: string;
  projectId: string;
  frameRate: number;
  durationFrames: number;
  sourceUri: string;
}

export interface CreateTimelineClipInput {
  timelineId: string;
  trackName: string;
  clipName: string;
  sourceUri: string | null;
  inFrame: number;
  outFrame: number;
  durationFrames: number;
  shotName?: string;
  vfxCutIn?: number;
  vfxCutOut?: number;
  handleHead?: number;
  handleTail?: number;
  deliveryIn?: number;
  deliveryOut?: number;
  sourceTimecode?: string;
}

// ---------------------------------------------------------------------------
// Review Session input types
// ---------------------------------------------------------------------------

export interface CreateReviewSessionInput {
  projectId: string;
  department?: string;
  sessionDate: string;
  sessionType: ReviewSessionType;
  supervisorId?: string;
}

export interface AddSubmissionInput {
  sessionId: string;
  assetId: string;
  versionId?: string;
  submissionOrder?: number;
}

// ---------------------------------------------------------------------------
// Review Comment input types (Phase B)
// ---------------------------------------------------------------------------

export interface CreateReviewCommentInput {
  sessionId?: string;
  submissionId?: string;
  versionId?: string;
  parentCommentId?: string;
  authorId: string;
  authorRole?: string;
  body: string;
  frameNumber?: number;
  timecode?: string;
  annotationType?: AnnotationType;
}

export interface CreateCommentAnnotationInput {
  commentId: string;
  annotationData: string;  // JSON: drawing coordinates
  frameNumber: number;
}

export interface CreateVersionComparisonInput {
  versionAId: string;
  versionBId: string;
  comparisonType: string;
  diffMetadata?: string;
  pixelDiffPercentage?: number;
  frameDiffCount?: number;
  resolutionMatch: boolean;
  colorspaceMatch: boolean;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Asset Provenance & Lineage input types (Phase C)
// ---------------------------------------------------------------------------

export interface CreateProvenanceInput {
  versionId: string;
  creator?: string;
  softwareUsed?: string;
  softwareVersion?: string;
  renderJobId?: string;
  pipelineStage?: string;
  vastStoragePath?: string;
  vastElementHandle?: string;
  sourceHost?: string;
  sourceProcessId?: string;
}

export interface CreateLineageEdgeInput {
  ancestorVersionId: string;
  descendantVersionId: string;
  relationshipType: LineageRelationshipType;
  depth: number;
}

// ---------------------------------------------------------------------------
// Dependency Intelligence input types (Phase C.4)
// ---------------------------------------------------------------------------

export interface CreateDependencyInput {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  dependencyType: DependencyType;
  dependencyStrength: DependencyStrength;
  discoveredBy?: string;
}

export interface CreateShotAssetUsageInput {
  shotId: string;
  versionId: string;
  usageType: UsageType;
  layerName?: string;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Capacity Planning input types (Phase C.7)
// ---------------------------------------------------------------------------

export interface CreateStorageMetricInput {
  entityType: string;
  entityId: string;
  totalBytes: number;
  fileCount: number;
  proxyBytes?: number;
  thumbnailBytes?: number;
  storageTier?: StorageTier;
}

export interface CreateRenderFarmMetricInput {
  projectId: string;
  shotId?: string;
  versionId?: string;
  renderEngine?: string;
  renderTimeSeconds?: number;
  coreHours?: number;
  peakMemoryGb?: number;
  frameCount?: number;
  submittedAt?: string;
}

export interface UpsertDownstreamUsageCountInput {
  entityType: string;
  entityId: string;
  directDependents: number;
  transitiveDependents: number;
  shotCount: number;
}

// ---------------------------------------------------------------------------
// Collection input types (Phase B.6)
// ---------------------------------------------------------------------------

export interface CreateCollectionInput {
  projectId: string;
  name: string;
  description?: string;
  collectionType: "playlist" | "selection" | "deliverable";
  ownerId: string;
}

export interface AddCollectionItemInput {
  collectionId: string;
  entityType: "asset" | "version" | "shot" | "material";
  entityId: string;
  sortOrder?: number;
  addedBy: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Playlist / Dailies input types (Phase B.7)
// ---------------------------------------------------------------------------

export interface CreatePlaylistInput {
  projectId: string;
  name: string;
  description?: string;
  createdBy: string;
  sessionDate: string;
}

export interface AddPlaylistItemInput {
  playlistId: string;
  shotId: string;
  versionId: string;
  sortOrder?: number;
  addedBy: string;
  notes?: string;
}

export interface UpdatePlaylistItemDecisionInput {
  decision: PlaylistItemDecision;
  decidedBy: string;
}

// ---------------------------------------------------------------------------
// VFX Hierarchy adapter interface (subset implemented by all adapters)
// ---------------------------------------------------------------------------

export interface VfxHierarchyAdapter {
  // Projects
  createProject(input: CreateProjectInput, ctx: WriteContext): Promise<Project>;
  getProjectById(id: string): Promise<Project | null>;
  listProjects(status?: ProjectStatus): Promise<Project[]>;

  // Sequences
  createSequence(input: CreateSequenceInput, ctx: WriteContext): Promise<Sequence>;
  getSequenceById(id: string): Promise<Sequence | null>;
  listSequencesByProject(projectId: string): Promise<Sequence[]>;

  // Shots
  createShot(input: CreateShotInput, ctx: WriteContext): Promise<Shot>;
  getShotById(id: string): Promise<Shot | null>;
  listShotsBySequence(sequenceId: string): Promise<Shot[]>;
  updateShotStatus(shotId: string, status: ShotStatus, ctx: WriteContext): Promise<Shot | null>;

  // Versions
  createVersion(input: CreateVersionInput, ctx: WriteContext): Promise<Version>;
  getVersionById(id: string): Promise<Version | null>;
  listVersionsByShot(shotId: string): Promise<Version[]>;
  publishVersion(versionId: string, ctx: WriteContext): Promise<Version | null>;
  updateVersionReviewStatus(versionId: string, status: ReviewStatus, ctx: WriteContext): Promise<Version | null>;
  updateVersionTechnicalMetadata(
    versionId: string,
    meta: Partial<VfxMetadata>,
    ctx: WriteContext
  ): Promise<Version | null>;

  // Approvals
  createVersionApproval(
    input: CreateVersionApprovalInput,
    ctx: WriteContext
  ): Promise<VersionApproval>;
  listApprovalsByVersion(versionId: string): Promise<VersionApproval[]>;

  // Episodes (SERGIO-136)
  createEpisode(input: CreateEpisodeInput, ctx: WriteContext): Promise<Episode>;
  getEpisodeById(id: string): Promise<Episode | null>;
  listEpisodesByProject(projectId: string): Promise<Episode[]>;

  // Tasks (SERGIO-136)
  createTask(input: CreateTaskInput, ctx: WriteContext): Promise<Task>;
  getTaskById(id: string): Promise<Task | null>;
  listTasksByShot(shotId: string): Promise<Task[]>;
  listTasksByAssignee(assignee: string, statusFilter?: string): Promise<Task[]>;
  updateTaskStatus(taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null>;

  // Materials (MaterialX)
  createMaterial(input: CreateMaterialInput, ctx: WriteContext): Promise<Material>;
  getMaterialById(id: string): Promise<Material | null>;
  listMaterialsByProject(projectId: string): Promise<Material[]>;

  // Material Versions
  createMaterialVersion(input: CreateMaterialVersionInput, ctx: WriteContext): Promise<MaterialVersion>;
  getMaterialVersionById(id: string): Promise<MaterialVersion | null>;
  listMaterialVersionsByMaterial(materialId: string): Promise<MaterialVersion[]>;
  findMaterialVersionBySourcePathAndHash(sourcePath: string, contentHash: string): Promise<MaterialVersion | null>;

  // Look Variants
  createLookVariant(input: CreateLookVariantInput, ctx: WriteContext): Promise<LookVariant>;
  listLookVariantsByMaterialVersion(materialVersionId: string): Promise<LookVariant[]>;

  // Version-Material Bindings ("Where Used?")
  createVersionMaterialBinding(input: CreateVersionMaterialBindingInput, ctx: WriteContext): Promise<VersionMaterialBinding>;
  listBindingsByLookVariant(lookVariantId: string): Promise<VersionMaterialBinding[]>;
  listBindingsByVersion(versionId: string): Promise<VersionMaterialBinding[]>;

  // Material Dependencies
  createMaterialDependency(input: CreateMaterialDependencyInput, ctx: WriteContext): Promise<MaterialDependency>;
  listDependenciesByMaterialVersion(materialVersionId: string): Promise<MaterialDependency[]>;

  // Cascade-delete safety check
  countBindingsForMaterial(materialId: string): Promise<number>;

  // Timelines (OTIO)
  createTimeline(input: CreateTimelineInput, ctx: WriteContext): Promise<Timeline>;
  getTimelineById(id: string): Promise<Timeline | null>;
  listTimelinesByProject(projectId: string): Promise<Timeline[]>;
  updateTimelineStatus(id: string, status: TimelineStatus, ctx: WriteContext): Promise<Timeline | null>;
  createTimelineClip(input: CreateTimelineClipInput, ctx: WriteContext): Promise<TimelineClip>;
  listClipsByTimeline(timelineId: string): Promise<TimelineClip[]>;
  updateClipConformStatus(
    clipId: string,
    status: ClipConformStatus,
    shotId?: string,
    assetId?: string
  ): Promise<void>;
  findTimelineByProjectAndName(projectId: string, name: string): Promise<Timeline | null>;
  storeTimelineChanges(changeSet: TimelineChangeSet): Promise<void>;
  getTimelineChanges(timelineId: string): Promise<TimelineChangeSet | null>;

  // Review Comments (Phase B)
  createReviewComment(input: CreateReviewCommentInput, ctx: WriteContext): Promise<ReviewComment>;
  getReviewCommentById(id: string): Promise<ReviewComment | null>;
  listCommentsBySession(sessionId: string): Promise<ReviewComment[]>;
  listCommentsBySubmission(submissionId: string): Promise<ReviewComment[]>;
  listReplies(parentCommentId: string): Promise<ReviewComment[]>;
  updateCommentStatus(id: string, status: CommentStatus, ctx: WriteContext): Promise<ReviewComment | null>;
  resolveComment(id: string, ctx: WriteContext): Promise<ReviewComment | null>;

  // Comment Annotations (Phase B)
  createCommentAnnotation(input: CreateCommentAnnotationInput, ctx: WriteContext): Promise<CommentAnnotation>;
  listAnnotationsByComment(commentId: string): Promise<CommentAnnotation[]>;

  // Version Comparisons (Phase B)
  createVersionComparison(input: CreateVersionComparisonInput, ctx: WriteContext): Promise<VersionComparison>;
  getVersionComparisonById(id: string): Promise<VersionComparison | null>;
  listComparisonsByVersion(versionId: string): Promise<VersionComparison[]>;

  // Asset Provenance (Phase C)
  createProvenance(input: CreateProvenanceInput, ctx: WriteContext): Promise<AssetProvenance>;
  getProvenanceByVersion(versionId: string): Promise<AssetProvenance[]>;

  // Version Lineage (Phase C)
  createLineageEdge(input: CreateLineageEdgeInput, ctx: WriteContext): Promise<VersionLineage>;
  getAncestors(versionId: string, maxDepth?: number): Promise<VersionLineage[]>;
  getDescendants(versionId: string, maxDepth?: number): Promise<VersionLineage[]>;
  getVersionTree(shotId: string): Promise<VersionLineage[]>;

  // Dependency Intelligence (Phase C.4)
  createDependency(input: CreateDependencyInput, ctx: WriteContext): Promise<AssetDependency>;
  getDependenciesBySource(entityType: string, entityId: string): Promise<AssetDependency[]>;
  getDependenciesByTarget(entityType: string, entityId: string): Promise<AssetDependency[]>;
  getReverseDependencies(entityType: string, entityId: string): Promise<AssetDependency[]>;
  getDependencyGraphForMaterial(materialId: string): Promise<AssetDependency[]>;

  // Shot Asset Usage (Phase C.4)
  createShotAssetUsage(input: CreateShotAssetUsageInput, ctx: WriteContext): Promise<ShotAssetUsage>;
  getShotUsage(shotId: string): Promise<ShotAssetUsage[]>;
  getVersionUsageAcrossShots(versionId: string): Promise<ShotAssetUsage[]>;

  // Collections (Phase B.6)
  createCollection(input: CreateCollectionInput, ctx: WriteContext): Promise<Collection>;
  getCollectionById(id: string): Promise<Collection | null>;
  listCollectionsByProject(projectId: string): Promise<Collection[]>;
  addCollectionItem(input: AddCollectionItemInput, ctx: WriteContext): Promise<CollectionItem>;
  removeCollectionItem(collectionId: string, itemId: string): Promise<boolean>;
  listCollectionItems(collectionId: string): Promise<CollectionItem[]>;

  // Playlists / Dailies (Phase B.7)
  createPlaylist(input: CreatePlaylistInput, ctx: WriteContext): Promise<Playlist>;
  getPlaylistById(id: string): Promise<Playlist | null>;
  listPlaylistsByProject(projectId: string): Promise<Playlist[]>;
  addPlaylistItem(input: AddPlaylistItemInput, ctx: WriteContext): Promise<PlaylistItem>;
  updatePlaylistItemDecision(itemId: string, input: UpdatePlaylistItemDecisionInput, ctx: WriteContext): Promise<PlaylistItem | null>;
  updatePlaylistItems(playlistId: string, items: Array<{ id: string; sortOrder?: number; notes?: string }>, ctx: WriteContext): Promise<PlaylistItem[]>;
  listPlaylistItems(playlistId: string): Promise<PlaylistItem[]>;
  getPlaylistReport(playlistId: string): Promise<DailiesReportEntry[]>;

  // Capacity Planning (Phase C.7)
  createStorageMetric(input: CreateStorageMetricInput, ctx: WriteContext): Promise<StorageMetric>;
  getStorageMetricsByEntity(entityType: string, entityId: string): Promise<StorageMetric[]>;
  getLatestStorageMetric(entityType: string, entityId: string): Promise<StorageMetric | null>;
  getStorageSummaryByProject(projectId: string): Promise<StorageMetric[]>;
  createRenderFarmMetric(input: CreateRenderFarmMetricInput, ctx: WriteContext): Promise<RenderFarmMetric>;
  getRenderMetricsByProject(projectId: string, from?: string, to?: string): Promise<RenderFarmMetric[]>;
  getRenderMetricsByShot(shotId: string): Promise<RenderFarmMetric[]>;
  upsertDownstreamUsageCount(input: UpsertDownstreamUsageCountInput, ctx: WriteContext): Promise<DownstreamUsageCount>;
  getDownstreamUsageCount(entityType: string, entityId: string): Promise<DownstreamUsageCount | null>;
}

export type PersistenceBackend = "local" | "vast";

export interface IngestInput {
  title: string;
  sourceUri: string;
  annotationHook?: AnnotationHookMetadata | null;
  // Optional — provided by ScannerFunction (VAST DataEngine trigger)
  shotId?: string;
  projectId?: string;
  versionLabel?: string;
  fileSizeBytes?: number;
  md5Checksum?: string;
  createdBy?: string;
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

export interface PersistenceAdapter extends VfxHierarchyAdapter {
  readonly backend: PersistenceBackend;
  reset(): void;
  createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult>;
  getAssetById(assetId: string): Promise<Asset | null>;
  updateAsset(
    assetId: string,
    updates: Partial<Pick<Asset, "metadata" | "version" | "integrity">>,
    context: WriteContext
  ): Promise<Asset | null>;
  setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): Promise<WorkflowJob | null>;
  updateJobStatus(
    jobId: string,
    expectedStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    context: WriteContext
  ): Promise<boolean>;
  getJobById(jobId: string): Promise<WorkflowJob | null>;
  getPendingJobs(): Promise<WorkflowJob[]>;
  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;
  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null>;
  reapStaleLeases(nowIso: string): Promise<number>;
  handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult>;
  replayJob(jobId: string, context: WriteContext): Promise<WorkflowJob | null>;
  getDlqItems(): Promise<DlqItem[]>;
  getDlqItem(jobId: string): Promise<DlqItem | null>;
  purgeDlqItems(beforeIso: string): Promise<number>;
  getOutboxItems(): Promise<OutboxItem[]>;
  publishOutbox(context: WriteContext): Promise<number>;
  getWorkflowStats(nowIso?: string): Promise<WorkflowStats>;
  listAssetQueueRows(): Promise<AssetQueueRow[]>;
  getAuditEvents(): Promise<AuditEvent[]>;
  previewAuditRetention(cutoffIso: string): Promise<AuditRetentionPreview>;
  applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): Promise<AuditRetentionApplyResult>;
  getIncidentCoordination(): Promise<IncidentCoordination>;
  updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext): Promise<IncidentGuidedActions>;
  addIncidentNote(input: IncidentNoteInput, context: WriteContext): Promise<IncidentNote>;
  updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext): Promise<IncidentHandoff>;
  // Approval audit log
  appendApprovalAuditEntry(entry: ApprovalAuditEntry): Promise<void>;
  getApprovalAuditLog(): Promise<ApprovalAuditEntry[]>;
  getApprovalAuditLogByAssetId(assetId: string): Promise<ApprovalAuditEntry[]>;
  resetApprovalAuditLog(): Promise<void>;

  // DCC audit trail
  appendDccAuditEntry(entry: DccAuditEntry): Promise<void>;
  getDccAuditTrail(): Promise<readonly DccAuditEntry[]>;
  clearDccAuditTrail(): Promise<void>;

  hasProcessedEvent(eventId: string): Promise<boolean>;
  markProcessedEvent(eventId: string): Promise<void>;

  /**
   * Atomically check whether an event has been processed and mark it in one
   * operation, closing the TOCTOU race window (CWE-367 / M13).
   *
   * Returns `true` if the event was newly marked (i.e. it had NOT been
   * processed before). Returns `false` if the event was already marked
   * (duplicate).
   *
   * For in-memory adapters this is a single synchronous check-and-set on
   * the backing Map. For distributed / SQL-backed adapters this MUST use
   * a database-level atomic primitive (e.g. INSERT … ON CONFLICT DO NOTHING
   * with a UNIQUE constraint, or an equivalent compare-and-swap).
   */
  markIfNotProcessed(eventId: string): Promise<boolean>;

  // Review Sessions (dailies-oriented)
  createReviewSession(input: CreateReviewSessionInput, ctx: WriteContext): Promise<ReviewSession>;
  getReviewSessionById(id: string): Promise<ReviewSession | null>;
  listReviewSessions(filters?: { projectId?: string; status?: ReviewSessionStatus; department?: string }): Promise<ReviewSession[]>;
  updateReviewSessionStatus(id: string, fromStatus: ReviewSessionStatus, toStatus: ReviewSessionStatus, ctx: WriteContext): Promise<ReviewSession | null>;
  addSubmission(input: AddSubmissionInput, ctx: WriteContext): Promise<ReviewSessionSubmission>;
  listSubmissionsBySession(sessionId: string): Promise<ReviewSessionSubmission[]>;
  updateSubmissionStatus(id: string, fromStatus: SubmissionStatus, toStatus: SubmissionStatus, ctx: WriteContext): Promise<ReviewSessionSubmission | null>;

  // Asset Notes
  getAssetNotes(assetId: string): Promise<AssetNote[]>;
  createAssetNote(assetId: string, input: { body: string; createdBy: string; correlationId: string }): Promise<AssetNote>;

  // Asset Archive (soft-delete)
  archiveAsset(assetId: string, ctx: WriteContext): Promise<void>;

  // ── Version files (multi-file manifest) ──
  createVersionFiles(input: VersionFileInput[], ctx: WriteContext): Promise<VersionFileRecord[]>;
  listVersionFiles(versionId: string): Promise<VersionFileRecord[]>;

  // ── Triggers ──
  listTriggers(filter?: { enabled?: boolean }): Promise<TriggerRecord[]>;
  getTrigger(id: string): Promise<TriggerRecord | null>;
  createTrigger(input: TriggerInput, ctx: WriteContext): Promise<TriggerRecord>;
  updateTrigger(id: string, updates: Partial<TriggerInput>, ctx: WriteContext): Promise<TriggerRecord | null>;
  deleteTrigger(id: string, ctx: WriteContext): Promise<boolean>;
  recordTriggerFire(id: string, ctx: WriteContext): Promise<void>;

  // ── Webhook endpoints ──
  listWebhookEndpoints(filter?: { direction?: "inbound" | "outbound"; includeRevoked?: boolean }): Promise<WebhookEndpointRecord[]>;
  getWebhookEndpoint(id: string): Promise<WebhookEndpointRecord | null>;
  createWebhookEndpoint(input: WebhookEndpointInput, ctx: WriteContext): Promise<WebhookEndpointRecord>;
  revokeWebhookEndpoint(id: string, ctx: WriteContext): Promise<boolean>;
  recordWebhookUsed(id: string, ctx: WriteContext): Promise<void>;

  // ── Webhook delivery log ──
  createWebhookDelivery(input: WebhookDeliveryInput): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(filter?: { webhookId?: string; status?: string; limit?: number }): Promise<WebhookDeliveryRecord[]>;

  // ── Workflow definitions + instances ──
  listWorkflowDefinitions(filter?: { enabled?: boolean; includeDeleted?: boolean }): Promise<WorkflowDefinitionRecord[]>;
  getWorkflowDefinition(id: string): Promise<WorkflowDefinitionRecord | null>;
  getWorkflowDefinitionByName(name: string): Promise<WorkflowDefinitionRecord | null>;
  createWorkflowDefinition(input: WorkflowDefinitionInput, ctx: WriteContext): Promise<WorkflowDefinitionRecord>;
  updateWorkflowDefinition(id: string, updates: Partial<WorkflowDefinitionInput>, ctx: WriteContext): Promise<WorkflowDefinitionRecord | null>;
  deleteWorkflowDefinition(id: string, ctx: WriteContext): Promise<boolean>;

  createWorkflowInstance(input: WorkflowInstanceInput, ctx: WriteContext): Promise<WorkflowInstanceRecord>;
  getWorkflowInstance(id: string): Promise<WorkflowInstanceRecord | null>;
  listWorkflowInstances(filter?: { definitionId?: string; state?: string; parentEntityType?: string; parentEntityId?: string; limit?: number }): Promise<WorkflowInstanceRecord[]>;
  updateWorkflowInstance(id: string, updates: Partial<WorkflowInstanceUpdate>, ctx: WriteContext): Promise<WorkflowInstanceRecord | null>;
  recordWorkflowTransition(input: WorkflowTransitionInput, ctx: WriteContext): Promise<void>;
  listWorkflowTransitions(instanceId: string): Promise<WorkflowTransitionRecord[]>;

  // ── DataEngine dispatches (migration 022) ──
  createDataEngineDispatches(inputs: DataEngineDispatchInput[], ctx: WriteContext): Promise<DataEngineDispatchRecord[]>;
  listDataEngineDispatches(filter?: { versionId?: string; checkinId?: string; status?: string; limit?: number }): Promise<DataEngineDispatchRecord[]>;
  listPendingDispatchesForPolling(now: string, limit?: number): Promise<DataEngineDispatchRecord[]>;
  getDataEngineDispatch(id: string): Promise<DataEngineDispatchRecord | null>;
  updateDataEngineDispatch(id: string, update: Partial<DataEngineDispatchUpdate>, ctx: WriteContext): Promise<DataEngineDispatchRecord | null>;

  // ── Atomic check-in state ──
  createCheckin(input: CheckinInput, ctx: WriteContext): Promise<CheckinRecord>;
  getCheckin(id: string): Promise<CheckinRecord | null>;
  updateCheckinState(
    id: string,
    updates: Partial<Pick<CheckinRecord, "state" | "committedAt" | "abortedAt" | "lastError">>,
    ctx: WriteContext,
  ): Promise<CheckinRecord | null>;

  // ── S3 compensation log ──
  createS3CompensationLog(input: S3CompensationInput, ctx: WriteContext): Promise<S3CompensationRecord>;
  listS3CompensationByTxId(txId: string): Promise<S3CompensationRecord[]>;
  markS3CompensationCommitted(txId: string, ctx: WriteContext): Promise<number>;
  markS3CompensationCompensated(id: string, ctx: WriteContext): Promise<void>;
  markS3CompensationFailed(id: string, error: string, ctx: WriteContext): Promise<void>;

  // ── Version status update ──
  updateVersionStatus(
    versionId: string,
    status: string,
    ctx: WriteContext,
  ): Promise<void>;

  // ── Version sentinel upsert ──
  upsertVersionSentinel(
    shotId: string,
    context: string,
    sentinelName: string,
    pointsToVersionId: string,
    ctx: WriteContext,
  ): Promise<void>;

  /**
   * Framework-enforced audit emission (append-only).
   *
   * Called by Fastify `onResponse` hook for every mutation. Unlike the
   * domain-specific `appendApprovalAuditEntry` / `appendDccAuditEntry`
   * methods, this is a generic primitive that captures the HTTP request
   * envelope (method, path, status, actor, correlation_id).
   */
  recordRequestAudit(event: {
    message: string;
    correlationId: string;
    actor?: string;
    method?: string;
    path?: string;
    statusCode?: number;
  }): Promise<void>;

  // Custom Fields (runtime-extensible entity metadata)
  listCustomFieldDefinitions(entityType?: string, includeDeleted?: boolean): Promise<CustomFieldDefinitionRecord[]>;
  getCustomFieldDefinition(id: string): Promise<CustomFieldDefinitionRecord | null>;
  createCustomFieldDefinition(input: CustomFieldDefinitionInput, ctx: WriteContext): Promise<CustomFieldDefinitionRecord>;
  updateCustomFieldDefinition(id: string, input: Partial<CustomFieldDefinitionInput>, ctx: WriteContext): Promise<CustomFieldDefinitionRecord | null>;
  softDeleteCustomFieldDefinition(id: string, ctx: WriteContext): Promise<boolean>;
  getCustomFieldValues(entityType: string, entityId: string): Promise<CustomFieldValueRecord[]>;
  setCustomFieldValue(input: CustomFieldValueInput, ctx: WriteContext): Promise<CustomFieldValueRecord>;
  deleteCustomFieldValue(definitionId: string, entityType: string, entityId: string, ctx: WriteContext): Promise<boolean>;

  // ── Naming templates (migration 023) ──
  listNamingTemplates(filter?: { scope?: string; enabled?: boolean; includeDeleted?: boolean }): Promise<NamingTemplateRecord[]>;
  getNamingTemplate(id: string): Promise<NamingTemplateRecord | null>;
  createNamingTemplate(input: NamingTemplateInput, ctx: WriteContext): Promise<NamingTemplateRecord>;
  updateNamingTemplate(id: string, updates: NamingTemplateUpdate, ctx: WriteContext): Promise<NamingTemplateRecord | null>;
  softDeleteNamingTemplate(id: string, ctx: WriteContext): Promise<boolean>;
}

export interface AssetNote {
  id: string;
  assetId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export type VersionFileRole = "primary" | "sidecar" | "proxy" | "frame_range" | "audio" | "reference";

export interface VersionFileInput {
  versionId: string;
  role: VersionFileRole;
  filename: string;
  s3Bucket: string;
  s3Key: string;
  contentType?: string;
  sizeBytes?: number;
  checksum?: string;
  checksumAlgorithm?: string;
  frameRangeStart?: number;
  frameRangeEnd?: number;
  framePadding?: number;
  checkinId?: string;
}

export interface VersionFileRecord extends Required<Omit<VersionFileInput, "contentType" | "sizeBytes" | "checksum" | "checksumAlgorithm" | "frameRangeStart" | "frameRangeEnd" | "framePadding" | "checkinId">> {
  id: string;
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  checksumAlgorithm: string | null;
  frameRangeStart: number | null;
  frameRangeEnd: number | null;
  framePadding: number | null;
  checkinId: string | null;
  createdAt: string;
}

// ── Triggers ──

export type TriggerActionKind = "http_call" | "enqueue_job" | "run_workflow" | "run_script" | "post_event";

export interface TriggerInput {
  name: string;
  description?: string;
  eventSelector: string;
  conditionJson?: string;
  actionKind: TriggerActionKind;
  actionConfigJson: string;
  enabled?: boolean;
  createdBy: string;
}

export interface TriggerRecord {
  id: string;
  name: string;
  description: string | null;
  eventSelector: string;
  conditionJson: string | null;
  actionKind: TriggerActionKind;
  actionConfigJson: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
  fireCount: number;
}

// ── Webhook endpoints ──

export type WebhookDirection = "inbound" | "outbound";

export interface WebhookEndpointInput {
  name: string;
  direction: WebhookDirection;
  url?: string;
  secretHash: string;
  secretPrefix: string;
  signingAlgorithm: "hmac-sha256";
  allowedEventTypes?: string[];
  description?: string;
  createdBy: string;
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  direction: WebhookDirection;
  url: string | null;
  secretHash: string;
  secretPrefix: string;
  signingAlgorithm: string;
  allowedEventTypes: string[] | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ── Webhook delivery log ──

export type WebhookDeliveryStatus = "pending" | "in_flight" | "succeeded" | "failed" | "abandoned";

export interface WebhookDeliveryInput {
  webhookId: string;
  triggerId?: string | null;
  eventType: string;
  eventPayload?: string;
  requestUrl?: string;
  requestHeaders?: string;
  responseStatus?: number;
  responseBody?: string;
  status: WebhookDeliveryStatus;
  attemptNumber: number;
  lastError?: string;
  startedAt: string;
  completedAt?: string;
}

export interface WebhookDeliveryRecord extends Required<Omit<WebhookDeliveryInput, "triggerId" | "eventPayload" | "requestUrl" | "requestHeaders" | "responseStatus" | "responseBody" | "lastError" | "completedAt">> {
  id: string;
  triggerId: string | null;
  eventPayload: string | null;
  requestUrl: string | null;
  requestHeaders: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  lastError: string | null;
  completedAt: string | null;
}

// ── Workflow engine ──

export type WorkflowInstanceState = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface WorkflowDefinitionInput {
  name: string;
  version?: number;
  description?: string;
  dslJson: string;
  enabled?: boolean;
  createdBy: string;
}

export interface WorkflowDefinitionRecord {
  id: string;
  name: string;
  version: number;
  description: string | null;
  dslJson: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkflowInstanceInput {
  definitionId: string;
  definitionVersion: number;
  currentNodeId: string;
  contextJson: string;
  startedBy: string;
  parentEntityType?: string;
  parentEntityId?: string;
}

export interface WorkflowInstanceRecord {
  id: string;
  definitionId: string;
  definitionVersion: number;
  currentNodeId: string;
  state: WorkflowInstanceState;
  contextJson: string;
  startedBy: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  parentEntityType: string | null;
  parentEntityId: string | null;
}

export interface WorkflowInstanceUpdate {
  currentNodeId: string;
  state: WorkflowInstanceState;
  contextJson: string;
  completedAt: string | null;
  lastError: string | null;
}

export interface WorkflowTransitionInput {
  instanceId: string;
  fromNodeId: string;
  toNodeId: string;
  eventType?: string;
  actor?: string;
  payloadJson?: string;
}

export interface WorkflowTransitionRecord {
  id: string;
  instanceId: string;
  fromNodeId: string;
  toNodeId: string;
  eventType: string | null;
  actor: string | null;
  payloadJson: string | null;
  at: string;
}

export type DataEngineDispatchStatus = "pending" | "completed" | "failed" | "abandoned";

export interface DataEngineDispatchInput {
  checkinId?: string;
  versionId: string;
  fileRole: string;
  fileKind: "image" | "video" | "raw_camera";
  sourceS3Bucket: string;
  sourceS3Key: string;
  expectedFunction: string;
  metadataTargetSchema?: string;
  metadataTargetTable?: string;
  deadlineAt: string;
  correlationId?: string;
}

export interface DataEngineDispatchUpdate {
  status: DataEngineDispatchStatus;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  metadataRowId: string | null;
  lastError: string | null;
  completedAt: string | null;
  lastPolledAt: string | null;
  pollAttempts: number;
}

export interface DataEngineDispatchRecord {
  id: string;
  checkinId: string | null;
  versionId: string;
  fileRole: string;
  fileKind: string;
  sourceS3Bucket: string;
  sourceS3Key: string;
  expectedFunction: string;
  status: DataEngineDispatchStatus;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  metadataTargetSchema: string | null;
  metadataTargetTable: string | null;
  metadataRowId: string | null;
  lastError: string | null;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  pollAttempts: number;
  lastPolledAt: string | null;
  correlationId: string | null;
}

export type CheckinState = "reserved" | "committed" | "compensating" | "aborted";

export interface CheckinInput {
  txId: string;
  versionId: string;
  shotId: string;
  projectId: string;
  sequenceId: string;
  context: string;
  s3Bucket: string;
  s3Key: string;
  s3UploadId: string;
  partPlanJson: string;
  correlationId: string;
  actor: string;
  deadlineAt: string;
}

export interface CheckinRecord {
  id: string;
  txId: string;
  versionId: string;
  shotId: string;
  projectId: string;
  sequenceId: string;
  context: string;
  state: CheckinState;
  s3Bucket: string;
  s3Key: string;
  s3UploadId: string;
  partPlanJson: string;
  correlationId: string | null;
  actor: string | null;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  abortedAt: string | null;
  lastError: string | null;
}

export type S3CompensationStatus = "pending" | "committed" | "compensated" | "failed";
export type S3CompensationOperation = "CreateMultipartUpload" | "UploadPart" | "CompleteMultipartUpload" | "CopyObject" | "PutObject" | "DeleteObject";
export type S3CompensationInverse = "AbortMultipartUpload" | "DeleteObject" | "PutObject" | "noop";

export interface S3CompensationInput {
  txId: string;
  correlationId?: string;
  s3Bucket: string;
  s3Key: string;
  operation: S3CompensationOperation;
  inverseOperation: S3CompensationInverse;
  inversePayload?: Record<string, unknown>;
  actor?: string;
}

export interface S3CompensationRecord {
  id: string;
  txId: string;
  correlationId: string | null;
  s3Bucket: string;
  s3Key: string;
  operation: S3CompensationOperation;
  inverseOperation: S3CompensationInverse;
  inversePayload: Record<string, unknown> | null;
  status: S3CompensationStatus;
  actor: string | null;
  createdAt: string;
  committedAt: string | null;
  compensatedAt: string | null;
  lastError: string | null;
  attempts: number;
}

export interface CustomFieldDefinitionRecord {
  id: string;
  entityType: string;
  name: string;
  displayLabel: string;
  dataType: string;
  required: boolean;
  validationJson: string | null;
  displayConfigJson: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CustomFieldDefinitionInput {
  entityType: string;
  name: string;
  displayLabel: string;
  dataType: string;
  required?: boolean;
  validationJson?: string | null;
  displayConfigJson?: string | null;
  description?: string | null;
  createdBy: string;
}

export interface CustomFieldValueRecord {
  id: string;
  definitionId: string;
  entityType: string;
  entityId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  valueDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldValueInput {
  definitionId: string;
  entityType: string;
  entityId: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueBool?: boolean | null;
  valueDate?: string | null;
  createdBy: string;
}

// ── Naming templates (migration 023) ──

export interface NamingTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  template: string;
  sampleContextJson: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NamingTemplateInput {
  name: string;
  description?: string | null;
  scope: string;
  template: string;
  sampleContextJson?: string | null;
  enabled?: boolean;
  createdBy: string;
}

export interface NamingTemplateUpdate {
  description?: string | null;
  template?: string;
  sampleContextJson?: string | null;
  enabled?: boolean;
}
