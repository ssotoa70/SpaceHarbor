import { randomUUID } from "node:crypto";
import { hashAuditRow, AUDIT_GENESIS_HASH } from "../../infra/audit-chain.js";

import type {
  AnnotationHookMetadata,
  ApprovalAuditEntry,
  Asset,
  ProductionMetadata,
  AuditSignal,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  Episode,
  EpisodeStatus,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentNote,
  IngestResult,
  LookVariant,
  Material,
  MaterialDependency,
  MaterialVersion,
  OutboxItem,
  Project,
  ProjectStatus,
  ReviewStatus,
  Sequence,
  Shot,
  ShotStatus,
  Task,
  TaskStatus,
  TaskType,
  Version,
  VersionApproval,
  VersionMaterialBinding,
  VfxMetadata,
  WorkflowJob,
  WorkflowStatus,
  Timeline,
  TimelineStatus,
  TimelineClip,
  TimelineChangeSet,
  ClipConformStatus,
  ReviewSession,
  ReviewSessionSubmission,
  ReviewComment,
  CommentAnnotation,
  CommentStatus,
  VersionComparison,
  AssetProvenance,
  VersionLineage,
  AssetDependency,
  ShotAssetUsage,
  Collection,
  CollectionItem,
  Playlist,
  PlaylistItem,
  DailiesReportEntry,
  StorageMetric,
  RenderFarmMetric,
  DownstreamUsageCount
} from "../../domain/models.js";
import type { DccAuditEntry } from "../../types/dcc.js";
import { mapOutboxItemToOutboundPayload } from "../../integrations/outbound/payload-mapper.js";
import type { OutboundNotifier } from "../../integrations/outbound/notifier.js";
import type { OutboundConfig, OutboundTarget } from "../../integrations/outbound/types.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import {
  ImmutabilityViolationError,
  ReferentialIntegrityError
} from "../types.js";
import type {
  AssetStatsSnapshot,
  AuditRetentionApplyResult,
  AuditRetentionPreview,
  CreateEpisodeInput,
  CreateLookVariantInput,
  CreateMaterialDependencyInput,
  CreateMaterialInput,
  CreateMaterialVersionInput,
  CreateProjectInput,
  CreateSequenceInput,
  CreateShotInput,
  CreateTaskInput,
  CreateVersionApprovalInput,
  CreateVersionInput,
  CreateVersionMaterialBindingInput,
  CreateTimelineInput,
  CreateTimelineClipInput,
  CreateReviewSessionInput,
  CreateReviewCommentInput,
  CreateCommentAnnotationInput,
  CreateVersionComparisonInput,
  CreateProvenanceInput,
  CreateLineageEdgeInput,
  CreateDependencyInput,
  CreateShotAssetUsageInput,
  CreateCollectionInput,
  AddCollectionItemInput,
  CreatePlaylistInput,
  AddPlaylistItemInput,
  UpdatePlaylistItemDecisionInput,
  AddSubmissionInput,
  CreateStorageMetricInput,
  CreateRenderFarmMetricInput,
  UpsertDownstreamUsageCountInput,
  FailureResult,
  IncidentGuidedActionsUpdate,
  IncidentHandoffUpdate,
  IncidentNoteInput,
  IngestInput,
  PersistenceAdapter,
  WorkflowStats,
  WriteContext,
  VersionFileRole,
  TriggerActionKind,
  WebhookDirection,
  WebhookDeliveryStatus,
  WorkflowInstanceState,
  DataEngineDispatchStatus,
} from "../types.js";

interface QueueEntry {
  jobId: string;
  assetId: string;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

function parseMaxAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SPACEHARBOR_MAX_JOB_ATTEMPTS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 3;
}

const DEFAULT_MAX_ATTEMPTS = parseMaxAttempts();

const DEFAULT_ANNOTATION_HOOK: AnnotationHookMetadata = {
  enabled: false,
  provider: null,
  contextId: null
};

const DEFAULT_HANDOFF_CHECKLIST = {
  releaseNotesReady: false,
  verificationComplete: false,
  commsDraftReady: false,
  ownerAssigned: false
} as const;

const DEFAULT_HANDOFF = {
  status: "not_ready",
  owner: null,
  lastUpdatedAt: null
} as const;

const DEFAULT_INCIDENT_GUIDED_ACTIONS: IncidentGuidedActions = {
  acknowledged: false,
  owner: "",
  escalated: false,
  nextUpdateEta: null,
  updatedAt: null
};

const DEFAULT_INCIDENT_HANDOFF: IncidentHandoff = {
  state: "none",
  fromOwner: "",
  toOwner: "",
  summary: "",
  updatedAt: null
};

function createDefaultProductionMetadata(): ProductionMetadata {
  return {
    show: null,
    episode: null,
    sequence: null,
    shot: null,
    version: null,
    vendor: null,
    priority: null,
    dueDate: null,
    owner: null
  };
}

function coalesceProductionMetadata(
  metadata: Partial<ProductionMetadata> | null | undefined
): ProductionMetadata {
  return {
    show: metadata?.show ?? null,
    episode: metadata?.episode ?? null,
    sequence: metadata?.sequence ?? null,
    shot: metadata?.shot ?? null,
    version: metadata?.version ?? null,
    vendor: metadata?.vendor ?? null,
    priority: metadata?.priority ?? null,
    dueDate: metadata?.dueDate ?? null,
    owner: metadata?.owner ?? null
  };
}

// Minimal source_uri → kind classifier used by getAssetStats.
// Extensions pulled from the same buckets the scanner-function categorises:
//   image     — stills (jpg/png/tif/exr/dpx)
//   video     — h264/prores/etc.
//   raw_camera — ARRI/RED/Sony cine-camera containers
//   other     — anything else (scripts, sidecars, audio)
function classifyKindFromUri(sourceUri: string): "image" | "video" | "raw_camera" | "other" {
  const lower = sourceUri.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = lower.slice(dot + 1);
  if (["jpg", "jpeg", "png", "tif", "tiff", "exr", "dpx", "hdr", "webp", "gif"].includes(ext)) return "image";
  if (["mov", "mp4", "mxf", "m4v", "avi", "mkv", "webm", "prores"].includes(ext)) return "video";
  if (["ari", "r3d", "braw", "arw", "cr3", "nef"].includes(ext)) return "raw_camera";
  return "other";
}

