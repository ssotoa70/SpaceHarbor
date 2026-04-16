import { randomUUID } from "node:crypto";

import type { ApprovalAuditEntry, AssetDependency, AssetProvenance, AuditEvent, ClipConformStatus, Collection, CollectionItem, CommentAnnotation, CommentStatus, DailiesReportEntry, DownstreamUsageCount, Episode, LookVariant, Material, MaterialDependency, MaterialVersion, Playlist, PlaylistItem, Project, ProjectStatus, RenderFarmMetric, ReviewComment, ReviewSession, ReviewSessionStatus, ReviewSessionSubmission, ReviewStatus, Sequence, Shot, ShotAssetUsage, ShotStatus, StorageMetric, SubmissionStatus, Task, TaskStatus, Timeline, TimelineChangeSet, TimelineClip, TimelineStatus, Version, VersionApproval, VersionComparison, VersionLineage, VersionMaterialBinding, VfxMetadata } from "../../domain/models.js";
import type { OutboundNotifier } from "../../integrations/outbound/notifier.js";
import type { OutboundConfig } from "../../integrations/outbound/types.js";
import type { DccAuditEntry } from "../../types/dcc.js";
import type { AuditSignal } from "../../domain/models.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import { LocalPersistenceAdapter } from "./local-persistence.js";
import type {
  AuditRetentionApplyResult,
  AuditRetentionPreview,
  CreateCommentAnnotationInput,
  CreateEpisodeInput,
  CreateLookVariantInput,
  CreateMaterialDependencyInput,
  CreateMaterialInput,
  CreateMaterialVersionInput,
  CreateProjectInput,
  CreateReviewCommentInput,
  CreateReviewSessionInput,
  CreateSequenceInput,
  CreateShotInput,
  CreateTaskInput,
  CreateVersionApprovalInput,
  CreateVersionInput,
  CreateVersionComparisonInput,
  CreateVersionMaterialBindingInput,
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
  PersistenceAdapter,
  WorkflowStats,
  WriteContext
} from "../types.js";
import type { VastWorkflowClient } from "../vast/workflow-client.js";
import { TrinoClient } from "../../db/trino-client.js";
import * as tq from "./vast-trino-queries.js";

interface VastConfig {
  databaseUrl: string | undefined;
  eventBrokerUrl: string | undefined;
  dataEngineUrl: string | undefined;
  strict: boolean;
  fallbackToLocal: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class VastPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "vast" as const;

  private readonly localFallback: LocalPersistenceAdapter;
  private readonly fallbackAuditEvents: AuditEvent[] = [];
  private readonly fetchFn: FetchLike;
  private readonly workflowClient: VastWorkflowClient | undefined;
  private readonly trinoClient: TrinoClient | null;

  constructor(
    private readonly config: VastConfig,
    fetchFn?: FetchLike,
    workflowClient?: VastWorkflowClient,
    outboundConfig?: OutboundConfig,
    outboundNotifier?: OutboundNotifier
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.workflowClient = workflowClient;
    this.localFallback = new LocalPersistenceAdapter(outboundConfig, outboundNotifier);

    // Initialize Trino client if database URL is configured
    if (this.config.databaseUrl) {
      const url = new URL(this.config.databaseUrl);
      // Prefer separate env vars over URL-embedded credentials (prevents credential leakage)
      // VAST_TRINO_* are deprecated — prefer VAST_DB_* canonical names.
      if ((process.env.VAST_TRINO_USERNAME || process.env.VAST_TRINO_PASSWORD) && !(process.env.VAST_DB_USERNAME || process.env.VAST_DB_PASSWORD)) {
        console.warn("DEPRECATED: VAST_TRINO_USERNAME/PASSWORD will be removed. Use VAST_DB_USERNAME/PASSWORD instead.");
      }
      const accessKey = process.env.VAST_DB_USERNAME || process.env.VAST_TRINO_USERNAME || process.env.VAST_ACCESS_KEY || "";
      const secretKey = process.env.VAST_DB_PASSWORD || process.env.VAST_TRINO_PASSWORD || process.env.VAST_SECRET_KEY || "";
      this.trinoClient = new TrinoClient({
        endpoint: `${url.protocol}//${url.host}`,
        accessKey,
        secretKey
      });
    } else {
      this.trinoClient = null;
    }

    if (this.config.strict) {
      const missing: string[] = [];
      if (!this.config.databaseUrl) {
        missing.push("VAST_DATABASE_URL");
      }
      if (!this.config.eventBrokerUrl) {
        missing.push("VAST_EVENT_BROKER_URL");
      }
      if (!this.config.dataEngineUrl) {
        missing.push("VAST_DATAENGINE_URL");
      }

      if (missing.length > 0) {
        throw new Error(`missing required VAST configuration: ${missing.join(", ")}`);
      }
    }
  }

  reset(): void {
    this.localFallback.reset();
    this.fallbackAuditEvents.length = 0;
  }

  async createIngestAsset(
    input: Parameters<PersistenceAdapter["createIngestAsset"]>[0],
    context: Parameters<PersistenceAdapter["createIngestAsset"]>[1]
  ) {
    return this.invokeWorkflowClient(
      "createIngestAsset",
      this.workflowClient
        ? () => this.workflowClient!.createIngestAsset(input, context)
        : undefined,
      () => this.localFallback.createIngestAsset(input, context)
    );
  }

  async getAssetById(assetId: Parameters<PersistenceAdapter["getAssetById"]>[0]) {
    return this.invokeWorkflowClient(
      "getAssetById",
      this.workflowClient
        ? () => this.workflowClient!.getAssetById(assetId)
        : undefined,
      () => this.localFallback.getAssetById(assetId)
    );
  }

  async updateAsset(
    assetId: Parameters<PersistenceAdapter["updateAsset"]>[0],
    updates: Parameters<PersistenceAdapter["updateAsset"]>[1],
    context: Parameters<PersistenceAdapter["updateAsset"]>[2]
  ) {
    return this.invokeWorkflowClient(
      "updateAsset",
      this.workflowClient
        ? () => this.workflowClient!.updateAsset(assetId, updates, context)
        : undefined,
      () => this.localFallback.updateAsset(assetId, updates, context)
    );
  }

  async setJobStatus(
    jobId: Parameters<PersistenceAdapter["setJobStatus"]>[0],
    status: Parameters<PersistenceAdapter["setJobStatus"]>[1],
    lastError: Parameters<PersistenceAdapter["setJobStatus"]>[2],
    context: Parameters<PersistenceAdapter["setJobStatus"]>[3]
  ) {
    const existing = await this.getJobById(jobId);
    if (existing && !canTransitionWorkflowStatus(existing.status, status)) {
      return null;
    }

    return this.invokeWorkflowClient(
      "setJobStatus",
      this.workflowClient
        ? () => this.workflowClient!.setJobStatus(jobId, status, lastError, context)
        : undefined,
      () => this.localFallback.setJobStatus(jobId, status, lastError, context)
    );
  }

