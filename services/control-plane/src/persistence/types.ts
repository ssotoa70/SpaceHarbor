import type {
  AnnotationHookMetadata,
  ApprovalAction,
  Asset,
  AssetPriority,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  Episode,
  EpisodeStatus,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentHandoffState,
  IncidentNote,
  IngestResult,
  MediaType,
  OutboxItem,
  Project,
  ProjectStatus,
  ProjectType,
  Sequence,
  SequenceStatus,
  Shot,
  ShotStatus,
  Task,
  TaskStatus,
  TaskType,
  Version,
  VersionApproval,
  VersionStatus,
  VfxMetadata,
  WorkflowJob,
  WorkflowStatus
} from "../domain/models.js";

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
  updateTaskStatus(taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null>;
}

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

export interface PersistenceAdapter extends VfxHierarchyAdapter {
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