export class LocalPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "local" as const;

  private readonly assets = new Map<string, Asset>();
  private readonly assetProductionMetadata = new Map<string, ProductionMetadata>();
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly queue = new Map<string, QueueEntry>();
  private readonly dlq = new Map<string, DlqItem>();
  private readonly outbox: OutboxItem[] = [];
  private readonly auditEvents: AuditEvent[] = [];
  private incidentGuidedActions: IncidentGuidedActions = { ...DEFAULT_INCIDENT_GUIDED_ACTIONS };
  private incidentHandoff: IncidentHandoff = { ...DEFAULT_INCIDENT_HANDOFF };
  private readonly incidentNotes: IncidentNote[] = [];
  private readonly processedEventIds = new Map<string, number>();
  private static readonly PROCESSED_EVENT_IDS_CAP = parseInt(
    process.env.SPACEHARBOR_EVENT_DEDUP_SIZE ?? "10000", 10
  );
  private static readonly PROCESSED_EVENT_IDS_TTL_MS = parseInt(
    process.env.SPACEHARBOR_EVENT_DEDUP_TTL_HOURS ?? "24", 10
  ) * 3_600_000;
  private readonly approvalAuditLog: ApprovalAuditEntry[] = [];
  private readonly dccAuditTrail: DccAuditEntry[] = [];

  // VFX hierarchy stores
  private readonly projects = new Map<string, Project>();
  private readonly episodes = new Map<string, Episode>();
  private readonly sequences = new Map<string, Sequence>();
  private readonly shots = new Map<string, Shot>();
  private readonly tasks = new Map<string, Task>();
  private readonly versions = new Map<string, Version>();
  private readonly versionApprovals: VersionApproval[] = [];

  // MaterialX storage
  private readonly materials = new Map<string, Material>();
  private readonly materialVersions = new Map<string, MaterialVersion>();
  private readonly lookVariants = new Map<string, LookVariant>();
  private readonly versionMaterialBindings: VersionMaterialBinding[] = [];
  private readonly materialDependencies: MaterialDependency[] = [];

  // Timeline / OTIO storage
  private readonly timelines = new Map<string, Timeline>();
  private readonly timelineClips = new Map<string, TimelineClip>();
  private readonly timelineChangeSets = new Map<string, TimelineChangeSet>();

  // Review session storage
  private readonly reviewSessions = new Map<string, ReviewSession>();
  private readonly reviewSessionSubmissions = new Map<string, ReviewSessionSubmission>();
  private readonly reviewComments = new Map<string, ReviewComment>();
  private readonly commentAnnotations = new Map<string, CommentAnnotation>();
  private readonly versionComparisons = new Map<string, VersionComparison>();
  private readonly assetProvenances = new Map<string, AssetProvenance>();
  private readonly versionLineages = new Map<string, VersionLineage>();
  private readonly assetDependencies = new Map<string, AssetDependency>();
  private readonly shotAssetUsages = new Map<string, ShotAssetUsage>();
  private readonly collections = new Map<string, Collection>();
  private readonly collectionItems = new Map<string, CollectionItem>();
  private readonly playlists = new Map<string, Playlist>();
  private readonly playlistItems = new Map<string, PlaylistItem>();

  // Capacity Planning (Phase C.7)
  private readonly storageMetrics = new Map<string, StorageMetric>();
  private readonly renderFarmMetrics = new Map<string, RenderFarmMetric>();
  private readonly downstreamUsageCounts = new Map<string, DownstreamUsageCount>();

  // Asset notes
  private readonly assetNotes = new Map<string, Array<{ id: string; assetId: string; body: string; createdBy: string; createdAt: string }>>();

  // Archived asset IDs
  private readonly archivedAssets = new Set<string>();

  // Multi-file version manifests (migration 019)
  private readonly versionFiles = new Map<string, {
    id: string;
    versionId: string;
    role: VersionFileRole;
    filename: string;
    s3Bucket: string;
    s3Key: string;
    contentType: string | null;
    sizeBytes: number | null;
    checksum: string | null;
    checksumAlgorithm: string | null;
    frameRangeStart: number | null;
    frameRangeEnd: number | null;
    framePadding: number | null;
    checkinId: string | null;
    createdAt: string;
  }>();

  // Triggers + Webhooks (migration 020)
  private readonly triggers = new Map<string, {
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
  }>();
  private readonly webhookEndpoints = new Map<string, {
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
  }>();
  private readonly webhookDeliveryLog: Array<{
    id: string;
    webhookId: string;
    triggerId: string | null;
    eventType: string;
    eventPayload: string | null;
    requestUrl: string | null;
    requestHeaders: string | null;
    responseStatus: number | null;
    responseBody: string | null;
    status: WebhookDeliveryStatus;
    attemptNumber: number;
    lastError: string | null;
    startedAt: string;
    completedAt: string | null;
  }> = [];

  // Workflow engine (migration 021)
  private readonly workflowDefinitions = new Map<string, {
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
  }>();
  private readonly workflowInstances = new Map<string, {
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
  }>();
  private readonly workflowTransitions: Array<{
    id: string;
    instanceId: string;
    fromNodeId: string;
    toNodeId: string;
    eventType: string | null;
    actor: string | null;
    payloadJson: string | null;
    at: string;
  }> = [];

  // DataEngine dispatches (migration 022)
  private readonly dataEngineDispatches = new Map<string, {
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
  }>();

  // Atomic check-in state
  private readonly checkins = new Map<string, {
    id: string;
    txId: string;
    versionId: string;
    shotId: string;
    projectId: string;
    sequenceId: string;
    context: string;
    state: "reserved" | "committed" | "compensating" | "aborted";
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
  }>();

  // S3 compensation log
  private readonly s3CompensationLog = new Map<string, {
    id: string;
    txId: string;
    correlationId: string | null;
    s3Bucket: string;
    s3Key: string;
    operation: "CreateMultipartUpload" | "UploadPart" | "CompleteMultipartUpload" | "CopyObject" | "PutObject" | "DeleteObject";
    inverseOperation: "AbortMultipartUpload" | "DeleteObject" | "PutObject" | "noop";
    inversePayload: Record<string, unknown> | null;
    status: "pending" | "committed" | "compensated" | "failed";
    actor: string | null;
    createdAt: string;
    committedAt: string | null;
    compensatedAt: string | null;
    lastError: string | null;
    attempts: number;
  }>();

  // Custom fields
  private readonly customFieldDefinitions = new Map<string, {
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
  }>();
  private readonly customFieldValues = new Map<string, {
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
  }>();

  // Naming templates (migration 023)
  private readonly namingTemplates = new Map<string, {
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
  }>();

  private readonly outboundCounters = {
    attempts: 0,
    success: 0,
    failure: 0,
    byTarget: {
      slack: { attempts: 0, success: 0, failure: 0 },
      teams: { attempts: 0, success: 0, failure: 0 },
      production: { attempts: 0, success: 0, failure: 0 }
    }
  };

  constructor(
    private readonly outboundConfig: OutboundConfig | null = null,
    private readonly outboundNotifier: OutboundNotifier | null = null
  ) {}

  reset(): void {
    this.assets.clear();
    this.assetProductionMetadata.clear();
    this.jobs.clear();
    this.queue.clear();
    this.dlq.clear();
    this.outbox.length = 0;
    this.auditEvents.length = 0;
    this.incidentGuidedActions = { ...DEFAULT_INCIDENT_GUIDED_ACTIONS };
    this.incidentHandoff = { ...DEFAULT_INCIDENT_HANDOFF };
    this.incidentNotes.length = 0;
    this.processedEventIds.clear();
    this.approvalAuditLog.length = 0;
    this.dccAuditTrail.length = 0;
    this.outboundCounters.attempts = 0;
    this.outboundCounters.success = 0;
    this.outboundCounters.failure = 0;
    this.outboundCounters.byTarget.slack = { attempts: 0, success: 0, failure: 0 };
    this.outboundCounters.byTarget.teams = { attempts: 0, success: 0, failure: 0 };
    this.outboundCounters.byTarget.production = { attempts: 0, success: 0, failure: 0 };
    // VFX hierarchy
    this.projects.clear();
    this.episodes.clear();
    this.sequences.clear();
    this.shots.clear();
    this.tasks.clear();
    this.versions.clear();
    this.versionApprovals.length = 0;
    // MaterialX
    this.materials.clear();
    this.materialVersions.clear();
    this.lookVariants.clear();
    this.versionMaterialBindings.length = 0;
    this.materialDependencies.length = 0;
    // Review sessions
    this.reviewSessions.clear();
    this.reviewSessionSubmissions.clear();
    this.reviewComments.clear();
    this.commentAnnotations.clear();
    this.versionComparisons.clear();
    this.collections.clear();
    this.collectionItems.clear();
    this.playlists.clear();
    this.playlistItems.clear();
    // Capacity Planning
    this.storageMetrics.clear();
    this.renderFarmMetrics.clear();
    this.downstreamUsageCounts.clear();
    // Asset notes + archive
    this.assetNotes.clear();
    this.archivedAssets.clear();
    // Custom fields
    this.customFieldDefinitions.clear();
    this.customFieldValues.clear();
    // Atomic check-in
    this.checkins.clear();
    this.s3CompensationLog.clear();
    // Version files + Triggers + Webhooks + Workflows + Dispatches
    this.versionFiles.clear();
    this.triggers.clear();
    this.webhookEndpoints.clear();
    this.webhookDeliveryLog.length = 0;
    this.workflowDefinitions.clear();
    this.workflowInstances.clear();
    this.workflowTransitions.length = 0;
    this.dataEngineDispatches.clear();
  }

  async createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult> {
    const now = this.resolveNow(context);
    const asset: Asset = {
      id: randomUUID(),
      title: input.title,
      sourceUri: input.sourceUri,
      createdAt: now.toISOString(),
      ...(input.shotId !== undefined && { shotId: input.shotId }),
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.versionLabel !== undefined && { versionLabel: input.versionLabel }),
    };

    const job: WorkflowJob = {
      id: randomUUID(),
      assetId: asset.id,
      sourceUri: input.sourceUri,
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastError: null,
      attemptCount: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: now.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      thumbnail: null,
      proxy: null,
      annotationHook: input.annotationHook ?? DEFAULT_ANNOTATION_HOOK,
      handoffChecklist: { ...DEFAULT_HANDOFF_CHECKLIST },
      handoff: { ...DEFAULT_HANDOFF }
    };

    this.assets.set(asset.id, asset);
    this.assetProductionMetadata.set(asset.id, createDefaultProductionMetadata());
    this.jobs.set(job.id, job);
    this.queue.set(job.id, {
      jobId: job.id,
      assetId: asset.id,
      availableAt: now.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null
    });

    this.recordAudit(`asset registered: ${asset.title}`, context.correlationId, now);
    this.enqueueOutbox(
      "media.process.requested.v1",
      context.correlationId,
      {
        assetId: asset.id,
        jobId: job.id,
        title: asset.title,
        sourceUri: asset.sourceUri
      },
      now
    );

    return { asset, job };
  }

  async getAssetById(assetId: string): Promise<Asset | null> {
    return this.assets.get(assetId) ?? null;
  }

  async updateAsset(
    assetId: string,
    updates: Partial<Pick<Asset, "metadata" | "version" | "integrity">>,
    context: WriteContext
  ): Promise<Asset | null> {
    const existing = this.assets.get(assetId);
    if (!existing) {
      return null;
    }

    const now = this.resolveNow(context);
    const updated: Asset = {
      ...existing,
      updatedAt: now.toISOString(),
      metadata: updates.metadata !== undefined
        ? { ...existing.metadata, ...updates.metadata }
        : existing.metadata,
      version: updates.version !== undefined
        ? updates.version
        : existing.version,
      integrity: updates.integrity !== undefined
        ? updates.integrity
        : existing.integrity,
    };

    this.assets.set(assetId, updated);
    this.recordAudit(`asset ${assetId} metadata updated`, context.correlationId, now);
    return updated;
  }

  async setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): Promise<WorkflowJob | null> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return null;
    }

    if (!canTransitionWorkflowStatus(existing.status, status)) {
      return null;
    }

    const now = this.resolveNow(context);
    const updated: WorkflowJob = {
      ...existing,
      status,
      lastError: lastError ?? existing.lastError,
      updatedAt: now.toISOString(),
      leaseOwner: status === "processing" ? existing.leaseOwner : null,
      leaseExpiresAt: status === "processing" ? existing.leaseExpiresAt : null,
      nextAttemptAt: status === "pending" ? now.toISOString() : existing.nextAttemptAt
    };

    this.jobs.set(jobId, updated);

    if (status === "completed") {
      this.queue.delete(jobId);
      this.dlq.delete(jobId);
      this.enqueueOutbox(
        "media.process.completed.v1",
        context.correlationId,
        { jobId: updated.id, assetId: updated.assetId },
        now
      );
    }

    if (status === "pending") {
      this.queue.set(jobId, {
        jobId: updated.id,
        assetId: updated.assetId,
        availableAt: now.toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null
      });
    }

    if (status === "failed") {
      this.queue.delete(jobId);
    }

    this.recordAudit(`job ${jobId} moved to ${status}`, context.correlationId, now);
    return updated;
  }

  async updateJobStatus(
    jobId: string,
    expectedStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    context: WriteContext
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);

    // CAS check: only update if status matches expected
    if (!job || job.status !== expectedStatus) {
      return false;  // CAS failed
    }

    // CAS succeeded: update job status using existing setJobStatus logic
    await this.setJobStatus(jobId, newStatus, null, context);
    return true;  // CAS succeeded
  }

  async getJobById(jobId: string): Promise<WorkflowJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getPendingJobs(): Promise<WorkflowJob[]> {
    const nowMs = Date.now();
    const jobs: WorkflowJob[] = [];

    for (const entry of this.queue.values()) {
      if (new Date(entry.availableAt).getTime() > nowMs) {
        continue;
      }
      if (entry.leaseExpiresAt && new Date(entry.leaseExpiresAt).getTime() > nowMs) {
        continue;
      }
      const job = this.jobs.get(entry.jobId);
      if (job && job.status === "pending") {
        jobs.push(job);
      }
    }

    return jobs;
  }

  async claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null> {
    const now = this.resolveNow(context);
    const nowMs = now.getTime();
    const leaseUntil = new Date(nowMs + Math.max(1, leaseSeconds) * 1000).toISOString();

    const claimable = [...this.queue.values()]
      .filter((entry) => {
        if (new Date(entry.availableAt).getTime() > nowMs) {
          return false;
        }

        if (entry.leaseExpiresAt && new Date(entry.leaseExpiresAt).getTime() > nowMs) {
          return false;
        }

        const job = this.jobs.get(entry.jobId);
        return !!job && job.status === "pending";
      })
      .sort((a, b) => new Date(a.availableAt).getTime() - new Date(b.availableAt).getTime())[0];

    if (!claimable) {
      return null;
    }

    const job = this.jobs.get(claimable.jobId);
    if (!job) {
      return null;
    }

    // CAS (Compare-And-Swap) safety check: verify job state hasn't changed since selection
    // This catches race conditions where another worker claimed the job between find and update
    if (job.status !== "pending" || job.leaseOwner) {
      return null;
    }

    const updated: WorkflowJob = {
      ...job,
      status: "processing",
      attemptCount: job.attemptCount + 1,
      nextAttemptAt: null,
      leaseOwner: workerId,
      leaseExpiresAt: leaseUntil,
      updatedAt: now.toISOString()
    };

    this.jobs.set(updated.id, updated);
    this.queue.set(updated.id, {
      ...claimable,
      availableAt: now.toISOString(),
      leaseOwner: workerId,
      leaseExpiresAt: leaseUntil
    });

    this.recordAudit(`job ${updated.id} claimed by ${workerId}`, context.correlationId, now);
    this.enqueueOutbox(
      "media.process.claimed.v1",
      context.correlationId,
      { jobId: updated.id, assetId: updated.assetId, workerId, attemptCount: updated.attemptCount },
      now
    );

    return updated;
  }

  async heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): Promise<WorkflowJob | null> {
    const now = this.resolveNow(context);
    const job = this.jobs.get(jobId);
    const queueEntry = this.queue.get(jobId);
    if (!job || !queueEntry || job.leaseOwner !== workerId || queueEntry.leaseOwner !== workerId) {
      return null;
    }

    const leaseUntil = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString();

    const updated: WorkflowJob = {
      ...job,
      leaseExpiresAt: leaseUntil,
      updatedAt: now.toISOString()
    };

    this.jobs.set(jobId, updated);
    this.queue.set(jobId, {
      ...queueEntry,
      leaseExpiresAt: leaseUntil
    });

    this.recordAudit(`job ${jobId} heartbeat by ${workerId}`, context.correlationId, now);

    return updated;
  }

  async reapStaleLeases(nowIso: string): Promise<number> {
    const now = new Date(nowIso);
    let requeuedCount = 0;

    for (const entry of this.queue.values()) {
      if (!entry.leaseExpiresAt) {
        continue;
      }
      if (new Date(entry.leaseExpiresAt).getTime() > now.getTime()) {
        continue;
      }

      const job = this.jobs.get(entry.jobId);
      if (!job || job.status !== "processing") {
        continue;
      }

      const updated: WorkflowJob = {
        ...job,
        status: "pending",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      this.jobs.set(job.id, updated);
      this.queue.set(job.id, {
        ...entry,
        availableAt: now.toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null
      });

      this.recordAudit(`job ${job.id} requeued after stale lease`, "system", now);
      this.enqueueOutbox(
        "media.process.requeued.stale.v1",
        "system",
        { jobId: job.id, assetId: job.assetId },
        now
      );

      requeuedCount += 1;
    }

    return requeuedCount;
  }

  async handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return {
        accepted: false,
        message: `job not found: ${jobId}`
      };
    }

    const now = this.resolveNow(context);

    if (job.attemptCount < job.maxAttempts) {
      const backoffSeconds = this.backoffSeconds(job.attemptCount);
      const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();

      const updated: WorkflowJob = {
        ...job,
        status: "pending",
        lastError: error,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        updatedAt: now.toISOString()
      };

      this.jobs.set(job.id, updated);
      this.queue.set(job.id, {
        jobId: job.id,
        assetId: job.assetId,
        availableAt: nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null
      });

      this.recordAudit(`job ${job.id} scheduled retry #${job.attemptCount + 1}`, context.correlationId, now);
      this.enqueueOutbox(
        "media.process.retry.scheduled.v1",
        context.correlationId,
        {
          jobId: job.id,
          assetId: job.assetId,
          attemptCount: job.attemptCount,
          nextAttemptAt,
          error
        },
        now
      );

      return {
        accepted: true,
        status: "pending",
        retryScheduled: true,
        movedToDlq: false
      };
    }

    const failed: WorkflowJob = {
      ...job,
      status: "failed",
      lastError: error,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      updatedAt: now.toISOString()
    };

    this.jobs.set(job.id, failed);
    this.queue.delete(job.id);

    const dlqItem: DlqItem = {
      id: randomUUID(),
      jobId: job.id,
      assetId: job.assetId,
      error,
      attemptCount: job.attemptCount,
      failedAt: now.toISOString()
    };
    this.dlq.set(job.id, dlqItem);

    this.recordAudit(`job ${job.id} moved to DLQ`, context.correlationId, now);
    this.enqueueOutbox(
      "media.process.dead_lettered.v1",
      context.correlationId,
      {
        jobId: job.id,
        assetId: job.assetId,
        attemptCount: job.attemptCount,
        error
      },
      now
    );

    return {
      accepted: true,
      status: "failed",
      retryScheduled: false,
      movedToDlq: true
    };
  }

  async replayJob(jobId: string, context: WriteContext): Promise<WorkflowJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    const now = this.resolveNow(context);
    this.dlq.delete(jobId);

    const replayed: WorkflowJob = {
      ...job,
      status: "pending",
      lastError: null,
      attemptCount: 0,
      nextAttemptAt: now.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now.toISOString()
    };

    this.jobs.set(jobId, replayed);
    this.queue.set(jobId, {
      jobId,
      assetId: replayed.assetId,
      availableAt: now.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null
    });

    this.recordAudit(`job ${jobId} replayed`, context.correlationId, now);
    this.enqueueOutbox(
      "media.process.replay.requested.v1",
      context.correlationId,
      { jobId, assetId: replayed.assetId },
      now
    );

    return replayed;
  }

  async getDlqItems(): Promise<DlqItem[]> {
    return [...this.dlq.values()].sort((a, b) => b.failedAt.localeCompare(a.failedAt));
  }

  async getDlqItem(jobId: string): Promise<DlqItem | null> {
    return this.dlq.get(jobId) ?? null;
  }

  async purgeDlqItems(beforeIso: string): Promise<number> {
    let purgedCount = 0;
    for (const [jobId, item] of this.dlq) {
      if (item.failedAt < beforeIso) {
        this.dlq.delete(jobId);
        purgedCount += 1;
      }
    }
    return purgedCount;
  }

  async getOutboxItems(): Promise<OutboxItem[]> {
    return [...this.outbox];
  }

  async publishOutbox(context: WriteContext): Promise<number> {
    const now = this.resolveNow(context).toISOString();
    let publishedCount = 0;

    for (const item of this.outbox) {
      if (item.publishedAt) {
        continue;
      }

      const targets = this.outboundConfig?.targets ?? [];
      let deliveryFailed = false;
      if (targets.length > 0 && this.outboundNotifier) {
        for (const target of targets) {
          const payload = mapOutboxItemToOutboundPayload(item, target.target);
          this.incrementOutboundCounter(target.target, "attempts");
          try {
            await this.outboundNotifier.notify(target, payload);
            this.incrementOutboundCounter(target.target, "success");
          } catch (error) {
            this.incrementOutboundCounter(target.target, "failure");
            this.recordAudit(
              `outbound ${target.target} delivery failed for ${item.eventType}: ${error instanceof Error ? error.message : String(error)}`,
              context.correlationId,
              new Date(now)
            );
            deliveryFailed = true;
            break;
          }
        }
      }

      if (deliveryFailed) {
        continue;
      }

      item.publishedAt = now;
      publishedCount += 1;
    }

    if (publishedCount > 0) {
      this.recordAudit(`outbox published ${publishedCount} item(s)`, context.correlationId, new Date(now));
    }

    return publishedCount;
  }

  async getWorkflowStats(nowIso = new Date().toISOString()): Promise<WorkflowStats> {
    const nowMs = new Date(nowIso).getTime();
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let needsReplay = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case "pending":
          pending += 1;
          break;
        case "processing":
          processing += 1;
          break;
        case "completed":
          completed += 1;
          break;
        case "failed":
          failed += 1;
          break;
        case "needs_replay":
          needsReplay += 1;
          break;
      }
    }

    let queuePending = 0;
    let queueLeased = 0;
    for (const entry of this.queue.values()) {
      const leaseActive = !!entry.leaseExpiresAt && new Date(entry.leaseExpiresAt).getTime() > nowMs;
      if (leaseActive) {
        queueLeased += 1;
        continue;
      }

      const available = new Date(entry.availableAt).getTime() <= nowMs;
      if (available) {
        queuePending += 1;
      }
    }

    const outboxPending = this.outbox.filter((item) => !item.publishedAt).length;
    const outboxPublished = this.outbox.filter((item) => !!item.publishedAt).length;

    return {
      assets: {
        total: this.assets.size
      },
      jobs: {
        total: this.jobs.size,
        pending,
        processing,
        completed,
        failed,
        needsReplay
      },
      queue: {
        pending: queuePending,
        leased: queueLeased
      },
      outbox: {
        pending: outboxPending,
        published: outboxPublished
      },
      dlq: {
        total: this.dlq.size
      },
      degradedMode: {
        fallbackEvents: 0
      },
      outbound: {
        attempts: this.outboundCounters.attempts,
        success: this.outboundCounters.success,
        failure: this.outboundCounters.failure,
        byTarget: {
          slack: { ...this.outboundCounters.byTarget.slack },
          teams: { ...this.outboundCounters.byTarget.teams },
          production: { ...this.outboundCounters.byTarget.production }
        }
      }
    };
  }

  async getAssetStats(): Promise<AssetStatsSnapshot> {
    // Build latest-job lookup so status mirrors how listAssetQueueRows
    // derives it (coalesces to "pending" when no job exists).
    const latestJobByAssetId = new Map<string, WorkflowJob>();
    for (const job of this.jobs.values()) {
      latestJobByAssetId.set(job.assetId, job);
    }

    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const asset of this.assets.values()) {
      const status = latestJobByAssetId.get(asset.id)?.status ?? "pending";
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      const kind = classifyKindFromUri(asset.sourceUri);
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }

    // Local adapter has no asset_integrity tables; always 0.
    return {
      total: this.assets.size,
      byStatus,
      byKind,
      integrity: { hashed: 0, withKeyframes: 0 }
    };
  }

  async listAssetQueueRows(): Promise<AssetQueueRow[]> {
    const latestJobByAssetId = new Map<string, WorkflowJob>();
    for (const job of this.jobs.values()) {
      latestJobByAssetId.set(job.assetId, job);
    }

    return [...this.assets.values()].map((asset) => {
      const latestJob = latestJobByAssetId.get(asset.id);
      const storedProductionMetadata = this.assetProductionMetadata.get(asset.id);
      return {
        id: asset.id,
        jobId: latestJob?.id ?? null,
        title: asset.title,
        sourceUri: asset.sourceUri,
        status: latestJob?.status ?? "pending",
        thumbnail: latestJob?.thumbnail ?? null,
        proxy: latestJob?.proxy ?? null,
        annotationHook: latestJob?.annotationHook ?? DEFAULT_ANNOTATION_HOOK,
        handoffChecklist: latestJob?.handoffChecklist ?? { ...DEFAULT_HANDOFF_CHECKLIST },
        handoff: latestJob?.handoff ?? { ...DEFAULT_HANDOFF },
        productionMetadata: coalesceProductionMetadata(storedProductionMetadata)
      };
    });
  }

  async getAuditEvents(): Promise<AuditEvent[]> {
    return [...this.auditEvents];
  }

  async previewAuditRetention(cutoffIso: string): Promise<AuditRetentionPreview> {
    const cutoff = Date.parse(cutoffIso);
    if (Number.isNaN(cutoff)) {
      return {
        eligibleCount: 0,
        oldestEligibleAt: null,
        newestEligibleAt: null
      };
    }

    const eligible = this.auditEvents
      .map((event) => ({ event, atMs: Date.parse(event.at) }))
      .filter((entry) => !Number.isNaN(entry.atMs) && entry.atMs < cutoff)
      .sort((a, b) => a.atMs - b.atMs);

    if (eligible.length === 0) {
      return {
        eligibleCount: 0,
        oldestEligibleAt: null,
        newestEligibleAt: null
      };
    }

    return {
      eligibleCount: eligible.length,
      oldestEligibleAt: eligible[0].event.at,
      newestEligibleAt: eligible[eligible.length - 1].event.at
    };
  }

  async applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): Promise<AuditRetentionApplyResult> {
    const cutoff = Date.parse(cutoffIso);
    if (Number.isNaN(cutoff)) {
      return {
        deletedCount: 0,
        remainingCount: this.auditEvents.length
      };
    }

    const eligible = this.auditEvents
      .map((event) => ({ event, atMs: Date.parse(event.at) }))
      .filter((entry) => !Number.isNaN(entry.atMs) && entry.atMs < cutoff)
      .sort((a, b) => a.atMs - b.atMs);

    if (eligible.length === 0) {
      return {
        deletedCount: 0,
        remainingCount: this.auditEvents.length
      };
    }

    const deleteLimit =
      maxDeletePerRun === undefined ? eligible.length : Math.max(0, Math.min(maxDeletePerRun, eligible.length));
    if (deleteLimit === 0) {
      return {
        deletedCount: 0,
        remainingCount: this.auditEvents.length
      };
    }

    const deleteIds = new Set(eligible.slice(0, deleteLimit).map((entry) => entry.event.id));
    const retained = this.auditEvents.filter((event) => !deleteIds.has(event.id));
    this.auditEvents.length = 0;
    this.auditEvents.push(...retained);

    return {
      deletedCount: deleteLimit,
      remainingCount: this.auditEvents.length
    };
  }

  async getIncidentCoordination(): Promise<IncidentCoordination> {
    return {
      guidedActions: { ...this.incidentGuidedActions },
      handoff: { ...this.incidentHandoff },
      notes: [...this.incidentNotes]
    };
  }

  async updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext): Promise<IncidentGuidedActions> {
    const now = this.resolveNow(context);
    this.incidentGuidedActions = {
      acknowledged: update.acknowledged,
      owner: update.owner,
      escalated: update.escalated,
      nextUpdateEta: update.nextUpdateEta,
      updatedAt: now.toISOString()
    };

    this.recordAudit(
      `incident actions updated (acknowledged=${this.incidentGuidedActions.acknowledged}, owner=${this.incidentGuidedActions.owner || "unassigned"}, escalated=${this.incidentGuidedActions.escalated})`,
      context.correlationId,
      now
    );

    return { ...this.incidentGuidedActions };
  }

  async addIncidentNote(input: IncidentNoteInput, context: WriteContext): Promise<IncidentNote> {
    const now = this.resolveNow(context);
    const note: IncidentNote = {
      id: randomUUID(),
      message: input.message,
      correlationId: input.correlationId,
      author: input.author,
      at: now.toISOString()
    };

    this.incidentNotes.unshift(note);

    this.recordAudit(
      `incident note added by ${note.author} linked to ${note.correlationId}`,
      context.correlationId,
      now
    );

    return note;
  }

  async updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext): Promise<IncidentHandoff> {
    const now = this.resolveNow(context);
    this.incidentHandoff = {
      state: update.state,
      fromOwner: update.fromOwner,
      toOwner: update.toOwner,
      summary: update.summary,
      updatedAt: now.toISOString()
    };

    this.recordAudit(
      `incident handoff updated (${this.incidentHandoff.fromOwner || "unassigned"} -> ${this.incidentHandoff.toOwner || "unassigned"}, state=${this.incidentHandoff.state})`,
      context.correlationId,
      now
    );

    return { ...this.incidentHandoff };
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const ts = this.processedEventIds.get(eventId);
    if (ts === undefined) return false;
    // TTL check: if entry is older than TTL, treat as missing
    if (Date.now() - ts > LocalPersistenceAdapter.PROCESSED_EVENT_IDS_TTL_MS) {
      this.processedEventIds.delete(eventId);
      return false;
    }
    return true;
  }

  async markProcessedEvent(eventId: string): Promise<void> {
    this.processedEventIds.set(eventId, Date.now());
    this.evictStaleProcessedEvents();
  }

  /**
   * Atomic check-and-mark for event idempotency (CWE-367 / M13 fix).
   *
   * For the in-memory adapter, the check and set happen in a single
   * synchronous turn of the event loop, so no interleaving is possible
   * within a single Node.js process.
   *
   * NOTE: For multi-instance deployments, the SQL-backed adapter MUST use
   * a database-level atomic primitive (INSERT … ON CONFLICT DO NOTHING
   * with a UNIQUE constraint on event_id) to prevent duplicates.
   *
   * Returns `true` if the event was newly marked (not a duplicate).
   * Returns `false` if the event was already processed (duplicate).
   */
  async markIfNotProcessed(eventId: string): Promise<boolean> {
    // Single synchronous block: check + mark with no await in between.
    const existingTs = this.processedEventIds.get(eventId);
    if (existingTs !== undefined) {
      // TTL check: if entry is stale, remove it and treat as new
      if (Date.now() - existingTs > LocalPersistenceAdapter.PROCESSED_EVENT_IDS_TTL_MS) {
        this.processedEventIds.delete(eventId);
        // Fall through to mark as new below
      } else {
        return false; // Already processed — duplicate
      }
    }
    this.processedEventIds.set(eventId, Date.now());
    this.evictStaleProcessedEvents();
    return true; // Newly marked
  }

  private evictStaleProcessedEvents(): void {
    const now = Date.now();
    const ttl = LocalPersistenceAdapter.PROCESSED_EVENT_IDS_TTL_MS;

    // TTL eviction: remove entries older than TTL
    for (const [id, ts] of this.processedEventIds) {
      if (now - ts > ttl) {
        this.processedEventIds.delete(id);
      }
    }

    // LRU eviction: if still over cap, evict the oldest 10%
    if (this.processedEventIds.size > LocalPersistenceAdapter.PROCESSED_EVENT_IDS_CAP) {
      const toEvict = Math.ceil(this.processedEventIds.size * 0.1);
      let removed = 0;
      for (const id of this.processedEventIds.keys()) {
        if (removed >= toEvict) break;
        this.processedEventIds.delete(id);
        removed++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Approval audit log (moved from module-scoped state in approval.ts)
  // ---------------------------------------------------------------------------

  async appendApprovalAuditEntry(entry: ApprovalAuditEntry): Promise<void> {
    this.approvalAuditLog.push(entry);
  }

  async getApprovalAuditLog(): Promise<ApprovalAuditEntry[]> {
    return [...this.approvalAuditLog];
  }

  async getApprovalAuditLogByAssetId(assetId: string): Promise<ApprovalAuditEntry[]> {
    return this.approvalAuditLog.filter((e) => e.assetId === assetId);
  }

  async resetApprovalAuditLog(): Promise<void> {
    this.approvalAuditLog.length = 0;
  }

  // ---------------------------------------------------------------------------
  // DCC audit trail (moved from module-scoped state in dcc.ts)
  // ---------------------------------------------------------------------------

  async appendDccAuditEntry(entry: DccAuditEntry): Promise<void> {
    this.dccAuditTrail.push(entry);
  }

  async getDccAuditTrail(): Promise<readonly DccAuditEntry[]> {
    return this.dccAuditTrail;
  }

  async clearDccAuditTrail(): Promise<void> {
    this.dccAuditTrail.length = 0;
  }

  private backoffSeconds(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(60, 5 * 2 ** exponent);
  }

  private enqueueOutbox(
    eventType: string,
    correlationId: string,
    payload: Record<string, unknown>,
    now: Date
  ): void {
    this.outbox.push({
      id: randomUUID(),
      eventType,
      correlationId,
      payload,
      createdAt: now.toISOString(),
      publishedAt: null
    });
  }

  private recordAudit(message: string, correlationId: string, now: Date, signal?: AuditSignal): AuditEvent {
    // The chain is ordered oldest-first for hashing purposes, but we store
    // newest-first in memory (unshift). `auditEvents[0]` is the most recent
    // row, so its prev_hash links back to auditEvents[1].
    const prevHash = this.auditEvents[0]?.rowHash ?? AUDIT_GENESIS_HASH;
    const partial: Omit<AuditEvent, "rowHash"> = {
      id: randomUUID(),
      message: `[corr:${correlationId}] ${message}`,
      at: now.toISOString(),
      ...(signal ? { signal } : {}),
      prevHash,
    };
    const rowHash = hashAuditRow(partial);
    const event: AuditEvent = { ...partial, rowHash };
    this.auditEvents.unshift(event);
    return event;
  }

  private resolveNow(context: WriteContext): Date {
    if (context.now) {
      return new Date(context.now);
    }
    return new Date();
  }

  private incrementOutboundCounter(target: OutboundTarget, key: "attempts" | "success" | "failure"): void {
    this.outboundCounters[key] += 1;
    this.outboundCounters.byTarget[target][key] += 1;
  }

  // ---------------------------------------------------------------------------
  // VFX Hierarchy methods
  // ---------------------------------------------------------------------------

  async createProject(input: CreateProjectInput, ctx: WriteContext): Promise<Project> {
    const now = this.resolveNow(ctx).toISOString();
    const project: Project = {
      id: randomUUID(),
      code: input.code,
      name: input.name,
      type: input.type,
      status: input.status,
      frameRate: input.frameRate ?? null,
      colorSpace: input.colorSpace ?? null,
      resolutionW: input.resolutionW ?? null,
      resolutionH: input.resolutionH ?? null,
      startDate: input.startDate ?? null,
      deliveryDate: input.deliveryDate ?? null,
      owner: input.owner ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getProjectById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    const all = Array.from(this.projects.values());
    return status ? all.filter((p) => p.status === status) : all;
  }

  async createSequence(input: CreateSequenceInput, ctx: WriteContext): Promise<Sequence> {
    const project = this.projects.get(input.projectId);
    if (!project) {
      throw new ReferentialIntegrityError(
        `Project not found: ${input.projectId}`
      );
    }
    if (input.episodeId && !this.episodes.has(input.episodeId)) {
      throw new ReferentialIntegrityError(`Episode not found: ${input.episodeId}`);
    }
    const now = this.resolveNow(ctx).toISOString();
    const seq: Sequence = {
      id: randomUUID(),
      projectId: input.projectId,
      code: input.code,
      episode: input.episode ?? null,
      episodeId: input.episodeId ?? null,
      name: input.name ?? null,
      status: input.status,
      shotCount: 0,
      frameRangeStart: input.frameRangeStart ?? null,
      frameRangeEnd: input.frameRangeEnd ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.sequences.set(seq.id, seq);
    return seq;
  }

  async getSequenceById(id: string): Promise<Sequence | null> {
    return this.sequences.get(id) ?? null;
  }

  async listSequencesByProject(projectId: string): Promise<Sequence[]> {
    return Array.from(this.sequences.values()).filter((s) => s.projectId === projectId);
  }

  async createShot(input: CreateShotInput, ctx: WriteContext): Promise<Shot> {
    if (!this.projects.has(input.projectId)) {
      throw new ReferentialIntegrityError(`Project not found: ${input.projectId}`);
    }
    if (!this.sequences.has(input.sequenceId)) {
      throw new ReferentialIntegrityError(`Sequence not found: ${input.sequenceId}`);
    }
    const now = this.resolveNow(ctx).toISOString();
    const shot: Shot = {
      id: randomUUID(),
      projectId: input.projectId,
      sequenceId: input.sequenceId,
      code: input.code,
      name: input.name ?? null,
      status: input.status,
      frameRangeStart: input.frameRangeStart,
      frameRangeEnd: input.frameRangeEnd,
      frameCount: input.frameCount,
      frameRate: input.frameRate ?? null,
      vendor: input.vendor ?? null,
      lead: input.lead ?? null,
      priority: input.priority ?? null,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      latestVersionId: null,
      createdAt: now,
      updatedAt: now
    };
    this.shots.set(shot.id, shot);
    // Increment shotCount on the parent sequence
    const seq = this.sequences.get(input.sequenceId)!;
    this.sequences.set(seq.id, { ...seq, shotCount: seq.shotCount + 1, updatedAt: now });
    return shot;
  }

  async getShotById(id: string): Promise<Shot | null> {
    return this.shots.get(id) ?? null;
  }

  async listShotsBySequence(sequenceId: string): Promise<Shot[]> {
    return Array.from(this.shots.values()).filter((s) => s.sequenceId === sequenceId);
  }

  async updateShotStatus(shotId: string, status: ShotStatus, ctx: WriteContext): Promise<Shot | null> {
    const shot = this.shots.get(shotId);
    if (!shot) return null;
    const updated = { ...shot, status, updatedAt: this.resolveNow(ctx).toISOString() };
    this.shots.set(shotId, updated);
    return updated;
  }

  async createVersion(input: CreateVersionInput, ctx: WriteContext): Promise<Version> {
    if (!this.shots.has(input.shotId)) {
      throw new ReferentialIntegrityError(`Shot not found: ${input.shotId}`);
    }
    // Auto-increment version_number scoped to (shotId, context). The local
    // adapter is single-threaded (JS event loop) so there is no race to
    // retry around — unlike the VAST Trino adapter which needs retry-on-conflict.
    const context = input.context ?? "main";
    const existingVersions = Array.from(this.versions.values()).filter(
      (v) => v.shotId === input.shotId && (v.context ?? "main") === context && !v.isSentinel,
    );
    const versionNumber =
      existingVersions.length === 0
        ? 1
        : Math.max(...existingVersions.map((v) => v.versionNumber)) + 1;

    const now = this.resolveNow(ctx).toISOString();
    const version: Version = {
      id: randomUUID(),
      shotId: input.shotId,
      projectId: input.projectId,
      sequenceId: input.sequenceId,
      versionLabel: input.versionLabel,
      versionNumber,
      parentVersionId: input.parentVersionId ?? null,
      status: input.status,
      mediaType: input.mediaType,
      codec: null,
      resolutionW: null,
      resolutionH: null,
      frameRate: null,
      frameRangeStart: null,
      frameRangeEnd: null,
      headHandle: input.headHandle ?? null,
      tailHandle: input.tailHandle ?? null,
      pixelAspectRatio: null,
      displayWindow: null,
      dataWindow: null,
      compressionType: null,
      colorSpace: null,
      bitDepth: null,
      channelCount: null,
      fileSizeBytes: null,
      md5Checksum: null,
      vastElementHandle: null,
      vastPath: null,
      elementPath: null,
      createdBy: input.createdBy,
      createdAt: now,
      publishedAt: null,
      notes: input.notes ?? null,
      taskId: input.taskId ?? null,
      reviewStatus: input.reviewStatus ?? "wip",
      context,
      isSentinel: false,
      sentinelName: null,
      manifestId: null,
    };
    this.versions.set(version.id, version);
    // Update shot's latestVersionId
    const shot = this.shots.get(input.shotId)!;
    this.shots.set(shot.id, { ...shot, latestVersionId: version.id, updatedAt: now });
    return version;
  }

  async getVersionById(id: string): Promise<Version | null> {
    return this.versions.get(id) ?? null;
  }

  async listVersionsByShot(shotId: string): Promise<Version[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.shotId === shotId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async publishVersion(versionId: string, ctx: WriteContext): Promise<Version | null> {
    const version = this.versions.get(versionId);
    if (!version) return null;
    if (version.publishedAt !== null) {
      throw new ImmutabilityViolationError(
        `Version ${versionId} is already published at ${version.publishedAt}`
      );
    }
    const now = this.resolveNow(ctx).toISOString();
    const published = { ...version, status: "published" as const, publishedAt: now };
    this.versions.set(versionId, published);
    return published;
  }

  async updateVersionReviewStatus(versionId: string, status: ReviewStatus, _ctx: WriteContext): Promise<Version | null> {
    const version = this.versions.get(versionId);
    if (!version) return null;
    const updated = { ...version, reviewStatus: status };
    this.versions.set(versionId, updated);
    return updated;
  }

  async updateVersionTechnicalMetadata(
    versionId: string,
    meta: Partial<VfxMetadata>,
    ctx: WriteContext
  ): Promise<Version | null> {
    const version = this.versions.get(versionId);
    if (!version) return null;
    if (version.publishedAt !== null) {
      throw new ImmutabilityViolationError(
        `Cannot update published version ${versionId}`
      );
    }
    const updated: Version = {
      ...version,
      codec: meta.codec ?? version.codec,
      resolutionW: meta.resolution?.width ?? version.resolutionW,
      resolutionH: meta.resolution?.height ?? version.resolutionH,
      frameRate: meta.frame_rate ?? version.frameRate,
      frameRangeStart: meta.frame_range?.start ?? version.frameRangeStart,
      frameRangeEnd: meta.frame_range?.end ?? version.frameRangeEnd,
      headHandle: meta.frame_head_handle ?? version.headHandle,
      tailHandle: meta.frame_tail_handle ?? version.tailHandle,
      pixelAspectRatio: meta.pixel_aspect_ratio ?? version.pixelAspectRatio,
      compressionType: meta.compression_type ?? version.compressionType,
      colorSpace: meta.color_space ?? version.colorSpace,
      bitDepth: meta.bit_depth ?? version.bitDepth,
      fileSizeBytes: meta.file_size_bytes ?? version.fileSizeBytes,
      md5Checksum: meta.md5_checksum ?? version.md5Checksum,
      displayWindow: meta.display_window
        ? { x: meta.display_window.x, y: meta.display_window.y, w: meta.display_window.width, h: meta.display_window.height }
        : version.displayWindow,
      dataWindow: meta.data_window
        ? { x: meta.data_window.x, y: meta.data_window.y, w: meta.data_window.width, h: meta.data_window.height }
        : version.dataWindow
    };
    this.versions.set(versionId, updated);
    return updated;
  }

  async createVersionApproval(
    input: CreateVersionApprovalInput,
    ctx: WriteContext
  ): Promise<VersionApproval> {
    if (!this.versions.has(input.versionId)) {
      throw new ReferentialIntegrityError(`Version not found: ${input.versionId}`);
    }
    const approval: VersionApproval = {
      id: randomUUID(),
      versionId: input.versionId,
      shotId: input.shotId,
      projectId: input.projectId,
      action: input.action,
      performedBy: input.performedBy,
      role: input.role ?? null,
      note: input.note ?? null,
      at: this.resolveNow(ctx).toISOString()
    };
    this.versionApprovals.push(approval);
    return approval;
  }

  async listApprovalsByVersion(versionId: string): Promise<VersionApproval[]> {
    return this.versionApprovals.filter((a) => a.versionId === versionId);
  }

  // ---------------------------------------------------------------------------
  // Episode methods (SERGIO-136)
  // ---------------------------------------------------------------------------

  async createEpisode(input: CreateEpisodeInput, ctx: WriteContext): Promise<Episode> {
    if (!this.projects.has(input.projectId)) {
      throw new ReferentialIntegrityError(`Project not found: ${input.projectId}`);
    }
    const now = this.resolveNow(ctx).toISOString();
    const episode: Episode = {
      id: randomUUID(),
      projectId: input.projectId,
      code: input.code,
      name: input.name ?? null,
      status: input.status,
      sequenceCount: 0,
      createdAt: now,
      updatedAt: now
    };
    this.episodes.set(episode.id, episode);
    return episode;
  }

  async getEpisodeById(id: string): Promise<Episode | null> {
    return this.episodes.get(id) ?? null;
  }

  async listEpisodesByProject(projectId: string): Promise<Episode[]> {
    return Array.from(this.episodes.values()).filter((e) => e.projectId === projectId);
  }

  // ---------------------------------------------------------------------------
  // Task methods (SERGIO-136)
  // ---------------------------------------------------------------------------

  async createTask(input: CreateTaskInput, ctx: WriteContext): Promise<Task> {
    if (!this.shots.has(input.shotId)) {
      throw new ReferentialIntegrityError(`Shot not found: ${input.shotId}`);
    }
    const existingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.shotId === input.shotId
    );
    const taskNumber =
      existingTasks.length === 0
        ? 1
        : Math.max(...existingTasks.map((t) => t.taskNumber)) + 1;

    const now = this.resolveNow(ctx).toISOString();
    const task: Task = {
      id: randomUUID(),
      shotId: input.shotId,
      projectId: input.projectId,
      sequenceId: input.sequenceId,
      code: input.code,
      type: input.type,
      status: input.status,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      taskNumber,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async listTasksByShot(shotId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.shotId === shotId)
      .sort((a, b) => a.taskNumber - b.taskNumber);
  }

  async listTasksByAssignee(assignee: string, statusFilter?: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.assignee === assignee && (!statusFilter || t.status === statusFilter))
      .sort((a, b) => a.taskNumber - b.taskNumber);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const updated = { ...task, status, updatedAt: this.resolveNow(ctx).toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Material methods (MaterialX)
  // ---------------------------------------------------------------------------

  async createMaterial(input: CreateMaterialInput, ctx: WriteContext): Promise<Material> {
    if (!this.projects.has(input.projectId)) {
      throw new ReferentialIntegrityError(`Project not found: ${input.projectId}`);
    }
    const now = this.resolveNow(ctx).toISOString();
    const material: Material = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    };
    this.materials.set(material.id, material);
    return material;
  }

  async getMaterialById(id: string): Promise<Material | null> {
    return this.materials.get(id) ?? null;
  }

  async listMaterialsByProject(projectId: string): Promise<Material[]> {
    return Array.from(this.materials.values()).filter(
      (m) => m.projectId === projectId
    );
  }

  // ---------------------------------------------------------------------------
  // Material Version methods
  // ---------------------------------------------------------------------------

  async createMaterialVersion(input: CreateMaterialVersionInput, ctx: WriteContext): Promise<MaterialVersion> {
    if (!this.materials.has(input.materialId)) {
      throw new ReferentialIntegrityError(`Material not found: ${input.materialId}`);
    }
    if (input.parentVersionId && !this.materialVersions.has(input.parentVersionId)) {
      throw new ReferentialIntegrityError(`Parent material version not found: ${input.parentVersionId}`);
    }

    const existing = Array.from(this.materialVersions.values()).filter(
      (v) => v.materialId === input.materialId
    );
    const versionNumber =
      existing.length === 0
        ? 1
        : Math.max(...existing.map((v) => v.versionNumber)) + 1;

    const now = this.resolveNow(ctx).toISOString();
    const mv: MaterialVersion = {
      id: randomUUID(),
      materialId: input.materialId,
      versionNumber,
      versionLabel: input.versionLabel,
      parentVersionId: input.parentVersionId ?? null,
      status: input.status,
      sourcePath: input.sourcePath,
      contentHash: input.contentHash,
      usdMaterialPath: input.usdMaterialPath ?? null,
      renderContexts: input.renderContexts ?? [],
      colorspaceConfig: input.colorspaceConfig ?? null,
      mtlxSpecVersion: input.mtlxSpecVersion ?? null,
      lookNames: input.lookNames ?? [],
      vastElementHandle: null,
      vastPath: null,
      createdBy: input.createdBy,
      createdAt: now,
      publishedAt: null
    };
    this.materialVersions.set(mv.id, mv);
    return mv;
  }

  async getMaterialVersionById(id: string): Promise<MaterialVersion | null> {
    return this.materialVersions.get(id) ?? null;
  }

  async listMaterialVersionsByMaterial(materialId: string): Promise<MaterialVersion[]> {
    return Array.from(this.materialVersions.values())
      .filter((v) => v.materialId === materialId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async findMaterialVersionBySourcePathAndHash(
    sourcePath: string,
    contentHash: string
  ): Promise<MaterialVersion | null> {
    for (const mv of this.materialVersions.values()) {
      if (mv.sourcePath === sourcePath && mv.contentHash === contentHash) {
        return mv;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Look Variant methods
  // ---------------------------------------------------------------------------

  async createLookVariant(input: CreateLookVariantInput, ctx: WriteContext): Promise<LookVariant> {
    if (!this.materialVersions.has(input.materialVersionId)) {
      throw new ReferentialIntegrityError(
        `Material version not found: ${input.materialVersionId}`
      );
    }
    const lv: LookVariant = {
      id: randomUUID(),
      materialVersionId: input.materialVersionId,
      lookName: input.lookName,
      description: input.description ?? null,
      materialAssigns: input.materialAssigns ?? null,
      createdAt: this.resolveNow(ctx).toISOString()
    };
    this.lookVariants.set(lv.id, lv);
    return lv;
  }

  async listLookVariantsByMaterialVersion(materialVersionId: string): Promise<LookVariant[]> {
    return Array.from(this.lookVariants.values()).filter(
      (lv) => lv.materialVersionId === materialVersionId
    );
  }

  // ---------------------------------------------------------------------------
  // Version-Material Binding methods ("Where Used?")
  // ---------------------------------------------------------------------------

  async createVersionMaterialBinding(
    input: CreateVersionMaterialBindingInput,
    ctx: WriteContext
  ): Promise<VersionMaterialBinding> {
    if (!this.lookVariants.has(input.lookVariantId)) {
      throw new ReferentialIntegrityError(`Look variant not found: ${input.lookVariantId}`);
    }
    if (!this.versions.has(input.versionId)) {
      throw new ReferentialIntegrityError(`Version not found: ${input.versionId}`);
    }
    const binding: VersionMaterialBinding = {
      id: randomUUID(),
      lookVariantId: input.lookVariantId,
      versionId: input.versionId,
      boundBy: input.boundBy,
      boundAt: this.resolveNow(ctx).toISOString()
    };
    this.versionMaterialBindings.push(binding);
    return binding;
  }

  async listBindingsByLookVariant(lookVariantId: string): Promise<VersionMaterialBinding[]> {
    return this.versionMaterialBindings.filter((b) => b.lookVariantId === lookVariantId);
  }

  async listBindingsByVersion(versionId: string): Promise<VersionMaterialBinding[]> {
    return this.versionMaterialBindings.filter((b) => b.versionId === versionId);
  }

  // ---------------------------------------------------------------------------
  // Material Dependency methods
  // ---------------------------------------------------------------------------

  async createMaterialDependency(
    input: CreateMaterialDependencyInput,
    ctx: WriteContext
  ): Promise<MaterialDependency> {
    if (!this.materialVersions.has(input.materialVersionId)) {
      throw new ReferentialIntegrityError(
        `Material version not found: ${input.materialVersionId}`
      );
    }
    const dep: MaterialDependency = {
      id: randomUUID(),
      materialVersionId: input.materialVersionId,
      texturePath: input.texturePath,
      contentHash: input.contentHash,
      textureType: input.textureType ?? null,
      colorspace: input.colorspace ?? null,
      dependencyDepth: input.dependencyDepth,
      createdAt: this.resolveNow(ctx).toISOString()
    };
    this.materialDependencies.push(dep);
    return dep;
  }

  async listDependenciesByMaterialVersion(materialVersionId: string): Promise<MaterialDependency[]> {
    return this.materialDependencies.filter((d) => d.materialVersionId === materialVersionId);
  }

  // ---------------------------------------------------------------------------
  // Cascade-delete safety
  // ---------------------------------------------------------------------------

  async countBindingsForMaterial(materialId: string): Promise<number> {
    const mvIds = new Set(
      Array.from(this.materialVersions.values())
        .filter((v) => v.materialId === materialId)
        .map((v) => v.id)
    );
    const lvIds = new Set(
      Array.from(this.lookVariants.values())
        .filter((lv) => mvIds.has(lv.materialVersionId))
        .map((lv) => lv.id)
    );
    return this.versionMaterialBindings.filter((b) => lvIds.has(b.lookVariantId)).length;
  }

  // ---------------------------------------------------------------------------
  // Timelines (OTIO)
  // ---------------------------------------------------------------------------

  async createTimeline(input: CreateTimelineInput, ctx: WriteContext): Promise<Timeline> {
    const timeline: Timeline = {
      id: randomUUID(),
      name: input.name,
      projectId: input.projectId,
      frameRate: input.frameRate,
      durationFrames: input.durationFrames,
      status: "ingested",
      sourceUri: input.sourceUri,
      createdAt: this.resolveNow(ctx).toISOString(),
    };
    this.timelines.set(timeline.id, timeline);
    return timeline;
  }

  async getTimelineById(id: string): Promise<Timeline | null> {
    return this.timelines.get(id) ?? null;
  }

  async listTimelinesByProject(projectId: string): Promise<Timeline[]> {
    return Array.from(this.timelines.values()).filter((t) => t.projectId === projectId);
  }

  async updateTimelineStatus(
    id: string,
    status: TimelineStatus,
    ctx: WriteContext
  ): Promise<Timeline | null> {
    const timeline = this.timelines.get(id);
    if (!timeline) return null;
    const updated = { ...timeline, status };
    this.timelines.set(id, updated);
    return updated;
  }

  async createTimelineClip(input: CreateTimelineClipInput, ctx: WriteContext): Promise<TimelineClip> {
    const clip: TimelineClip = {
      id: randomUUID(),
      timelineId: input.timelineId,
      trackName: input.trackName,
      clipName: input.clipName,
      sourceUri: input.sourceUri,
      inFrame: input.inFrame,
      outFrame: input.outFrame,
      durationFrames: input.durationFrames,
      shotId: null,
      assetId: null,
      conformStatus: "pending",
      vfxCutIn: input.vfxCutIn ?? null,
      vfxCutOut: input.vfxCutOut ?? null,
      handleHead: input.handleHead ?? null,
      handleTail: input.handleTail ?? null,
      deliveryIn: input.deliveryIn ?? null,
      deliveryOut: input.deliveryOut ?? null,
      sourceTimecode: input.sourceTimecode ?? null,
    };
    this.timelineClips.set(clip.id, clip);
    return clip;
  }

  async listClipsByTimeline(timelineId: string): Promise<TimelineClip[]> {
    return Array.from(this.timelineClips.values()).filter((c) => c.timelineId === timelineId);
  }

  async updateClipConformStatus(
    clipId: string,
    status: ClipConformStatus,
    shotId?: string,
    assetId?: string
  ): Promise<void> {
    const clip = this.timelineClips.get(clipId);
    if (!clip) return;
    const updated = {
      ...clip,
      conformStatus: status,
      shotId: shotId ?? clip.shotId,
      assetId: assetId ?? clip.assetId,
    };
    this.timelineClips.set(clipId, updated);
  }

  async findTimelineByProjectAndName(projectId: string, name: string): Promise<Timeline | null> {
    for (const t of this.timelines.values()) {
      if (t.projectId === projectId && t.name === name) return t;
    }
    return null;
  }

  async storeTimelineChanges(changeSet: TimelineChangeSet): Promise<void> {
    this.timelineChangeSets.set(changeSet.timelineId, changeSet);
  }

  async getTimelineChanges(timelineId: string): Promise<TimelineChangeSet | null> {
    return this.timelineChangeSets.get(timelineId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Review Sessions (dailies-oriented)
  // ---------------------------------------------------------------------------

  async createReviewSession(input: CreateReviewSessionInput, ctx: WriteContext): Promise<ReviewSession> {
    const session: ReviewSession = {
      id: randomUUID(),
      projectId: input.projectId,
      department: input.department ?? null,
      sessionDate: input.sessionDate,
      sessionType: input.sessionType,
      supervisorId: input.supervisorId ?? null,
      status: "open",
      createdAt: this.resolveNow(ctx).toISOString(),
    };
    this.reviewSessions.set(session.id, session);
    return session;
  }

  async getReviewSessionById(id: string): Promise<ReviewSession | null> {
    return this.reviewSessions.get(id) ?? null;
  }

  async listReviewSessions(filters?: { projectId?: string; status?: import("../../domain/models.js").ReviewSessionStatus; department?: string }): Promise<ReviewSession[]> {
    let results = Array.from(this.reviewSessions.values());
    if (filters?.projectId) {
      results = results.filter((s) => s.projectId === filters.projectId);
    }
    if (filters?.status) {
      results = results.filter((s) => s.status === filters.status);
    }
    if (filters?.department) {
      results = results.filter((s) => s.department === filters.department);
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateReviewSessionStatus(
    id: string,
    fromStatus: import("../../domain/models.js").ReviewSessionStatus,
    toStatus: import("../../domain/models.js").ReviewSessionStatus,
    _ctx: WriteContext
  ): Promise<ReviewSession | null> {
    const session = this.reviewSessions.get(id);
    if (!session) return null;
    if (session.status !== fromStatus) return null;
    const updated = { ...session, status: toStatus };
    this.reviewSessions.set(id, updated);
    return updated;
  }

  async addSubmission(input: AddSubmissionInput, ctx: WriteContext): Promise<ReviewSessionSubmission> {
    const existing = Array.from(this.reviewSessionSubmissions.values())
      .filter((s) => s.sessionId === input.sessionId);
    const order = input.submissionOrder ?? existing.length + 1;

    const submission: ReviewSessionSubmission = {
      id: randomUUID(),
      sessionId: input.sessionId,
      assetId: input.assetId,
      versionId: input.versionId ?? null,
      submissionOrder: order,
      status: "pending",
      submittedAt: this.resolveNow(ctx).toISOString(),
    };
    this.reviewSessionSubmissions.set(submission.id, submission);
    return submission;
  }

  async listSubmissionsBySession(sessionId: string): Promise<ReviewSessionSubmission[]> {
    return Array.from(this.reviewSessionSubmissions.values())
      .filter((s) => s.sessionId === sessionId)
      .sort((a, b) => a.submissionOrder - b.submissionOrder);
  }

  async updateSubmissionStatus(
    id: string,
    fromStatus: import("../../domain/models.js").SubmissionStatus,
    toStatus: import("../../domain/models.js").SubmissionStatus,
    _ctx: WriteContext
  ): Promise<ReviewSessionSubmission | null> {
    const sub = this.reviewSessionSubmissions.get(id);
    if (!sub) return null;
    if (sub.status !== fromStatus) return null;
    const updated = { ...sub, status: toStatus };
    this.reviewSessionSubmissions.set(id, updated);
    return updated;
  }

  // Review Comments (Phase B)

  async createReviewComment(input: CreateReviewCommentInput, ctx: WriteContext): Promise<ReviewComment> {
    const comment: ReviewComment = {
      id: randomUUID(),
      sessionId: input.sessionId ?? null,
      submissionId: input.submissionId ?? null,
      versionId: input.versionId ?? null,
      parentCommentId: input.parentCommentId ?? null,
      authorId: input.authorId,
      authorRole: input.authorRole ?? null,
      body: input.body,
      frameNumber: input.frameNumber ?? null,
      timecode: input.timecode ?? null,
      annotationType: input.annotationType ?? null,
      status: "open",
      createdAt: this.resolveNow(ctx).toISOString(),
      updatedAt: this.resolveNow(ctx).toISOString(),
    };
    this.reviewComments.set(comment.id, comment);
    return comment;
  }

  async getReviewCommentById(id: string): Promise<ReviewComment | null> {
    return this.reviewComments.get(id) ?? null;
  }

  async listCommentsBySession(sessionId: string): Promise<ReviewComment[]> {
    return Array.from(this.reviewComments.values())
      .filter((c) => c.sessionId === sessionId && c.status !== "archived")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listCommentsBySubmission(submissionId: string): Promise<ReviewComment[]> {
    return Array.from(this.reviewComments.values())
      .filter((c) => c.submissionId === submissionId && c.status !== "archived")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listReplies(parentCommentId: string): Promise<ReviewComment[]> {
    return Array.from(this.reviewComments.values())
      .filter((c) => c.parentCommentId === parentCommentId && c.status !== "archived")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateCommentStatus(id: string, status: CommentStatus, ctx: WriteContext): Promise<ReviewComment | null> {
    const comment = this.reviewComments.get(id);
    if (!comment) return null;
    const updated = { ...comment, status, updatedAt: this.resolveNow(ctx).toISOString() };
    this.reviewComments.set(id, updated);
    return updated;
  }

  async resolveComment(id: string, ctx: WriteContext): Promise<ReviewComment | null> {
    return this.updateCommentStatus(id, "resolved", ctx);
  }

  async createCommentAnnotation(input: CreateCommentAnnotationInput, ctx: WriteContext): Promise<CommentAnnotation> {
    const annotation: CommentAnnotation = {
      id: randomUUID(),
      commentId: input.commentId,
      annotationData: input.annotationData,
      frameNumber: input.frameNumber,
    };
    this.commentAnnotations.set(annotation.id, annotation);
    return annotation;
  }

  async listAnnotationsByComment(commentId: string): Promise<CommentAnnotation[]> {
    return Array.from(this.commentAnnotations.values())
      .filter((a) => a.commentId === commentId)
      .sort((a, b) => a.frameNumber - b.frameNumber);
  }

  // Version Comparisons (Phase B)
  async createVersionComparison(input: CreateVersionComparisonInput, ctx: WriteContext): Promise<VersionComparison> {
    const now = this.resolveNow(ctx).toISOString();
    const comparison: VersionComparison = {
      id: randomUUID(),
      versionAId: input.versionAId,
      versionBId: input.versionBId,
      comparisonType: input.comparisonType as VersionComparison["comparisonType"],
      diffMetadata: input.diffMetadata ?? null,
      pixelDiffPercentage: input.pixelDiffPercentage ?? null,
      frameDiffCount: input.frameDiffCount ?? null,
      resolutionMatch: input.resolutionMatch,
      colorspaceMatch: input.colorspaceMatch,
      createdAt: now,
      createdBy: input.createdBy,
    };
    this.versionComparisons.set(comparison.id, comparison);
    return comparison;
  }

  async getVersionComparisonById(id: string): Promise<VersionComparison | null> {
    return this.versionComparisons.get(id) ?? null;
  }

  async listComparisonsByVersion(versionId: string): Promise<VersionComparison[]> {
    return Array.from(this.versionComparisons.values())
      .filter((c) => c.versionAId === versionId || c.versionBId === versionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Asset Provenance (Phase C)
  async createProvenance(input: CreateProvenanceInput, ctx: WriteContext): Promise<AssetProvenance> {
    const now = this.resolveNow(ctx).toISOString();
    const provenance: AssetProvenance = {
      id: randomUUID(),
      versionId: input.versionId,
      creator: input.creator ?? null,
      softwareUsed: input.softwareUsed ?? null,
      softwareVersion: input.softwareVersion ?? null,
      renderJobId: input.renderJobId ?? null,
      pipelineStage: input.pipelineStage ?? null,
      vastStoragePath: input.vastStoragePath ?? null,
      vastElementHandle: input.vastElementHandle ?? null,
      sourceHost: input.sourceHost ?? null,
      sourceProcessId: input.sourceProcessId ?? null,
      createdAt: now,
    };
    this.assetProvenances.set(provenance.id, provenance);
    return provenance;
  }

  async getProvenanceByVersion(versionId: string): Promise<AssetProvenance[]> {
    return Array.from(this.assetProvenances.values())
      .filter((p) => p.versionId === versionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Version Lineage (Phase C)
  async createLineageEdge(input: CreateLineageEdgeInput, ctx: WriteContext): Promise<VersionLineage> {
    const now = this.resolveNow(ctx).toISOString();
    const edge: VersionLineage = {
      id: randomUUID(),
      ancestorVersionId: input.ancestorVersionId,
      descendantVersionId: input.descendantVersionId,
      relationshipType: input.relationshipType,
      depth: input.depth,
      createdAt: now,
    };
    this.versionLineages.set(edge.id, edge);
    return edge;
  }

  async getAncestors(versionId: string, maxDepth: number = 10): Promise<VersionLineage[]> {
    return Array.from(this.versionLineages.values())
      .filter((e) => e.descendantVersionId === versionId && e.depth <= maxDepth)
      .sort((a, b) => a.depth - b.depth);
  }

  async getDescendants(versionId: string, maxDepth: number = 10): Promise<VersionLineage[]> {
    return Array.from(this.versionLineages.values())
      .filter((e) => e.ancestorVersionId === versionId && e.depth <= maxDepth)
      .sort((a, b) => a.depth - b.depth);
  }

  async getVersionTree(shotId: string): Promise<VersionLineage[]> {
    const shotVersionIds = new Set(
      Array.from(this.versions.values())
        .filter((v) => v.shotId === shotId)
        .map((v) => v.id)
    );
    return Array.from(this.versionLineages.values())
      .filter((e) => shotVersionIds.has(e.ancestorVersionId) || shotVersionIds.has(e.descendantVersionId))
      .sort((a, b) => a.depth - b.depth);
  }

  // ---------------------------------------------------------------------------
  // Dependency Intelligence (Phase C.4)
  // ---------------------------------------------------------------------------

  async createDependency(input: CreateDependencyInput, ctx: WriteContext): Promise<AssetDependency> {
    const now = this.resolveNow(ctx).toISOString();
    const dep: AssetDependency = {
      id: randomUUID(),
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      dependencyType: input.dependencyType,
      dependencyStrength: input.dependencyStrength,
      discoveredBy: input.discoveredBy ?? null,
      discoveredAt: now,
    };
    this.assetDependencies.set(dep.id, dep);
    return dep;
  }

  async getDependenciesBySource(entityType: string, entityId: string): Promise<AssetDependency[]> {
    return Array.from(this.assetDependencies.values())
      .filter((d) => d.sourceEntityType === entityType && d.sourceEntityId === entityId)
      .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
  }

  async getDependenciesByTarget(entityType: string, entityId: string): Promise<AssetDependency[]> {
    return Array.from(this.assetDependencies.values())
      .filter((d) => d.targetEntityType === entityType && d.targetEntityId === entityId)
      .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
  }

  async getReverseDependencies(entityType: string, entityId: string): Promise<AssetDependency[]> {
    return this.getDependenciesByTarget(entityType, entityId);
  }

  async getDependencyGraphForMaterial(materialId: string): Promise<AssetDependency[]> {
    const mvIds = new Set(
      Array.from(this.materialVersions.values())
        .filter((mv) => mv.materialId === materialId)
        .map((mv) => mv.id)
    );
    return Array.from(this.assetDependencies.values())
      .filter((d) =>
        (d.sourceEntityType === "material" && d.sourceEntityId === materialId) ||
        (d.sourceEntityType === "material_version" && mvIds.has(d.sourceEntityId)) ||
        (d.targetEntityType === "material" && d.targetEntityId === materialId) ||
        (d.targetEntityType === "material_version" && mvIds.has(d.targetEntityId))
      )
      .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
  }

  // ---------------------------------------------------------------------------
  // Shot Asset Usage (Phase C.4)
  // ---------------------------------------------------------------------------

  async createShotAssetUsage(input: CreateShotAssetUsageInput, ctx: WriteContext): Promise<ShotAssetUsage> {
    const now = this.resolveNow(ctx).toISOString();
    const usage: ShotAssetUsage = {
      id: randomUUID(),
      shotId: input.shotId,
      versionId: input.versionId,
      usageType: input.usageType,
      layerName: input.layerName ?? null,
      isActive: input.isActive !== false,
      addedAt: now,
      removedAt: null,
    };
    this.shotAssetUsages.set(usage.id, usage);
    return usage;
  }

  async getShotUsage(shotId: string): Promise<ShotAssetUsage[]> {
    return Array.from(this.shotAssetUsages.values())
      .filter((u) => u.shotId === shotId)
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async getVersionUsageAcrossShots(versionId: string): Promise<ShotAssetUsage[]> {
    return Array.from(this.shotAssetUsages.values())
      .filter((u) => u.versionId === versionId)
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  // ---------------------------------------------------------------------------
  // Collections (Phase B.6)
  // ---------------------------------------------------------------------------

  async createCollection(input: CreateCollectionInput, ctx: WriteContext): Promise<Collection> {
    const now = this.resolveNow(ctx).toISOString();
    const collection: Collection = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      collectionType: input.collectionType,
      ownerId: input.ownerId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.collections.set(collection.id, collection);
    return collection;
  }

  async getCollectionById(id: string): Promise<Collection | null> {
    return this.collections.get(id) ?? null;
  }

  async listCollectionsByProject(projectId: string): Promise<Collection[]> {
    return Array.from(this.collections.values())
      .filter((c) => c.projectId === projectId && c.status === "active")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addCollectionItem(input: AddCollectionItemInput, ctx: WriteContext): Promise<CollectionItem> {
    const now = this.resolveNow(ctx).toISOString();
    // Auto-assign sort_order if not provided
    const existingItems = Array.from(this.collectionItems.values())
      .filter((i) => i.collectionId === input.collectionId);
    const sortOrder = input.sortOrder ?? (existingItems.length > 0
      ? Math.max(...existingItems.map((i) => i.sortOrder)) + 1
      : 0);

    const item: CollectionItem = {
      id: randomUUID(),
      collectionId: input.collectionId,
      entityType: input.entityType,
      entityId: input.entityId,
      sortOrder,
      addedBy: input.addedBy,
      addedAt: now,
      notes: input.notes ?? null,
    };
    this.collectionItems.set(item.id, item);
    return item;
  }

  async removeCollectionItem(collectionId: string, itemId: string): Promise<boolean> {
    const item = this.collectionItems.get(itemId);
    if (!item || item.collectionId !== collectionId) return false;
    this.collectionItems.delete(itemId);
    return true;
  }

  async listCollectionItems(collectionId: string): Promise<CollectionItem[]> {
    return Array.from(this.collectionItems.values())
      .filter((i) => i.collectionId === collectionId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ---------------------------------------------------------------------------
  // Playlists / Dailies (Phase B.7)
  // ---------------------------------------------------------------------------

  async createPlaylist(input: CreatePlaylistInput, ctx: WriteContext): Promise<Playlist> {
    const now = this.resolveNow(ctx).toISOString();
    const playlist: Playlist = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      createdBy: input.createdBy,
      sessionDate: input.sessionDate,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.playlists.set(playlist.id, playlist);
    return playlist;
  }

  async getPlaylistById(id: string): Promise<Playlist | null> {
    return this.playlists.get(id) ?? null;
  }

  async listPlaylistsByProject(projectId: string): Promise<Playlist[]> {
    return Array.from(this.playlists.values())
      .filter((p) => p.projectId === projectId && p.status === "active")
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  }

  async addPlaylistItem(input: AddPlaylistItemInput, ctx: WriteContext): Promise<PlaylistItem> {
    const now = this.resolveNow(ctx).toISOString();
    const existingItems = Array.from(this.playlistItems.values())
      .filter((i) => i.playlistId === input.playlistId);
    const maxOrder = existingItems.reduce((max, i) => Math.max(max, i.sortOrder), 0);
    const item: PlaylistItem = {
      id: randomUUID(),
      playlistId: input.playlistId,
      shotId: input.shotId,
      versionId: input.versionId,
      sortOrder: input.sortOrder ?? maxOrder + 1,
      notes: input.notes ?? null,
      decision: null,
      decidedBy: null,
      decidedAt: null,
      addedBy: input.addedBy,
      addedAt: now
    };
    this.playlistItems.set(item.id, item);
    return item;
  }

  async updatePlaylistItemDecision(
    itemId: string,
    input: UpdatePlaylistItemDecisionInput,
    ctx: WriteContext
  ): Promise<PlaylistItem | null> {
    const item = this.playlistItems.get(itemId);
    if (!item) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated: PlaylistItem = {
      ...item,
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: now
    };
    this.playlistItems.set(itemId, updated);
    return updated;
  }

  async updatePlaylistItems(
    playlistId: string,
    items: Array<{ id: string; sortOrder?: number; notes?: string }>,
    ctx: WriteContext
  ): Promise<PlaylistItem[]> {
    const results: PlaylistItem[] = [];
    for (const update of items) {
      const existing = this.playlistItems.get(update.id);
      if (!existing || existing.playlistId !== playlistId) continue;
      const updated: PlaylistItem = {
        ...existing,
        ...(update.sortOrder !== undefined && { sortOrder: update.sortOrder }),
        ...(update.notes !== undefined && { notes: update.notes })
      };
      this.playlistItems.set(update.id, updated);
      results.push(updated);
    }
    return results.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
    return Array.from(this.playlistItems.values())
      .filter((i) => i.playlistId === playlistId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getPlaylistReport(playlistId: string): Promise<DailiesReportEntry[]> {
    const items = await this.listPlaylistItems(playlistId);
    const entries: DailiesReportEntry[] = [];
    for (const item of items) {
      const shot = this.shots.get(item.shotId);
      const version = this.versions.get(item.versionId);
      // Count comments for this version across all sessions
      const commentCount = Array.from(this.reviewComments.values())
        .filter((c) => c.versionId === item.versionId).length;
      entries.push({
        shotId: item.shotId,
        shotCode: shot?.code ?? null,
        versionId: item.versionId,
        versionLabel: version?.versionLabel ?? null,
        decision: item.decision,
        decidedBy: item.decidedBy,
        notes: item.notes,
        commentCount
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Capacity Planning — Storage Metrics (Phase C.7)
  // ---------------------------------------------------------------------------

  async createStorageMetric(input: CreateStorageMetricInput, ctx: WriteContext): Promise<StorageMetric> {
    const now = this.resolveNow(ctx).toISOString();
    const metric: StorageMetric = {
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      totalBytes: input.totalBytes,
      fileCount: input.fileCount,
      proxyBytes: input.proxyBytes ?? 0,
      thumbnailBytes: input.thumbnailBytes ?? 0,
      storageTier: input.storageTier ?? "hot",
      measuredAt: now
    };
    this.storageMetrics.set(metric.id, metric);
    return metric;
  }

  async getStorageMetricsByEntity(entityType: string, entityId: string): Promise<StorageMetric[]> {
    return Array.from(this.storageMetrics.values())
      .filter((m) => m.entityType === entityType && m.entityId === entityId)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  }

  async getLatestStorageMetric(entityType: string, entityId: string): Promise<StorageMetric | null> {
    const metrics = await this.getStorageMetricsByEntity(entityType, entityId);
    return metrics.length > 0 ? metrics[metrics.length - 1] : null;
  }

  async getStorageSummaryByProject(projectId: string): Promise<StorageMetric[]> {
    return Array.from(this.storageMetrics.values())
      .filter((m) => m.entityType === "project" && m.entityId === projectId)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  }

  // ---------------------------------------------------------------------------
  // Capacity Planning — Render Farm Metrics (Phase C.7)
  // ---------------------------------------------------------------------------

  async createRenderFarmMetric(input: CreateRenderFarmMetricInput, ctx: WriteContext): Promise<RenderFarmMetric> {
    const now = this.resolveNow(ctx).toISOString();
    const metric: RenderFarmMetric = {
      id: randomUUID(),
      projectId: input.projectId,
      shotId: input.shotId ?? null,
      versionId: input.versionId ?? null,
      renderEngine: input.renderEngine ?? null,
      renderTimeSeconds: input.renderTimeSeconds ?? null,
      coreHours: input.coreHours ?? null,
      peakMemoryGb: input.peakMemoryGb ?? null,
      frameCount: input.frameCount ?? null,
      submittedAt: input.submittedAt ?? null,
      completedAt: now
    };
    this.renderFarmMetrics.set(metric.id, metric);
    return metric;
  }

  async getRenderMetricsByProject(projectId: string, from?: string, to?: string): Promise<RenderFarmMetric[]> {
    return Array.from(this.renderFarmMetrics.values())
      .filter((m) => {
        if (m.projectId !== projectId) return false;
        if (from && m.completedAt < from) return false;
        if (to && m.completedAt > to) return false;
        return true;
      })
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  async getRenderMetricsByShot(shotId: string): Promise<RenderFarmMetric[]> {
    return Array.from(this.renderFarmMetrics.values())
      .filter((m) => m.shotId === shotId)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  // ---------------------------------------------------------------------------
  // Capacity Planning — Downstream Usage Counts (Phase C.7)
  // ---------------------------------------------------------------------------

  async upsertDownstreamUsageCount(input: UpsertDownstreamUsageCountInput, ctx: WriteContext): Promise<DownstreamUsageCount> {
    const now = this.resolveNow(ctx).toISOString();
    const key = `${input.entityType}:${input.entityId}`;
    const record: DownstreamUsageCount = {
      entityType: input.entityType,
      entityId: input.entityId,
      directDependents: input.directDependents,
      transitiveDependents: input.transitiveDependents,
      shotCount: input.shotCount,
      lastComputedAt: now
    };
    this.downstreamUsageCounts.set(key, record);
    return record;
  }

  async getDownstreamUsageCount(entityType: string, entityId: string): Promise<DownstreamUsageCount | null> {
    const key = `${entityType}:${entityId}`;
    return this.downstreamUsageCounts.get(key) ?? null;
  }

  // ── Asset Notes ──

  async getAssetNotes(assetId: string) {
    return this.assetNotes.get(assetId) ?? [];
  }

  async createAssetNote(assetId: string, input: { body: string; createdBy: string; correlationId: string }) {
    const note = {
      id: randomUUID(),
      assetId,
      body: input.body,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    if (!this.assetNotes.has(assetId)) {
      this.assetNotes.set(assetId, []);
    }
    this.assetNotes.get(assetId)!.push(note);
    this.recordAudit(`Note added to asset ${assetId}`, input.correlationId, new Date());
    return note;
  }

  // ── Asset Archive ──

  async archiveAsset(assetId: string, ctx: WriteContext) {
    this.archivedAssets.add(assetId);
    this.assets.delete(assetId);
    this.recordAudit(`Asset ${assetId} archived`, ctx.correlationId, new Date());
  }

  // ── DataEngine dispatches (migration 022) ──

  async createDataEngineDispatches(
    inputs: Parameters<PersistenceAdapter["createDataEngineDispatches"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const created: Array<ReturnType<typeof this.buildDispatch>> = [];
    for (const input of inputs) {
      const record = this.buildDispatch(input, now);
      this.dataEngineDispatches.set(record.id, record);
      created.push(record);
    }
    return created;
  }

  private buildDispatch(
    input: Parameters<PersistenceAdapter["createDataEngineDispatches"]>[0][number],
    now: string,
  ) {
    return {
      id: randomUUID(),
      checkinId: input.checkinId ?? null,
      versionId: input.versionId,
      fileRole: input.fileRole,
      fileKind: input.fileKind,
      sourceS3Bucket: input.sourceS3Bucket,
      sourceS3Key: input.sourceS3Key,
      expectedFunction: input.expectedFunction,
      status: "pending" as const,
      proxyUrl: null,
      thumbnailUrl: null,
      metadataTargetSchema: input.metadataTargetSchema ?? null,
      metadataTargetTable: input.metadataTargetTable ?? null,
      metadataRowId: null,
      lastError: null,
      deadlineAt: input.deadlineAt,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      pollAttempts: 0,
      lastPolledAt: null,
      correlationId: input.correlationId ?? null,
    };
  }

  async listDataEngineDispatches(filter?: { versionId?: string; checkinId?: string; status?: string; limit?: number }) {
    let rows = [...this.dataEngineDispatches.values()];
    if (filter?.versionId) rows = rows.filter((r) => r.versionId === filter.versionId);
    if (filter?.checkinId) rows = rows.filter((r) => r.checkinId === filter.checkinId);
    if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = filter?.limit ?? 200;
    return rows.slice(0, limit);
  }

  async listPendingDispatchesForPolling(now: string, limit = 50) {
    return [...this.dataEngineDispatches.values()]
      .filter((r) => r.status === "pending" && r.deadlineAt > now)
      .sort((a, b) => (a.lastPolledAt ?? a.createdAt).localeCompare(b.lastPolledAt ?? b.createdAt))
      .slice(0, limit);
  }

  async getDataEngineDispatch(id: string) {
    return this.dataEngineDispatches.get(id) ?? null;
  }

  async updateDataEngineDispatch(
    id: string,
    update: Parameters<PersistenceAdapter["updateDataEngineDispatch"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.dataEngineDispatches.get(id);
    if (!existing) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      status: update.status ?? existing.status,
      proxyUrl: update.proxyUrl !== undefined ? update.proxyUrl : existing.proxyUrl,
      thumbnailUrl: update.thumbnailUrl !== undefined ? update.thumbnailUrl : existing.thumbnailUrl,
      metadataRowId: update.metadataRowId !== undefined ? update.metadataRowId : existing.metadataRowId,
      lastError: update.lastError !== undefined ? update.lastError : existing.lastError,
      completedAt: update.completedAt !== undefined ? update.completedAt : existing.completedAt,
      lastPolledAt: update.lastPolledAt !== undefined ? update.lastPolledAt : existing.lastPolledAt,
      pollAttempts: update.pollAttempts ?? existing.pollAttempts,
      updatedAt: now,
    };
    this.dataEngineDispatches.set(id, updated);
    return updated;
  }

  // ── Atomic check-in state ──

  async createCheckin(
    input: Parameters<PersistenceAdapter["createCheckin"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      txId: input.txId,
      versionId: input.versionId,
      shotId: input.shotId,
      projectId: input.projectId,
      sequenceId: input.sequenceId,
      context: input.context,
      state: "reserved" as const,
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      s3UploadId: input.s3UploadId,
      partPlanJson: input.partPlanJson,
      correlationId: input.correlationId,
      actor: input.actor,
      deadlineAt: input.deadlineAt,
      createdAt: now,
      updatedAt: now,
      committedAt: null,
      abortedAt: null,
      lastError: null,
    };
    this.checkins.set(record.id, record);
    return record;
  }

  async getCheckin(id: string) {
    return this.checkins.get(id) ?? null;
  }

  async updateCheckinState(
    id: string,
    updates: Parameters<PersistenceAdapter["updateCheckinState"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.checkins.get(id);
    if (!existing) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      ...(updates.state !== undefined ? { state: updates.state } : {}),
      ...(updates.committedAt !== undefined ? { committedAt: updates.committedAt } : {}),
      ...(updates.abortedAt !== undefined ? { abortedAt: updates.abortedAt } : {}),
      ...(updates.lastError !== undefined ? { lastError: updates.lastError } : {}),
      updatedAt: now,
    };
    this.checkins.set(id, updated);
    return updated;
  }

  // ── S3 compensation log ──

  async createS3CompensationLog(
    input: Parameters<PersistenceAdapter["createS3CompensationLog"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      txId: input.txId,
      correlationId: input.correlationId ?? null,
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      operation: input.operation,
      inverseOperation: input.inverseOperation,
      inversePayload: input.inversePayload ?? null,
      status: "pending" as const,
      actor: input.actor ?? null,
      createdAt: now,
      committedAt: null,
      compensatedAt: null,
      lastError: null,
      attempts: 0,
    };
    this.s3CompensationLog.set(record.id, record);
    return record;
  }

  async listS3CompensationByTxId(txId: string) {
    return [...this.s3CompensationLog.values()].filter((r) => r.txId === txId);
  }

  async markS3CompensationCommitted(txId: string, ctx: WriteContext) {
    const now = this.resolveNow(ctx).toISOString();
    let count = 0;
    for (const [id, rec] of this.s3CompensationLog.entries()) {
      if (rec.txId === txId && rec.status === "pending") {
        this.s3CompensationLog.set(id, { ...rec, status: "committed", committedAt: now });
        count++;
      }
    }
    return count;
  }

  async markS3CompensationCompensated(id: string, ctx: WriteContext) {
    const existing = this.s3CompensationLog.get(id);
    if (!existing) return;
    const now = this.resolveNow(ctx).toISOString();
    this.s3CompensationLog.set(id, { ...existing, status: "compensated", compensatedAt: now });
  }

  async markS3CompensationFailed(id: string, error: string, ctx: WriteContext) {
    const existing = this.s3CompensationLog.get(id);
    if (!existing) return;
    void ctx;
    this.s3CompensationLog.set(id, {
      ...existing,
      status: "failed",
      lastError: error,
      attempts: existing.attempts + 1,
    });
  }

  // ── Version status update (for checkin published flip) ──

  async updateVersionStatus(versionId: string, status: string, ctx: WriteContext) {
    const existing = this.versions.get(versionId);
    if (!existing) return;
    const now = this.resolveNow(ctx).toISOString();
    this.versions.set(versionId, {
      ...existing,
      status: status as typeof existing.status,
      publishedAt: status === "published" ? now : existing.publishedAt,
    });
  }

  // ── Version sentinel upsert ──

  async upsertVersionSentinel(
    shotId: string,
    context: string,
    sentinelName: string,
    pointsToVersionId: string,
    ctx: WriteContext,
  ) {
    // Find the target version to copy identity columns from
    const target = this.versions.get(pointsToVersionId);
    if (!target) return;
    const now = this.resolveNow(ctx).toISOString();

    // Remove any prior sentinel with the same (shotId, context, sentinelName)
    for (const [id, v] of this.versions.entries()) {
      if (
        v.isSentinel &&
        v.shotId === shotId &&
        (v.context ?? "main") === context &&
        v.sentinelName === sentinelName
      ) {
        this.versions.delete(id);
      }
    }

    // Create a new sentinel row that "points" at target
    const sentinelId = randomUUID();
    this.versions.set(sentinelId, {
      ...target,
      id: sentinelId,
      isSentinel: true,
      sentinelName,
      context,
      // Sentinels don't get their own version number; mirror the target's
      versionNumber: target.versionNumber,
      createdAt: now,
      publishedAt: now,
    });
  }

  // ── Version files (migration 019) ──

  async createVersionFiles(
    input: Parameters<PersistenceAdapter["createVersionFiles"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const created: Array<ReturnType<typeof this.buildVersionFile>> = [];
    for (const f of input) {
      const record = this.buildVersionFile(f, now);
      this.versionFiles.set(record.id, record);
      created.push(record);
    }
    return created;
  }

  private buildVersionFile(
    f: { versionId: string; role: VersionFileRole; filename: string; s3Bucket: string; s3Key: string; contentType?: string; sizeBytes?: number; checksum?: string; checksumAlgorithm?: string; frameRangeStart?: number; frameRangeEnd?: number; framePadding?: number; checkinId?: string },
    now: string,
  ) {
    return {
      id: randomUUID(),
      versionId: f.versionId,
      role: f.role,
      filename: f.filename,
      s3Bucket: f.s3Bucket,
      s3Key: f.s3Key,
      contentType: f.contentType ?? null,
      sizeBytes: f.sizeBytes ?? null,
      checksum: f.checksum ?? null,
      checksumAlgorithm: f.checksumAlgorithm ?? null,
      frameRangeStart: f.frameRangeStart ?? null,
      frameRangeEnd: f.frameRangeEnd ?? null,
      framePadding: f.framePadding ?? null,
      checkinId: f.checkinId ?? null,
      createdAt: now,
    };
  }

  async listVersionFiles(versionId: string) {
    return [...this.versionFiles.values()].filter((f) => f.versionId === versionId);
  }

  // ── Triggers (migration 020) ──

  async listTriggers(filter?: { enabled?: boolean }) {
    return [...this.triggers.values()].filter((t) =>
      filter?.enabled === undefined ? true : t.enabled === filter.enabled,
    );
  }

  async getTrigger(id: string) {
    return this.triggers.get(id) ?? null;
  }

  async createTrigger(
    input: Parameters<PersistenceAdapter["createTrigger"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      eventSelector: input.eventSelector,
      conditionJson: input.conditionJson ?? null,
      actionKind: input.actionKind,
      actionConfigJson: input.actionConfigJson,
      enabled: input.enabled ?? true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      lastFiredAt: null,
      fireCount: 0,
    };
    this.triggers.set(record.id, record);
    return record;
  }

  async updateTrigger(
    id: string,
    updates: Parameters<PersistenceAdapter["updateTrigger"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.triggers.get(id);
    if (!existing) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      name: updates.name ?? existing.name,
      description: updates.description !== undefined ? (updates.description ?? null) : existing.description,
      eventSelector: updates.eventSelector ?? existing.eventSelector,
      conditionJson: updates.conditionJson !== undefined ? (updates.conditionJson ?? null) : existing.conditionJson,
      actionKind: updates.actionKind ?? existing.actionKind,
      actionConfigJson: updates.actionConfigJson ?? existing.actionConfigJson,
      enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
      updatedAt: now,
    };
    this.triggers.set(id, updated);
    return updated;
  }

  async deleteTrigger(id: string, ctx: WriteContext) {
    void ctx;
    return this.triggers.delete(id);
  }

  async recordTriggerFire(id: string, ctx: WriteContext) {
    const existing = this.triggers.get(id);
    if (!existing) return;
    const now = this.resolveNow(ctx).toISOString();
    this.triggers.set(id, {
      ...existing,
      lastFiredAt: now,
      fireCount: existing.fireCount + 1,
    });
  }

  // ── Webhook endpoints (migration 020) ──

  async listWebhookEndpoints(filter?: { direction?: "inbound" | "outbound"; includeRevoked?: boolean }) {
    return [...this.webhookEndpoints.values()].filter((w) => {
      if (filter?.direction && w.direction !== filter.direction) return false;
      if (!filter?.includeRevoked && w.revokedAt !== null) return false;
      return true;
    });
  }

  async getWebhookEndpoint(id: string) {
    return this.webhookEndpoints.get(id) ?? null;
  }

  async createWebhookEndpoint(
    input: Parameters<PersistenceAdapter["createWebhookEndpoint"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      name: input.name,
      direction: input.direction,
      url: input.url ?? null,
      secretHash: input.secretHash,
      secretPrefix: input.secretPrefix,
      signingAlgorithm: input.signingAlgorithm,
      allowedEventTypes: input.allowedEventTypes ?? null,
      description: input.description ?? null,
      createdBy: input.createdBy,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.webhookEndpoints.set(record.id, record);
    return record;
  }

  async revokeWebhookEndpoint(id: string, ctx: WriteContext) {
    const existing = this.webhookEndpoints.get(id);
    if (!existing || existing.revokedAt !== null) return false;
    const now = this.resolveNow(ctx).toISOString();
    this.webhookEndpoints.set(id, { ...existing, revokedAt: now });
    return true;
  }

  async recordWebhookUsed(id: string, ctx: WriteContext) {
    const existing = this.webhookEndpoints.get(id);
    if (!existing) return;
    const now = this.resolveNow(ctx).toISOString();
    this.webhookEndpoints.set(id, { ...existing, lastUsedAt: now });
  }

  // ── Webhook delivery log (migration 020) ──

  async createWebhookDelivery(input: Parameters<PersistenceAdapter["createWebhookDelivery"]>[0]) {
    const record = {
      id: randomUUID(),
      webhookId: input.webhookId,
      triggerId: input.triggerId ?? null,
      eventType: input.eventType,
      eventPayload: input.eventPayload ?? null,
      requestUrl: input.requestUrl ?? null,
      requestHeaders: input.requestHeaders ?? null,
      responseStatus: input.responseStatus ?? null,
      responseBody: input.responseBody ?? null,
      status: input.status,
      attemptNumber: input.attemptNumber,
      lastError: input.lastError ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
    };
    this.webhookDeliveryLog.unshift(record);
    return record;
  }

  async listWebhookDeliveries(filter?: { webhookId?: string; status?: string; limit?: number }) {
    let rows = this.webhookDeliveryLog;
    if (filter?.webhookId) rows = rows.filter((r) => r.webhookId === filter.webhookId);
    if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
    const limit = filter?.limit ?? 100;
    return rows.slice(0, limit);
  }

  // ── Workflow engine (migration 021) ──

  async listWorkflowDefinitions(filter?: { enabled?: boolean; includeDeleted?: boolean }) {
    return [...this.workflowDefinitions.values()].filter((d) => {
      if (!filter?.includeDeleted && d.deletedAt !== null) return false;
      if (filter?.enabled !== undefined && d.enabled !== filter.enabled) return false;
      return true;
    });
  }

  async getWorkflowDefinition(id: string) {
    return this.workflowDefinitions.get(id) ?? null;
  }

  async getWorkflowDefinitionByName(name: string) {
    // Returns the highest-version non-deleted definition for this name
    const candidates = [...this.workflowDefinitions.values()]
      .filter((d) => d.name === name && d.deletedAt === null)
      .sort((a, b) => b.version - a.version);
    return candidates[0] ?? null;
  }

  async createWorkflowDefinition(
    input: Parameters<PersistenceAdapter["createWorkflowDefinition"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    // Auto-increment version per name
    const existing = [...this.workflowDefinitions.values()].filter(
      (d) => d.name === input.name && d.deletedAt === null,
    );
    const version = input.version ?? (existing.length > 0 ? Math.max(...existing.map((d) => d.version)) + 1 : 1);
    const record = {
      id: randomUUID(),
      name: input.name,
      version,
      description: input.description ?? null,
      dslJson: input.dslJson,
      enabled: input.enabled ?? true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.workflowDefinitions.set(record.id, record);
    return record;
  }

  async updateWorkflowDefinition(
    id: string,
    updates: Parameters<PersistenceAdapter["updateWorkflowDefinition"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.workflowDefinitions.get(id);
    if (!existing || existing.deletedAt !== null) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      description: updates.description !== undefined ? (updates.description ?? null) : existing.description,
      dslJson: updates.dslJson ?? existing.dslJson,
      enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
      updatedAt: now,
    };
    this.workflowDefinitions.set(id, updated);
    return updated;
  }

  async deleteWorkflowDefinition(id: string, ctx: WriteContext) {
    const existing = this.workflowDefinitions.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    const now = this.resolveNow(ctx).toISOString();
    this.workflowDefinitions.set(id, { ...existing, deletedAt: now });
    return true;
  }

  async createWorkflowInstance(
    input: Parameters<PersistenceAdapter["createWorkflowInstance"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      definitionId: input.definitionId,
      definitionVersion: input.definitionVersion,
      currentNodeId: input.currentNodeId,
      state: "pending" as const,
      contextJson: input.contextJson,
      startedBy: input.startedBy,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
      parentEntityType: input.parentEntityType ?? null,
      parentEntityId: input.parentEntityId ?? null,
    };
    this.workflowInstances.set(record.id, record);
    return record;
  }

  async getWorkflowInstance(id: string) {
    return this.workflowInstances.get(id) ?? null;
  }

  async listWorkflowInstances(filter?: { definitionId?: string; state?: string; parentEntityType?: string; parentEntityId?: string; limit?: number }) {
    let rows = [...this.workflowInstances.values()];
    if (filter?.definitionId) rows = rows.filter((i) => i.definitionId === filter.definitionId);
    if (filter?.state) rows = rows.filter((i) => i.state === filter.state);
    if (filter?.parentEntityType) rows = rows.filter((i) => i.parentEntityType === filter.parentEntityType);
    if (filter?.parentEntityId) rows = rows.filter((i) => i.parentEntityId === filter.parentEntityId);
    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return rows.slice(0, filter?.limit ?? 100);
  }

  async updateWorkflowInstance(
    id: string,
    updates: Parameters<PersistenceAdapter["updateWorkflowInstance"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.workflowInstances.get(id);
    if (!existing) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      currentNodeId: updates.currentNodeId ?? existing.currentNodeId,
      state: updates.state ?? existing.state,
      contextJson: updates.contextJson ?? existing.contextJson,
      completedAt: updates.completedAt !== undefined ? updates.completedAt : existing.completedAt,
      lastError: updates.lastError !== undefined ? updates.lastError : existing.lastError,
      updatedAt: now,
    };
    this.workflowInstances.set(id, updated);
    return updated;
  }

  async recordWorkflowTransition(
    input: Parameters<PersistenceAdapter["recordWorkflowTransition"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    this.workflowTransitions.push({
      id: randomUUID(),
      instanceId: input.instanceId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      eventType: input.eventType ?? null,
      actor: input.actor ?? null,
      payloadJson: input.payloadJson ?? null,
      at: now,
    });
  }

  async listWorkflowTransitions(instanceId: string) {
    return this.workflowTransitions
      .filter((t) => t.instanceId === instanceId)
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  // ── Framework-enforced Audit (Fastify hooks) ──

  async recordRequestAudit(event: {
    message: string;
    correlationId: string;
    actor?: string;
    method?: string;
    path?: string;
    statusCode?: number;
  }): Promise<void> {
    const decorated =
      event.method && event.path
        ? `${event.method} ${event.path} → ${event.statusCode ?? "?"} by ${event.actor ?? "anonymous"}: ${event.message}`
        : event.message;
    this.recordAudit(decorated, event.correlationId, new Date());
  }

  // ── Custom Fields — Definitions ──

  async listCustomFieldDefinitions(entityType?: string, includeDeleted = false) {
    return [...this.customFieldDefinitions.values()].filter((d) => {
      if (entityType && d.entityType !== entityType) return false;
      if (!includeDeleted && d.deletedAt !== null) return false;
      return true;
    });
  }

  async getCustomFieldDefinition(id: string) {
    return this.customFieldDefinitions.get(id) ?? null;
  }

  async createCustomFieldDefinition(
    input: Parameters<PersistenceAdapter["createCustomFieldDefinition"]>[0],
    ctx: WriteContext,
  ) {
    // Enforce uniqueness on (entity_type, name) for non-deleted rows
    for (const existing of this.customFieldDefinitions.values()) {
      if (existing.entityType === input.entityType && existing.name === input.name && existing.deletedAt === null) {
        throw new Error(`Custom field "${input.name}" already exists on ${input.entityType}`);
      }
    }
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      entityType: input.entityType,
      name: input.name,
      displayLabel: input.displayLabel,
      dataType: input.dataType,
      required: input.required ?? false,
      validationJson: input.validationJson ?? null,
      displayConfigJson: input.displayConfigJson ?? null,
      description: input.description ?? null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.customFieldDefinitions.set(record.id, record);
    this.recordAudit(`custom field defined: ${input.entityType}.${input.name}`, ctx.correlationId, new Date());
    return record;
  }

  async updateCustomFieldDefinition(
    id: string,
    input: Partial<Parameters<PersistenceAdapter["createCustomFieldDefinition"]>[0]>,
    ctx: WriteContext,
  ) {
    const existing = this.customFieldDefinitions.get(id);
    if (!existing || existing.deletedAt !== null) return null;
    const now = this.resolveNow(ctx).toISOString();
    // `name`, `entityType`, and `dataType` are immutable once created — changing
    // them would invalidate stored values. Only display/validation/desc/required mutable.
    const updated = {
      ...existing,
      displayLabel: input.displayLabel ?? existing.displayLabel,
      required: input.required ?? existing.required,
      validationJson: input.validationJson !== undefined ? input.validationJson : existing.validationJson,
      displayConfigJson: input.displayConfigJson !== undefined ? input.displayConfigJson : existing.displayConfigJson,
      description: input.description !== undefined ? input.description : existing.description,
      updatedAt: now,
    };
    this.customFieldDefinitions.set(id, updated);
    this.recordAudit(`custom field updated: ${existing.entityType}.${existing.name}`, ctx.correlationId, new Date());
    return updated;
  }

  async softDeleteCustomFieldDefinition(id: string, ctx: WriteContext) {
    const existing = this.customFieldDefinitions.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    const now = this.resolveNow(ctx).toISOString();
    this.customFieldDefinitions.set(id, { ...existing, deletedAt: now, updatedAt: now });
    this.recordAudit(`custom field soft-deleted: ${existing.entityType}.${existing.name}`, ctx.correlationId, new Date());
    return true;
  }

  // ── Custom Fields — Values ──

  async getCustomFieldValues(entityType: string, entityId: string) {
    return [...this.customFieldValues.values()].filter(
      (v) => v.entityType === entityType && v.entityId === entityId,
    );
  }

  async setCustomFieldValue(
    input: Parameters<PersistenceAdapter["setCustomFieldValue"]>[0],
    ctx: WriteContext,
  ) {
    const now = this.resolveNow(ctx).toISOString();
    // Upsert by (definitionId, entityType, entityId)
    const existingKey = [...this.customFieldValues.entries()].find(
      ([, v]) =>
        v.definitionId === input.definitionId &&
        v.entityType === input.entityType &&
        v.entityId === input.entityId,
    );
    if (existingKey) {
      const [id, existing] = existingKey;
      const updated = {
        ...existing,
        valueText: input.valueText ?? null,
        valueNumber: input.valueNumber ?? null,
        valueBool: input.valueBool ?? null,
        valueDate: input.valueDate ?? null,
        updatedAt: now,
      };
      this.customFieldValues.set(id, updated);
      return updated;
    }
    const record = {
      id: randomUUID(),
      definitionId: input.definitionId,
      entityType: input.entityType,
      entityId: input.entityId,
      valueText: input.valueText ?? null,
      valueNumber: input.valueNumber ?? null,
      valueBool: input.valueBool ?? null,
      valueDate: input.valueDate ?? null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.customFieldValues.set(record.id, record);
    return record;
  }

  async deleteCustomFieldValue(
    definitionId: string,
    entityType: string,
    entityId: string,
    ctx: WriteContext,
  ) {
    const existingKey = [...this.customFieldValues.entries()].find(
      ([, v]) =>
        v.definitionId === definitionId &&
        v.entityType === entityType &&
        v.entityId === entityId,
    );
    if (!existingKey) return false;
    this.customFieldValues.delete(existingKey[0]);
    this.recordAudit(`custom field value deleted: ${entityType}/${entityId}`, ctx.correlationId, new Date());
    return true;
  }

  // ── Naming templates (migration 023) ──

  async listNamingTemplates(filter?: { scope?: string; enabled?: boolean; includeDeleted?: boolean }) {
    return [...this.namingTemplates.values()].filter((t) => {
      if (!filter?.includeDeleted && t.deletedAt !== null) return false;
      if (filter?.scope && t.scope !== filter.scope) return false;
      if (filter?.enabled !== undefined && t.enabled !== filter.enabled) return false;
      return true;
    });
  }

  async getNamingTemplate(id: string) {
    return this.namingTemplates.get(id) ?? null;
  }

  async createNamingTemplate(
    input: Parameters<PersistenceAdapter["createNamingTemplate"]>[0],
    ctx: WriteContext,
  ) {
    const collision = [...this.namingTemplates.values()].find(
      (t) => t.deletedAt === null && t.scope === input.scope && t.name === input.name,
    );
    if (collision) {
      throw new Error(`naming template already exists: ${input.scope}.${input.name}`);
    }
    const now = this.resolveNow(ctx).toISOString();
    const record = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      scope: input.scope,
      template: input.template,
      sampleContextJson: input.sampleContextJson ?? null,
      enabled: input.enabled ?? true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null as string | null,
    };
    this.namingTemplates.set(record.id, record);
    this.recordAudit(`naming template created: ${record.scope}.${record.name}`, ctx.correlationId, new Date());
    return record;
  }

  async updateNamingTemplate(
    id: string,
    updates: Parameters<PersistenceAdapter["updateNamingTemplate"]>[1],
    ctx: WriteContext,
  ) {
    const existing = this.namingTemplates.get(id);
    if (!existing || existing.deletedAt !== null) return null;
    const now = this.resolveNow(ctx).toISOString();
    const updated = {
      ...existing,
      description: updates.description !== undefined ? (updates.description ?? null) : existing.description,
      template: updates.template ?? existing.template,
      sampleContextJson:
        updates.sampleContextJson !== undefined
          ? (updates.sampleContextJson ?? null)
          : existing.sampleContextJson,
      enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
      updatedAt: now,
    };
    this.namingTemplates.set(id, updated);
    this.recordAudit(`naming template updated: ${updated.scope}.${updated.name}`, ctx.correlationId, new Date());
    return updated;
  }

  async softDeleteNamingTemplate(id: string, ctx: WriteContext) {
    const existing = this.namingTemplates.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    const now = this.resolveNow(ctx).toISOString();
    this.namingTemplates.set(id, { ...existing, deletedAt: now, updatedAt: now });
    this.recordAudit(`naming template deleted: ${existing.scope}.${existing.name}`, ctx.correlationId, new Date());
    return true;
  }
}