  async updateJobStatus(
    jobId: Parameters<PersistenceAdapter["updateJobStatus"]>[0],
    expectedStatus: Parameters<PersistenceAdapter["updateJobStatus"]>[1],
    newStatus: Parameters<PersistenceAdapter["updateJobStatus"]>[2],
    context: Parameters<PersistenceAdapter["updateJobStatus"]>[3]
  ): Promise<boolean> {
    return this.invokeWorkflowClient(
      "updateJobStatus",
      this.workflowClient
        ? () => this.workflowClient!.updateJobStatus(jobId, expectedStatus, newStatus, context)
        : undefined,
      () => this.localFallback.updateJobStatus(jobId, expectedStatus, newStatus, context)
    );
  }

  async getJobById(jobId: Parameters<PersistenceAdapter["getJobById"]>[0]) {
    return this.invokeWorkflowClient(
      "getJobById",
      this.workflowClient
        ? () => this.workflowClient!.getJobById(jobId)
        : undefined,
      () => this.localFallback.getJobById(jobId)
    );
  }

  async getPendingJobs() {
    return this.invokeWorkflowClient(
      "getPendingJobs",
      this.workflowClient
        ? () => this.workflowClient!.getPendingJobs()
        : undefined,
      () => this.localFallback.getPendingJobs()
    );
  }

  async claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.invokeWorkflowClient(
      "claimNextJob",
      this.workflowClient
        ? () => this.workflowClient!.claimNextJob(workerId, leaseSeconds, context)
        : undefined,
      () => this.localFallback.claimNextJob(workerId, leaseSeconds, context)
    );
  }

  async heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.invokeWorkflowClient(
      "heartbeatJob",
      this.workflowClient
        ? () => this.workflowClient!.heartbeatJob(jobId, workerId, leaseSeconds, context)
        : undefined,
      () => this.localFallback.heartbeatJob(jobId, workerId, leaseSeconds, context)
    );
  }

  async reapStaleLeases(nowIso: string): Promise<number> {
    return this.invokeWorkflowClient(
      "reapStaleLeases",
      this.workflowClient
        ? () => this.workflowClient!.reapStaleLeases(nowIso)
        : undefined,
      () => this.localFallback.reapStaleLeases(nowIso)
    );
  }

  async handleJobFailure(jobId: string, error: string, context: WriteContext): Promise<FailureResult> {
    return this.invokeWorkflowClient(
      "handleJobFailure",
      this.workflowClient
        ? () => this.workflowClient!.handleJobFailure(jobId, error, context)
        : undefined,
      () => this.localFallback.handleJobFailure(jobId, error, context)
    );
  }

  async replayJob(jobId: string, context: WriteContext) {
    return this.invokeWorkflowClient(
      "replayJob",
      this.workflowClient
        ? () => this.workflowClient!.replayJob(jobId, context)
        : undefined,
      () => this.localFallback.replayJob(jobId, context)
    );
  }

  async getDlqItems() {
    return this.invokeWorkflowClient(
      "getDlqItems",
      this.workflowClient
        ? () => this.workflowClient!.getDlqItems()
        : undefined,
      () => this.localFallback.getDlqItems()
    );
  }

  async getDlqItem(jobId: string) {
    return this.invokeWorkflowClient(
      "getDlqItem",
      this.workflowClient
        ? () => this.workflowClient!.getDlqItem(jobId)
        : undefined,
      () => this.localFallback.getDlqItem(jobId)
    );
  }

  async purgeDlqItems(beforeIso: string) {
    return this.invokeWorkflowClient(
      "purgeDlqItems",
      this.workflowClient
        ? () => this.workflowClient!.purgeDlqItems(beforeIso)
        : undefined,
      () => this.localFallback.purgeDlqItems(beforeIso)
    );
  }

  async getOutboxItems() {
    return this.invokeWorkflowClient(
      "getOutboxItems",
      this.workflowClient
        ? () => this.workflowClient!.getOutboxItems()
        : undefined,
      () => this.localFallback.getOutboxItems()
    );
  }

  async publishOutbox(context: WriteContext): Promise<number> {
    const outboxItems = (await this.getOutboxItems()).filter((item) => !item.publishedAt);
    if (outboxItems.length === 0) {
      return 0;
    }

    if (!this.config.eventBrokerUrl) {
      return this.localFallback.publishOutbox(context);
    }

    const brokerUrl = `${this.config.eventBrokerUrl.replace(/\/$/, "")}/events`;

    try {
      for (const item of outboxItems) {
        const response = await this.fetchFn(brokerUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": context.correlationId
          },
          body: JSON.stringify({
            eventType: item.eventType,
            correlationId: item.correlationId,
            payload: item.payload,
            occurredAt: item.createdAt
          })
        });

        if (!response.ok) {
          return 0;
        }
      }
    } catch {
      return 0;
    }

    return this.localFallback.publishOutbox(context);
  }

  async getWorkflowStats(nowIso?: string): Promise<WorkflowStats> {
    const stats = await this.localFallback.getWorkflowStats(nowIso);

    return {
      ...stats,
      degradedMode: {
        fallbackEvents: stats.degradedMode.fallbackEvents + this.fallbackAuditEvents.length
      }
    };
  }

  async listAssetQueueRows() {
    return this.invokeWorkflowClient(
      "listAssetQueueRows",
      this.workflowClient
        ? () => this.workflowClient!.listAssetQueueRows()
        : undefined,
      () => this.localFallback.listAssetQueueRows()
    );
  }

  async getAuditEvents() {
    const [fallbackEvents, localEvents] = await Promise.all([
      Promise.resolve(this.fallbackAuditEvents),
      this.invokeWorkflowClient(
        "getAuditEvents",
        this.workflowClient
          ? () => this.workflowClient!.getAuditEvents()
          : undefined,
        () => this.localFallback.getAuditEvents()
      )
    ]);
    const merged = [...fallbackEvents, ...localEvents];
    return merged.sort((a, b) => b.at.localeCompare(a.at));
  }

  async previewAuditRetention(cutoffIso: string): Promise<AuditRetentionPreview> {
    return this.invokeWorkflowClient(
      "previewAuditRetention",
      this.workflowClient
        ? () => this.workflowClient!.previewAuditRetention(cutoffIso)
        : undefined,
      () => this.localFallback.previewAuditRetention(cutoffIso)
    );
  }

  async applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): Promise<AuditRetentionApplyResult> {
    return this.invokeWorkflowClient(
      "applyAuditRetention",
      this.workflowClient
        ? () => this.workflowClient!.applyAuditRetention(cutoffIso, maxDeletePerRun)
        : undefined,
      () => this.localFallback.applyAuditRetention(cutoffIso, maxDeletePerRun)
    );
  }

  async getIncidentCoordination() {
    return this.invokeWorkflowClient(
      "getIncidentCoordination",
      this.workflowClient
        ? () => this.workflowClient!.getIncidentCoordination()
        : undefined,
      () => this.localFallback.getIncidentCoordination()
    );
  }

  async updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext) {
    return this.invokeWorkflowClient(
      "updateIncidentGuidedActions",
      this.workflowClient
        ? () => this.workflowClient!.updateIncidentGuidedActions(update, context)
        : undefined,
      () => this.localFallback.updateIncidentGuidedActions(update, context)
    );
  }

  async addIncidentNote(input: IncidentNoteInput, context: WriteContext) {
    return this.invokeWorkflowClient(
      "addIncidentNote",
      this.workflowClient
        ? () => this.workflowClient!.addIncidentNote(input, context)
        : undefined,
      () => this.localFallback.addIncidentNote(input, context)
    );
  }

  async updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext) {
    return this.invokeWorkflowClient(
      "updateIncidentHandoff",
      this.workflowClient
        ? () => this.workflowClient!.updateIncidentHandoff(update, context)
        : undefined,
      () => this.localFallback.updateIncidentHandoff(update, context)
    );
  }

  // Approval audit log — route through workflowClient when available
  async appendApprovalAuditEntry(entry: ApprovalAuditEntry): Promise<void> {
    return this.invokeWorkflowClient(
      "appendApprovalAuditEntry",
      this.workflowClient
        ? () => this.workflowClient!.appendApprovalAuditEntry(entry)
        : undefined,
      () => this.localFallback.appendApprovalAuditEntry(entry)
    );
  }

  async getApprovalAuditLog(): Promise<ApprovalAuditEntry[]> {
    return this.invokeWorkflowClient(
      "getApprovalAuditLog",
      this.workflowClient
        ? () => this.workflowClient!.getApprovalAuditLog()
        : undefined,
      () => this.localFallback.getApprovalAuditLog()
    );
  }

  async getApprovalAuditLogByAssetId(assetId: string): Promise<ApprovalAuditEntry[]> {
    return this.invokeWorkflowClient(
      "getApprovalAuditLogByAssetId",
      this.workflowClient
        ? () => this.workflowClient!.getApprovalAuditLogByAssetId(assetId)
        : undefined,
      () => this.localFallback.getApprovalAuditLogByAssetId(assetId)
    );
  }

  async resetApprovalAuditLog(): Promise<void> {
    return this.localFallback.resetApprovalAuditLog();
  }

  // DCC audit trail — route through workflowClient when available
  async appendDccAuditEntry(entry: DccAuditEntry): Promise<void> {
    return this.invokeWorkflowClient(
      "appendDccAuditEntry",
      this.workflowClient
        ? () => this.workflowClient!.appendDccAuditEntry(entry)
        : undefined,
      () => this.localFallback.appendDccAuditEntry(entry)
    );
  }

  async getDccAuditTrail(): Promise<readonly DccAuditEntry[]> {
    return this.invokeWorkflowClient(
      "getDccAuditTrail",
      this.workflowClient
        ? () => this.workflowClient!.getDccAuditTrail()
        : undefined,
      () => this.localFallback.getDccAuditTrail()
    );
  }

  async clearDccAuditTrail(): Promise<void> {
    return this.localFallback.clearDccAuditTrail();
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.invokeWorkflowClient(
      "hasProcessedEvent",
      this.workflowClient
        ? () => this.workflowClient!.hasProcessedEvent(eventId)
        : undefined,
      () => this.localFallback.hasProcessedEvent(eventId)
    );
  }

  async markProcessedEvent(eventId: string): Promise<void> {
    return this.invokeWorkflowClient(
      "markProcessedEvent",
      this.workflowClient
        ? () => this.workflowClient!.markProcessedEvent(eventId)
        : undefined,
      () => this.localFallback.markProcessedEvent(eventId)
    );
  }

  async markIfNotProcessed(eventId: string): Promise<boolean> {
    return this.invokeWorkflowClient(
      "markIfNotProcessed",
      this.workflowClient
        ? () => this.workflowClient!.markIfNotProcessed(eventId)
        : undefined,
      () => this.localFallback.markIfNotProcessed(eventId)
    );
  }

  private async invokeWorkflowClient<T>(
    operation: string,
    clientCall: (() => Promise<T>) | undefined,
    fallbackCall: () => Promise<T>
  ): Promise<T> {
    if (!clientCall) {
      return fallbackCall();
    }

    try {
      return await clientCall();
    } catch (error) {
      if (!this.shouldFallback(error)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`vast workflow client failure (${operation}): ${errorMessage}`);
      }

      this.recordFallbackAudit(operation, error);

      return fallbackCall();
    }
  }

  private recordFallbackAudit(operation: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const signal: AuditSignal = {
      type: "fallback",
      code: "VAST_FALLBACK",
      severity: "warning"
    };

    // Log at WARNING level so operators notice — silent fallback masks data loss
    console.warn(`[VAST_FALLBACK] ${operation}: falling back to local adapter — ${errorMessage}`);

    this.fallbackAuditEvents.unshift({
      id: randomUUID(),
      message: `[corr:system] vast fallback (${operation}) due to client error: ${errorMessage}`,
      at: new Date().toISOString(),
      signal
    });
  }

  private shouldFallback(_error: unknown): boolean {
    if (this.config.strict) {
      return false;
    }

    return this.config.fallbackToLocal;
  }

  // ---------------------------------------------------------------------------
  // VFX Hierarchy — Trino SQL with localFallback when no TrinoClient
  // ---------------------------------------------------------------------------

  async createProject(input: CreateProjectInput, ctx: WriteContext): Promise<Project> {
    if (!this.trinoClient) return this.localFallback.createProject(input, ctx);
    return tq.insertProject(this.trinoClient, input, ctx);
  }

  async getProjectById(id: string): Promise<Project | null> {
    if (!this.trinoClient) return this.localFallback.getProjectById(id);
    return tq.queryProjectById(this.trinoClient, id);
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    if (!this.trinoClient) return this.localFallback.listProjects(status);
    return tq.queryProjects(this.trinoClient, status);
  }

  async createSequence(input: CreateSequenceInput, ctx: WriteContext): Promise<Sequence> {
    if (!this.trinoClient) return this.localFallback.createSequence(input, ctx);
    return tq.insertSequence(this.trinoClient, input, ctx);
  }

  async getSequenceById(id: string): Promise<Sequence | null> {
    if (!this.trinoClient) return this.localFallback.getSequenceById(id);
    return tq.querySequenceById(this.trinoClient, id);
  }

  async listSequencesByProject(projectId: string): Promise<Sequence[]> {
    if (!this.trinoClient) return this.localFallback.listSequencesByProject(projectId);
    return tq.querySequencesByProject(this.trinoClient, projectId);
  }

  async createShot(input: CreateShotInput, ctx: WriteContext): Promise<Shot> {
    if (!this.trinoClient) return this.localFallback.createShot(input, ctx);
    return tq.insertShot(this.trinoClient, input, ctx);
  }

  async getShotById(id: string): Promise<Shot | null> {
    if (!this.trinoClient) return this.localFallback.getShotById(id);
    return tq.queryShotById(this.trinoClient, id);
  }

  async listShotsBySequence(sequenceId: string): Promise<Shot[]> {
    if (!this.trinoClient) return this.localFallback.listShotsBySequence(sequenceId);
    return tq.queryShotsBySequence(this.trinoClient, sequenceId);
  }

  async updateShotStatus(shotId: string, status: ShotStatus, ctx: WriteContext): Promise<Shot | null> {
    if (!this.trinoClient) return this.localFallback.updateShotStatus(shotId, status, ctx);
    return tq.updateShotStatusSql(this.trinoClient, shotId, status, ctx);
  }

  async createVersion(input: CreateVersionInput, ctx: WriteContext): Promise<Version> {
    if (!this.trinoClient) return this.localFallback.createVersion(input, ctx);
    return tq.insertVersion(this.trinoClient, input, ctx);
  }

  async getVersionById(id: string): Promise<Version | null> {
    if (!this.trinoClient) return this.localFallback.getVersionById(id);
    return tq.queryVersionById(this.trinoClient, id);
  }

  async listVersionsByShot(shotId: string): Promise<Version[]> {
    if (!this.trinoClient) return this.localFallback.listVersionsByShot(shotId);
    return tq.queryVersionsByShot(this.trinoClient, shotId);
  }

  async publishVersion(versionId: string, ctx: WriteContext): Promise<Version | null> {
    if (!this.trinoClient) return this.localFallback.publishVersion(versionId, ctx);
    return tq.publishVersionSql(this.trinoClient, versionId, ctx);
  }

  async updateVersionReviewStatus(versionId: string, status: ReviewStatus, ctx: WriteContext): Promise<Version | null> {
    if (!this.trinoClient) return this.localFallback.updateVersionReviewStatus(versionId, status, ctx);
    return tq.updateVersionReviewStatusSql(this.trinoClient, versionId, status, ctx);
  }

  async updateVersionTechnicalMetadata(
    versionId: string,
    meta: Partial<VfxMetadata>,
    ctx: WriteContext
  ): Promise<Version | null> {
    if (!this.trinoClient) return this.localFallback.updateVersionTechnicalMetadata(versionId, meta, ctx);
    return tq.updateVersionTechnicalMetadataSql(this.trinoClient, versionId, meta, ctx);
  }

  async createVersionApproval(
    input: CreateVersionApprovalInput,
    ctx: WriteContext
  ): Promise<VersionApproval> {
    if (!this.trinoClient) return this.localFallback.createVersionApproval(input, ctx);
    return tq.insertVersionApproval(this.trinoClient, input, ctx);
  }

  async listApprovalsByVersion(versionId: string): Promise<VersionApproval[]> {
    if (!this.trinoClient) return this.localFallback.listApprovalsByVersion(versionId);
    return tq.queryApprovalsByVersion(this.trinoClient, versionId);
  }

  // Episodes
  async createEpisode(input: CreateEpisodeInput, ctx: WriteContext): Promise<Episode> {
    if (!this.trinoClient) return this.localFallback.createEpisode(input, ctx);
    return tq.insertEpisode(this.trinoClient, input, ctx);
  }

  async getEpisodeById(id: string): Promise<Episode | null> {
    if (!this.trinoClient) return this.localFallback.getEpisodeById(id);
    return tq.queryEpisodeById(this.trinoClient, id);
  }

  async listEpisodesByProject(projectId: string): Promise<Episode[]> {
    if (!this.trinoClient) return this.localFallback.listEpisodesByProject(projectId);
    return tq.queryEpisodesByProject(this.trinoClient, projectId);
  }

  // Tasks
  async createTask(input: CreateTaskInput, ctx: WriteContext): Promise<Task> {
    if (!this.trinoClient) return this.localFallback.createTask(input, ctx);
    return tq.insertTask(this.trinoClient, input, ctx);
  }

  async getTaskById(id: string): Promise<Task | null> {
    if (!this.trinoClient) return this.localFallback.getTaskById(id);
    return tq.queryTaskById(this.trinoClient, id);
  }

  async listTasksByShot(shotId: string): Promise<Task[]> {
    if (!this.trinoClient) return this.localFallback.listTasksByShot(shotId);
    return tq.queryTasksByShot(this.trinoClient, shotId);
  }

  async listTasksByAssignee(assignee: string, statusFilter?: string): Promise<Task[]> {
    // Delegates to local fallback — Trino SQL query not yet implemented
    return this.localFallback.listTasksByAssignee(assignee, statusFilter);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null> {
    if (!this.trinoClient) return this.localFallback.updateTaskStatus(taskId, status, ctx);
    return tq.updateTaskStatusSql(this.trinoClient, taskId, status, ctx);
  }

  // Materials
  async createMaterial(input: CreateMaterialInput, ctx: WriteContext): Promise<Material> {
    if (!this.trinoClient) return this.localFallback.createMaterial(input, ctx);
    return tq.insertMaterial(this.trinoClient, input, ctx);
  }

  async getMaterialById(id: string): Promise<Material | null> {
    if (!this.trinoClient) return this.localFallback.getMaterialById(id);
    return tq.queryMaterialById(this.trinoClient, id);
  }

  async listMaterialsByProject(projectId: string): Promise<Material[]> {
    if (!this.trinoClient) return this.localFallback.listMaterialsByProject(projectId);
    return tq.queryMaterialsByProject(this.trinoClient, projectId);
  }

  async createMaterialVersion(input: CreateMaterialVersionInput, ctx: WriteContext): Promise<MaterialVersion> {
    if (!this.trinoClient) return this.localFallback.createMaterialVersion(input, ctx);
    return tq.insertMaterialVersion(this.trinoClient, input, ctx);
  }

  async getMaterialVersionById(id: string): Promise<MaterialVersion | null> {
    if (!this.trinoClient) return this.localFallback.getMaterialVersionById(id);
    return tq.queryMaterialVersionById(this.trinoClient, id);
  }

  async listMaterialVersionsByMaterial(materialId: string): Promise<MaterialVersion[]> {
    if (!this.trinoClient) return this.localFallback.listMaterialVersionsByMaterial(materialId);
    return tq.queryMaterialVersionsByMaterial(this.trinoClient, materialId);
  }

  async findMaterialVersionBySourcePathAndHash(sourcePath: string, contentHash: string): Promise<MaterialVersion | null> {
    if (!this.trinoClient) return this.localFallback.findMaterialVersionBySourcePathAndHash(sourcePath, contentHash);
    return tq.queryMaterialVersionBySourcePathAndHash(this.trinoClient, sourcePath, contentHash);
  }

  async createLookVariant(input: CreateLookVariantInput, ctx: WriteContext): Promise<LookVariant> {
    if (!this.trinoClient) return this.localFallback.createLookVariant(input, ctx);
    return tq.insertLookVariant(this.trinoClient, input, ctx);
  }

  async listLookVariantsByMaterialVersion(materialVersionId: string): Promise<LookVariant[]> {
    if (!this.trinoClient) return this.localFallback.listLookVariantsByMaterialVersion(materialVersionId);
    return tq.queryLookVariantsByMaterialVersion(this.trinoClient, materialVersionId);
  }

  async createVersionMaterialBinding(input: CreateVersionMaterialBindingInput, ctx: WriteContext): Promise<VersionMaterialBinding> {
    if (!this.trinoClient) return this.localFallback.createVersionMaterialBinding(input, ctx);
    return tq.insertVersionMaterialBinding(this.trinoClient, input, ctx);
  }

  async listBindingsByLookVariant(lookVariantId: string): Promise<VersionMaterialBinding[]> {
    if (!this.trinoClient) return this.localFallback.listBindingsByLookVariant(lookVariantId);
    return tq.queryBindingsByLookVariant(this.trinoClient, lookVariantId);
  }

  async listBindingsByVersion(versionId: string): Promise<VersionMaterialBinding[]> {
    if (!this.trinoClient) return this.localFallback.listBindingsByVersion(versionId);
    return tq.queryBindingsByVersion(this.trinoClient, versionId);
  }

  async createMaterialDependency(input: CreateMaterialDependencyInput, ctx: WriteContext): Promise<MaterialDependency> {
    if (!this.trinoClient) return this.localFallback.createMaterialDependency(input, ctx);
    return tq.insertMaterialDependency(this.trinoClient, input, ctx);
  }

  async listDependenciesByMaterialVersion(materialVersionId: string): Promise<MaterialDependency[]> {
    if (!this.trinoClient) return this.localFallback.listDependenciesByMaterialVersion(materialVersionId);
    return tq.queryDependenciesByMaterialVersion(this.trinoClient, materialVersionId);
  }

  async countBindingsForMaterial(materialId: string): Promise<number> {
    if (!this.trinoClient) return this.localFallback.countBindingsForMaterial(materialId);
    return tq.queryCountBindingsForMaterial(this.trinoClient, materialId);
  }

  // Timelines (OTIO) — Trino-backed with local fallback
  async createTimeline(input: import("../types.js").CreateTimelineInput, ctx: import("../types.js").WriteContext): Promise<Timeline> {
    if (!this.trinoClient) return this.localFallback.createTimeline(input, ctx);
    return tq.insertTimeline(this.trinoClient, input, ctx);
  }
  async getTimelineById(id: string): Promise<Timeline | null> {
    if (!this.trinoClient) return this.localFallback.getTimelineById(id);
    return tq.queryTimelineById(this.trinoClient, id);
  }
  async listTimelinesByProject(projectId: string): Promise<Timeline[]> {
    if (!this.trinoClient) return this.localFallback.listTimelinesByProject(projectId);
    return tq.queryTimelinesByProject(this.trinoClient, projectId);
  }
  async updateTimelineStatus(id: string, status: TimelineStatus, ctx: import("../types.js").WriteContext): Promise<Timeline | null> {
    if (!this.trinoClient) return this.localFallback.updateTimelineStatus(id, status, ctx);
    return tq.updateTimelineStatusSql(this.trinoClient, id, status, ctx);
  }
  async createTimelineClip(input: import("../types.js").CreateTimelineClipInput, ctx: import("../types.js").WriteContext): Promise<TimelineClip> {
    if (!this.trinoClient) return this.localFallback.createTimelineClip(input, ctx);
    return tq.insertTimelineClip(this.trinoClient, input, ctx);
  }
  async listClipsByTimeline(timelineId: string): Promise<TimelineClip[]> {
    if (!this.trinoClient) return this.localFallback.listClipsByTimeline(timelineId);
    return tq.queryClipsByTimeline(this.trinoClient, timelineId);
  }
  async updateClipConformStatus(clipId: string, status: ClipConformStatus, shotId?: string, assetId?: string): Promise<void> {
    if (!this.trinoClient) return this.localFallback.updateClipConformStatus(clipId, status, shotId, assetId);
    return tq.updateClipConformStatusSql(this.trinoClient, clipId, status, shotId, assetId);
  }
  async findTimelineByProjectAndName(projectId: string, name: string): Promise<Timeline | null> {
    if (!this.trinoClient) return this.localFallback.findTimelineByProjectAndName(projectId, name);
    return tq.queryTimelineByProjectAndName(this.trinoClient, projectId, name);
  }
  async storeTimelineChanges(changeSet: TimelineChangeSet): Promise<void> {
    if (!this.trinoClient) return this.localFallback.storeTimelineChanges(changeSet);
    return tq.insertTimelineChangeSet(this.trinoClient, changeSet);
  }
  async getTimelineChanges(timelineId: string): Promise<TimelineChangeSet | null> {
    if (!this.trinoClient) return this.localFallback.getTimelineChanges(timelineId);
    return tq.queryTimelineChangeSet(this.trinoClient, timelineId);
  }

  // Review Sessions — Trino-backed with local fallback
  async createReviewSession(input: CreateReviewSessionInput, ctx: WriteContext): Promise<ReviewSession> {
    if (!this.trinoClient) return this.localFallback.createReviewSession(input, ctx);
    return tq.insertReviewSession(this.trinoClient, input, ctx);
  }
  async getReviewSessionById(id: string): Promise<ReviewSession | null> {
    if (!this.trinoClient) return this.localFallback.getReviewSessionById(id);
    return tq.queryReviewSessionById(this.trinoClient, id);
  }
  async listReviewSessions(filters?: { projectId?: string; status?: ReviewSessionStatus; department?: string }): Promise<ReviewSession[]> {
    if (!this.trinoClient) return this.localFallback.listReviewSessions(filters);
    return tq.queryReviewSessions(this.trinoClient, filters);
  }
  async updateReviewSessionStatus(id: string, fromStatus: ReviewSessionStatus, toStatus: ReviewSessionStatus, ctx: WriteContext): Promise<ReviewSession | null> {
    if (!this.trinoClient) return this.localFallback.updateReviewSessionStatus(id, fromStatus, toStatus, ctx);
    return tq.updateReviewSessionStatusSql(this.trinoClient, id, fromStatus, toStatus, ctx);
  }
  async addSubmission(input: AddSubmissionInput, ctx: WriteContext): Promise<ReviewSessionSubmission> {
    if (!this.trinoClient) return this.localFallback.addSubmission(input, ctx);
    return tq.insertSubmission(this.trinoClient, input, ctx);
  }
  async listSubmissionsBySession(sessionId: string): Promise<ReviewSessionSubmission[]> {
    if (!this.trinoClient) return this.localFallback.listSubmissionsBySession(sessionId);
    return tq.querySubmissionsBySession(this.trinoClient, sessionId);
  }
  async updateSubmissionStatus(id: string, fromStatus: SubmissionStatus, toStatus: SubmissionStatus, ctx: WriteContext): Promise<ReviewSessionSubmission | null> {
    if (!this.trinoClient) return this.localFallback.updateSubmissionStatus(id, fromStatus, toStatus, ctx);
    return tq.updateSubmissionStatusSql(this.trinoClient, id, fromStatus, toStatus, ctx);
  }

  // Review Comments (Phase B)
  async createReviewComment(input: CreateReviewCommentInput, ctx: WriteContext): Promise<ReviewComment> {
    if (!this.trinoClient) return this.localFallback.createReviewComment(input, ctx);
    return tq.insertReviewComment(this.trinoClient, input, ctx);
  }
  async getReviewCommentById(id: string): Promise<ReviewComment | null> {
    if (!this.trinoClient) return this.localFallback.getReviewCommentById(id);
    return tq.queryReviewCommentById(this.trinoClient, id);
  }
  async listCommentsBySession(sessionId: string): Promise<ReviewComment[]> {
    if (!this.trinoClient) return this.localFallback.listCommentsBySession(sessionId);
    return tq.queryCommentsBySession(this.trinoClient, sessionId);
  }
  async listCommentsBySubmission(submissionId: string): Promise<ReviewComment[]> {
    if (!this.trinoClient) return this.localFallback.listCommentsBySubmission(submissionId);
    return tq.queryCommentsBySubmission(this.trinoClient, submissionId);
  }
  async listReplies(parentCommentId: string): Promise<ReviewComment[]> {
    if (!this.trinoClient) return this.localFallback.listReplies(parentCommentId);
    return tq.queryReplies(this.trinoClient, parentCommentId);
  }
  async updateCommentStatus(id: string, status: CommentStatus, ctx: WriteContext): Promise<ReviewComment | null> {
    if (!this.trinoClient) return this.localFallback.updateCommentStatus(id, status, ctx);
    return tq.updateReviewCommentStatus(this.trinoClient, id, status, ctx);
  }
  async resolveComment(id: string, ctx: WriteContext): Promise<ReviewComment | null> {
    if (!this.trinoClient) return this.localFallback.resolveComment(id, ctx);
    return tq.resolveReviewComment(this.trinoClient, id, ctx);
  }
  async createCommentAnnotation(input: CreateCommentAnnotationInput, ctx: WriteContext): Promise<CommentAnnotation> {
    if (!this.trinoClient) return this.localFallback.createCommentAnnotation(input, ctx);
    return tq.insertCommentAnnotation(this.trinoClient, input, ctx);
  }
  async listAnnotationsByComment(commentId: string): Promise<CommentAnnotation[]> {
    if (!this.trinoClient) return this.localFallback.listAnnotationsByComment(commentId);
    return tq.queryAnnotationsByComment(this.trinoClient, commentId);
  }

  // Version Comparisons (Phase B)
  async createVersionComparison(input: CreateVersionComparisonInput, ctx: WriteContext): Promise<VersionComparison> {
    if (!this.trinoClient) return this.localFallback.createVersionComparison(input, ctx);
    return tq.insertVersionComparison(this.trinoClient, input, ctx);
  }
  async getVersionComparisonById(id: string): Promise<VersionComparison | null> {
    if (!this.trinoClient) return this.localFallback.getVersionComparisonById(id);
    return tq.queryVersionComparisonById(this.trinoClient, id);
  }
  async listComparisonsByVersion(versionId: string): Promise<VersionComparison[]> {
    if (!this.trinoClient) return this.localFallback.listComparisonsByVersion(versionId);
    return tq.queryComparisonsByVersion(this.trinoClient, versionId);
  }

  // Asset Provenance (Phase C)
  async createProvenance(input: import("../types.js").CreateProvenanceInput, ctx: WriteContext): Promise<AssetProvenance> {
    if (!this.trinoClient) return this.localFallback.createProvenance(input, ctx);
    return tq.insertProvenance(this.trinoClient, input, ctx);
  }
  async getProvenanceByVersion(versionId: string): Promise<AssetProvenance[]> {
    if (!this.trinoClient) return this.localFallback.getProvenanceByVersion(versionId);
    return tq.queryProvenanceByVersion(this.trinoClient, versionId);
  }

  // Version Lineage (Phase C)
  async createLineageEdge(input: import("../types.js").CreateLineageEdgeInput, ctx: WriteContext): Promise<VersionLineage> {
    if (!this.trinoClient) return this.localFallback.createLineageEdge(input, ctx);
    return tq.insertLineageEdge(this.trinoClient, input, ctx);
  }
  async getAncestors(versionId: string, maxDepth?: number): Promise<VersionLineage[]> {
    if (!this.trinoClient) return this.localFallback.getAncestors(versionId, maxDepth);
    return tq.queryAncestors(this.trinoClient, versionId, maxDepth);
  }
  async getDescendants(versionId: string, maxDepth?: number): Promise<VersionLineage[]> {
    if (!this.trinoClient) return this.localFallback.getDescendants(versionId, maxDepth);
    return tq.queryDescendants(this.trinoClient, versionId, maxDepth);
  }
  async getVersionTree(shotId: string): Promise<VersionLineage[]> {
    if (!this.trinoClient) return this.localFallback.getVersionTree(shotId);
    return tq.queryVersionTreeByShot(this.trinoClient, shotId);
  }

  // Dependency Intelligence (Phase C.4)
  async createDependency(input: CreateDependencyInput, ctx: WriteContext): Promise<AssetDependency> {
    if (!this.trinoClient) return this.localFallback.createDependency(input, ctx);
    return tq.insertDependency(this.trinoClient, input, ctx);
  }
  async getDependenciesBySource(entityType: string, entityId: string): Promise<AssetDependency[]> {
    if (!this.trinoClient) return this.localFallback.getDependenciesBySource(entityType, entityId);
    return tq.queryDependenciesBySource(this.trinoClient, entityType, entityId);
  }
  async getDependenciesByTarget(entityType: string, entityId: string): Promise<AssetDependency[]> {
    if (!this.trinoClient) return this.localFallback.getDependenciesByTarget(entityType, entityId);
    return tq.queryDependenciesByTarget(this.trinoClient, entityType, entityId);
  }
  async getReverseDependencies(entityType: string, entityId: string): Promise<AssetDependency[]> {
    if (!this.trinoClient) return this.localFallback.getReverseDependencies(entityType, entityId);
    return tq.queryReverseDependencies(this.trinoClient, entityType, entityId);
  }
  async getDependencyGraphForMaterial(materialId: string): Promise<AssetDependency[]> {
    if (!this.trinoClient) return this.localFallback.getDependencyGraphForMaterial(materialId);
    return tq.queryDependencyGraphForMaterial(this.trinoClient, materialId);
  }

  // Shot Asset Usage (Phase C.4)
  async createShotAssetUsage(input: CreateShotAssetUsageInput, ctx: WriteContext): Promise<ShotAssetUsage> {
    if (!this.trinoClient) return this.localFallback.createShotAssetUsage(input, ctx);
    return tq.insertShotAssetUsage(this.trinoClient, input, ctx);
  }
  async getShotUsage(shotId: string): Promise<ShotAssetUsage[]> {
    if (!this.trinoClient) return this.localFallback.getShotUsage(shotId);
    return tq.queryShotUsage(this.trinoClient, shotId);
  }
  async getVersionUsageAcrossShots(versionId: string): Promise<ShotAssetUsage[]> {
    if (!this.trinoClient) return this.localFallback.getVersionUsageAcrossShots(versionId);
    return tq.queryVersionUsageAcrossShots(this.trinoClient, versionId);
  }

  // Collections (Phase B.6)
  async createCollection(input: CreateCollectionInput, ctx: WriteContext): Promise<Collection> {
    if (!this.trinoClient) return this.localFallback.createCollection(input, ctx);
    return tq.insertCollection(this.trinoClient, input, ctx);
  }
  async getCollectionById(id: string): Promise<Collection | null> {
    if (!this.trinoClient) return this.localFallback.getCollectionById(id);
    return tq.queryCollectionById(this.trinoClient, id);
  }
  async listCollectionsByProject(projectId: string): Promise<Collection[]> {
    if (!this.trinoClient) return this.localFallback.listCollectionsByProject(projectId);
    return tq.queryCollectionsByProject(this.trinoClient, projectId);
  }
  async addCollectionItem(input: AddCollectionItemInput, ctx: WriteContext): Promise<CollectionItem> {
    if (!this.trinoClient) return this.localFallback.addCollectionItem(input, ctx);
    return tq.insertCollectionItem(this.trinoClient, input, ctx);
  }
  async removeCollectionItem(collectionId: string, itemId: string): Promise<boolean> {
    if (!this.trinoClient) return this.localFallback.removeCollectionItem(collectionId, itemId);
    return tq.deleteCollectionItem(this.trinoClient, collectionId, itemId);
  }
  async listCollectionItems(collectionId: string): Promise<CollectionItem[]> {
    if (!this.trinoClient) return this.localFallback.listCollectionItems(collectionId);
    return tq.queryCollectionItems(this.trinoClient, collectionId);
  }

  // Playlists / Dailies (Phase B.7 — local fallback until Trino tables added)
  async createPlaylist(input: CreatePlaylistInput, ctx: WriteContext): Promise<Playlist> {
    return this.localFallback.createPlaylist(input, ctx);
  }
  async getPlaylistById(id: string): Promise<Playlist | null> {
    return this.localFallback.getPlaylistById(id);
  }
  async listPlaylistsByProject(projectId: string): Promise<Playlist[]> {
    return this.localFallback.listPlaylistsByProject(projectId);
  }
  async addPlaylistItem(input: AddPlaylistItemInput, ctx: WriteContext): Promise<PlaylistItem> {
    return this.localFallback.addPlaylistItem(input, ctx);
  }
  async updatePlaylistItemDecision(itemId: string, input: UpdatePlaylistItemDecisionInput, ctx: WriteContext): Promise<PlaylistItem | null> {
    return this.localFallback.updatePlaylistItemDecision(itemId, input, ctx);
  }
  async updatePlaylistItems(playlistId: string, items: Array<{ id: string; sortOrder?: number; notes?: string }>, ctx: WriteContext): Promise<PlaylistItem[]> {
    return this.localFallback.updatePlaylistItems(playlistId, items, ctx);
  }
  async listPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
    return this.localFallback.listPlaylistItems(playlistId);
  }
  async getPlaylistReport(playlistId: string): Promise<DailiesReportEntry[]> {
    return this.localFallback.getPlaylistReport(playlistId);
  }

  // Capacity Planning — Storage Metrics (Phase C.7)
  async createStorageMetric(input: CreateStorageMetricInput, ctx: WriteContext): Promise<StorageMetric> {
    if (!this.trinoClient) return this.localFallback.createStorageMetric(input, ctx);
    return tq.insertStorageMetric(this.trinoClient, input, ctx);
  }
  async getStorageMetricsByEntity(entityType: string, entityId: string): Promise<StorageMetric[]> {
    if (!this.trinoClient) return this.localFallback.getStorageMetricsByEntity(entityType, entityId);
    return tq.queryStorageMetricsByEntity(this.trinoClient, entityType, entityId);
  }
  async getLatestStorageMetric(entityType: string, entityId: string): Promise<StorageMetric | null> {
    if (!this.trinoClient) return this.localFallback.getLatestStorageMetric(entityType, entityId);
    return tq.queryLatestStorageMetric(this.trinoClient, entityType, entityId);
  }
  async getStorageSummaryByProject(projectId: string): Promise<StorageMetric[]> {
    if (!this.trinoClient) return this.localFallback.getStorageSummaryByProject(projectId);
    return tq.queryStorageSummaryByProject(this.trinoClient, projectId);
  }

  // Capacity Planning — Render Farm Metrics (Phase C.7)
  async createRenderFarmMetric(input: CreateRenderFarmMetricInput, ctx: WriteContext): Promise<RenderFarmMetric> {
    if (!this.trinoClient) return this.localFallback.createRenderFarmMetric(input, ctx);
    return tq.insertRenderFarmMetric(this.trinoClient, input, ctx);
  }
  async getRenderMetricsByProject(projectId: string, from?: string, to?: string): Promise<RenderFarmMetric[]> {
    if (!this.trinoClient) return this.localFallback.getRenderMetricsByProject(projectId, from, to);
    return tq.queryRenderMetricsByProject(this.trinoClient, projectId, from, to);
  }
  async getRenderMetricsByShot(shotId: string): Promise<RenderFarmMetric[]> {
    if (!this.trinoClient) return this.localFallback.getRenderMetricsByShot(shotId);
    return tq.queryRenderMetricsByShot(this.trinoClient, shotId);
  }

  // Capacity Planning — Downstream Usage Counts (Phase C.7)
  async upsertDownstreamUsageCount(input: UpsertDownstreamUsageCountInput, ctx: WriteContext): Promise<DownstreamUsageCount> {
    if (!this.trinoClient) return this.localFallback.upsertDownstreamUsageCount(input, ctx);
    return tq.upsertDownstreamUsageCount(this.trinoClient, input, ctx);
  }
  async getDownstreamUsageCount(entityType: string, entityId: string): Promise<DownstreamUsageCount | null> {
    if (!this.trinoClient) return this.localFallback.getDownstreamUsageCount(entityType, entityId);
    return tq.queryDownstreamUsageCount(this.trinoClient, entityType, entityId);
  }

  async getAssetNotes(assetId: string) {
    return this.localFallback.getAssetNotes(assetId);
  }

  async createAssetNote(assetId: string, input: { body: string; createdBy: string; correlationId: string }) {
    return this.localFallback.createAssetNote(assetId, input);
  }

  async archiveAsset(assetId: string, ctx: WriteContext) {
    return this.localFallback.archiveAsset(assetId, ctx);
  }

  async recordRequestAudit(event: Parameters<PersistenceAdapter["recordRequestAudit"]>[0]): Promise<void> {
    return this.localFallback.recordRequestAudit(event);
  }

  // ── Version files (migration 019) — delegated to local fallback for Phase 1 ──
  async createVersionFiles(input: Parameters<PersistenceAdapter["createVersionFiles"]>[0], ctx: WriteContext) {
    return this.localFallback.createVersionFiles(input, ctx);
  }
  async listVersionFiles(versionId: string) {
    return this.localFallback.listVersionFiles(versionId);
  }

  // ── Triggers (migration 020) ──
  async listTriggers(filter?: { enabled?: boolean }) {
    return this.localFallback.listTriggers(filter);
  }
  async getTrigger(id: string) {
    return this.localFallback.getTrigger(id);
  }
  async createTrigger(input: Parameters<PersistenceAdapter["createTrigger"]>[0], ctx: WriteContext) {
    return this.localFallback.createTrigger(input, ctx);
  }
  async updateTrigger(id: string, updates: Parameters<PersistenceAdapter["updateTrigger"]>[1], ctx: WriteContext) {
    return this.localFallback.updateTrigger(id, updates, ctx);
  }
  async deleteTrigger(id: string, ctx: WriteContext) {
    return this.localFallback.deleteTrigger(id, ctx);
  }
  async recordTriggerFire(id: string, ctx: WriteContext) {
    return this.localFallback.recordTriggerFire(id, ctx);
  }

  // ── Webhook endpoints ──
  async listWebhookEndpoints(filter?: { direction?: "inbound" | "outbound"; includeRevoked?: boolean }) {
    return this.localFallback.listWebhookEndpoints(filter);
  }
  async getWebhookEndpoint(id: string) {
    return this.localFallback.getWebhookEndpoint(id);
  }
  async createWebhookEndpoint(input: Parameters<PersistenceAdapter["createWebhookEndpoint"]>[0], ctx: WriteContext) {
    return this.localFallback.createWebhookEndpoint(input, ctx);
  }
  async revokeWebhookEndpoint(id: string, ctx: WriteContext) {
    return this.localFallback.revokeWebhookEndpoint(id, ctx);
  }
  async recordWebhookUsed(id: string, ctx: WriteContext) {
    return this.localFallback.recordWebhookUsed(id, ctx);
  }

  // ── Webhook delivery log ──
  async createWebhookDelivery(input: Parameters<PersistenceAdapter["createWebhookDelivery"]>[0]) {
    return this.localFallback.createWebhookDelivery(input);
  }
  async listWebhookDeliveries(filter?: { webhookId?: string; status?: string; limit?: number }) {
    return this.localFallback.listWebhookDeliveries(filter);
  }

  // ── Workflow engine (migration 021) ──
  async listWorkflowDefinitions(filter?: { enabled?: boolean; includeDeleted?: boolean }) {
    return this.localFallback.listWorkflowDefinitions(filter);
  }
  async getWorkflowDefinition(id: string) {
    return this.localFallback.getWorkflowDefinition(id);
  }
  async getWorkflowDefinitionByName(name: string) {
    return this.localFallback.getWorkflowDefinitionByName(name);
  }
  async createWorkflowDefinition(input: Parameters<PersistenceAdapter["createWorkflowDefinition"]>[0], ctx: WriteContext) {
    return this.localFallback.createWorkflowDefinition(input, ctx);
  }
  async updateWorkflowDefinition(id: string, updates: Parameters<PersistenceAdapter["updateWorkflowDefinition"]>[1], ctx: WriteContext) {
    return this.localFallback.updateWorkflowDefinition(id, updates, ctx);
  }
  async deleteWorkflowDefinition(id: string, ctx: WriteContext) {
    return this.localFallback.deleteWorkflowDefinition(id, ctx);
  }
  async createWorkflowInstance(input: Parameters<PersistenceAdapter["createWorkflowInstance"]>[0], ctx: WriteContext) {
    return this.localFallback.createWorkflowInstance(input, ctx);
  }
  async getWorkflowInstance(id: string) {
    return this.localFallback.getWorkflowInstance(id);
  }
  async listWorkflowInstances(filter?: Parameters<PersistenceAdapter["listWorkflowInstances"]>[0]) {
    return this.localFallback.listWorkflowInstances(filter);
  }
  async updateWorkflowInstance(id: string, updates: Parameters<PersistenceAdapter["updateWorkflowInstance"]>[1], ctx: WriteContext) {
    return this.localFallback.updateWorkflowInstance(id, updates, ctx);
  }
  async recordWorkflowTransition(input: Parameters<PersistenceAdapter["recordWorkflowTransition"]>[0], ctx: WriteContext) {
    return this.localFallback.recordWorkflowTransition(input, ctx);
  }
  async listWorkflowTransitions(instanceId: string) {
    return this.localFallback.listWorkflowTransitions(instanceId);
  }

  // ── DataEngine dispatches (migration 022) ──
  async createDataEngineDispatches(inputs: Parameters<PersistenceAdapter["createDataEngineDispatches"]>[0], ctx: WriteContext) {
    return this.localFallback.createDataEngineDispatches(inputs, ctx);
  }
  async listDataEngineDispatches(filter?: Parameters<PersistenceAdapter["listDataEngineDispatches"]>[0]) {
    return this.localFallback.listDataEngineDispatches(filter);
  }
  async listPendingDispatchesForPolling(now: string, limit?: number) {
    return this.localFallback.listPendingDispatchesForPolling(now, limit);
  }
  async getDataEngineDispatch(id: string) {
    return this.localFallback.getDataEngineDispatch(id);
  }
  async updateDataEngineDispatch(id: string, update: Parameters<PersistenceAdapter["updateDataEngineDispatch"]>[1], ctx: WriteContext) {
    return this.localFallback.updateDataEngineDispatch(id, update, ctx);
  }

  // ── Atomic check-in state ──
  // Delegated to local fallback for now. Trino-backed checkins table
  // (migration 018) is wired when the VAST adapter split lands in Phase 3.
  async createCheckin(input: Parameters<PersistenceAdapter["createCheckin"]>[0], ctx: WriteContext) {
    return this.localFallback.createCheckin(input, ctx);
  }
  async getCheckin(id: string) {
    return this.localFallback.getCheckin(id);
  }
  async updateCheckinState(
    id: string,
    updates: Parameters<PersistenceAdapter["updateCheckinState"]>[1],
    ctx: WriteContext,
  ) {
    return this.localFallback.updateCheckinState(id, updates, ctx);
  }

  // ── S3 compensation log ──
  async createS3CompensationLog(
    input: Parameters<PersistenceAdapter["createS3CompensationLog"]>[0],
    ctx: WriteContext,
  ) {
    return this.localFallback.createS3CompensationLog(input, ctx);
  }
  async listS3CompensationByTxId(txId: string) {
    return this.localFallback.listS3CompensationByTxId(txId);
  }
  async markS3CompensationCommitted(txId: string, ctx: WriteContext) {
    return this.localFallback.markS3CompensationCommitted(txId, ctx);
  }
  async markS3CompensationCompensated(id: string, ctx: WriteContext) {
    return this.localFallback.markS3CompensationCompensated(id, ctx);
  }
  async markS3CompensationFailed(id: string, error: string, ctx: WriteContext) {
    return this.localFallback.markS3CompensationFailed(id, error, ctx);
  }

  // ── Version status update ──
  async updateVersionStatus(versionId: string, status: string, ctx: WriteContext) {
    return this.localFallback.updateVersionStatus(versionId, status, ctx);
  }

  // ── Version sentinel upsert ──
  async upsertVersionSentinel(
    shotId: string,
    context: string,
    sentinelName: string,
    pointsToVersionId: string,
    ctx: WriteContext,
  ) {
    return this.localFallback.upsertVersionSentinel(shotId, context, sentinelName, pointsToVersionId, ctx);
  }

  // ── Custom Fields ──
  // Currently delegated to the local fallback. Trino-backed persistence
  // lands alongside the broader VAST adapter split in Phase 3 of the
  // MAM readiness roadmap (see docs/plans/2026-04-16-mam-readiness-phase1.md).
  async listCustomFieldDefinitions(entityType?: string, includeDeleted = false) {
    return this.localFallback.listCustomFieldDefinitions(entityType, includeDeleted);
  }
  async getCustomFieldDefinition(id: string) {
    return this.localFallback.getCustomFieldDefinition(id);
  }
  async createCustomFieldDefinition(
    input: Parameters<PersistenceAdapter["createCustomFieldDefinition"]>[0],
    ctx: WriteContext,
  ) {
    return this.localFallback.createCustomFieldDefinition(input, ctx);
  }
  async updateCustomFieldDefinition(
    id: string,
    input: Parameters<PersistenceAdapter["updateCustomFieldDefinition"]>[1],
    ctx: WriteContext,
  ) {
    return this.localFallback.updateCustomFieldDefinition(id, input, ctx);
  }
  async softDeleteCustomFieldDefinition(id: string, ctx: WriteContext) {
    return this.localFallback.softDeleteCustomFieldDefinition(id, ctx);
  }
  async getCustomFieldValues(entityType: string, entityId: string) {
    return this.localFallback.getCustomFieldValues(entityType, entityId);
  }
  async setCustomFieldValue(
    input: Parameters<PersistenceAdapter["setCustomFieldValue"]>[0],
    ctx: WriteContext,
  ) {
    return this.localFallback.setCustomFieldValue(input, ctx);
  }
  async deleteCustomFieldValue(
    definitionId: string,
    entityType: string,
    entityId: string,
    ctx: WriteContext,
  ) {
    return this.localFallback.deleteCustomFieldValue(definitionId, entityType, entityId, ctx);
  }
}
