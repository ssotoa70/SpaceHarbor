import { randomUUID } from "node:crypto";

import type { AuditEvent, ClipConformStatus, Episode, LookVariant, Material, MaterialDependency, MaterialVersion, Project, ProjectStatus, ReviewStatus, Sequence, Shot, ShotStatus, Task, TaskStatus, Timeline, TimelineClip, TimelineStatus, Version, VersionApproval, VersionMaterialBinding, VfxMetadata } from "../../domain/models.js";
import type { OutboundNotifier } from "../../integrations/outbound/notifier.js";
import type { OutboundConfig } from "../../integrations/outbound/types.js";
import type { AuditSignal } from "../../domain/models.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import { LocalPersistenceAdapter } from "./local-persistence.js";
import type {
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
  private readonly workflowClient?: Partial<VastWorkflowClient>;
  private readonly trinoClient: TrinoClient | null;

  constructor(
    private readonly config: VastConfig,
    fetchFn?: FetchLike,
    workflowClient?: Partial<VastWorkflowClient>,
    outboundConfig?: OutboundConfig,
    outboundNotifier?: OutboundNotifier
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.workflowClient = workflowClient;
    this.localFallback = new LocalPersistenceAdapter(outboundConfig, outboundNotifier);

    // Initialize Trino client if database URL is configured
    if (this.config.databaseUrl) {
      const url = new URL(this.config.databaseUrl);
      this.trinoClient = new TrinoClient({
        endpoint: `${url.protocol}//${url.host}`,
        accessKey: url.username || process.env.VAST_ACCESS_KEY || "",
        secretKey: url.password || process.env.VAST_SECRET_KEY || ""
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

  createIngestAsset(
    input: Parameters<PersistenceAdapter["createIngestAsset"]>[0],
    context: Parameters<PersistenceAdapter["createIngestAsset"]>[1]
  ) {
    return this.invokeWorkflowClient(
      "createIngestAsset",
      this.workflowClient
        ? () => this.workflowClient!.createIngestAsset!(input, context)
        : undefined,
      () => this.localFallback.createIngestAsset(input, context)
    );
  }

  getAssetById(assetId: Parameters<PersistenceAdapter["getAssetById"]>[0]) {
    return this.localFallback.getAssetById(assetId);
  }

  updateAsset(
    assetId: Parameters<PersistenceAdapter["updateAsset"]>[0],
    updates: Parameters<PersistenceAdapter["updateAsset"]>[1],
    context: Parameters<PersistenceAdapter["updateAsset"]>[2]
  ) {
    return this.localFallback.updateAsset(assetId, updates, context);
  }

  setJobStatus(
    jobId: Parameters<PersistenceAdapter["setJobStatus"]>[0],
    status: Parameters<PersistenceAdapter["setJobStatus"]>[1],
    lastError: Parameters<PersistenceAdapter["setJobStatus"]>[2],
    context: Parameters<PersistenceAdapter["setJobStatus"]>[3]
  ) {
    const existing = this.getJobById(jobId);
    if (existing && !canTransitionWorkflowStatus(existing.status, status)) {
      return null;
    }

    return this.invokeWorkflowClient(
      "setJobStatus",
      this.workflowClient
        ? () => this.workflowClient!.setJobStatus!(jobId, status, lastError, context)
        : undefined,
      () => this.localFallback.setJobStatus(jobId, status, lastError, context)
    );
  }

  updateJobStatus(
    jobId: Parameters<PersistenceAdapter["updateJobStatus"]>[0],
    expectedStatus: Parameters<PersistenceAdapter["updateJobStatus"]>[1],
    newStatus: Parameters<PersistenceAdapter["updateJobStatus"]>[2],
    context: Parameters<PersistenceAdapter["updateJobStatus"]>[3]
  ): boolean {
    return this.localFallback.updateJobStatus(jobId, expectedStatus, newStatus, context);
  }

  getJobById(jobId: Parameters<PersistenceAdapter["getJobById"]>[0]) {
    return this.invokeWorkflowClient(
      "getJobById",
      this.workflowClient?.getJobById
        ? () => this.workflowClient!.getJobById!(jobId)
        : undefined,
      () => this.localFallback.getJobById(jobId)
    );
  }

  getPendingJobs() {
    return this.localFallback.getPendingJobs();
  }

  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.invokeWorkflowClient(
      "claimNextJob",
      this.workflowClient?.claimNextJob
        ? () => this.workflowClient!.claimNextJob!(workerId, leaseSeconds, context)
        : undefined,
      () => this.localFallback.claimNextJob(workerId, leaseSeconds, context)
    );
  }

  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.invokeWorkflowClient(
      "heartbeatJob",
      this.workflowClient
        ? () => this.workflowClient!.heartbeatJob!(jobId, workerId, leaseSeconds, context)
        : undefined,
      () => this.localFallback.heartbeatJob(jobId, workerId, leaseSeconds, context)
    );
  }

  reapStaleLeases(nowIso: string): number {
    return this.localFallback.reapStaleLeases(nowIso);
  }

  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult {
    return this.invokeWorkflowClient(
      "handleJobFailure",
      this.workflowClient
        ? () => this.workflowClient!.handleJobFailure!(jobId, error, context)
        : undefined,
      () => this.localFallback.handleJobFailure(jobId, error, context)
    );
  }

  replayJob(jobId: string, context: WriteContext) {
    return this.invokeWorkflowClient(
      "replayJob",
      this.workflowClient
        ? () => this.workflowClient!.replayJob!(jobId, context)
        : undefined,
      () => this.localFallback.replayJob(jobId, context)
    );
  }

  getDlqItems() {
    return this.localFallback.getDlqItems();
  }

  getOutboxItems() {
    return this.localFallback.getOutboxItems();
  }

  async publishOutbox(context: WriteContext): Promise<number> {
    const outboxItems = this.localFallback.getOutboxItems().filter((item) => !item.publishedAt);
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

  getWorkflowStats(nowIso?: string): WorkflowStats {
    const stats = this.localFallback.getWorkflowStats(nowIso);

    return {
      ...stats,
      degradedMode: {
        fallbackEvents: stats.degradedMode.fallbackEvents + this.fallbackAuditEvents.length
      }
    };
  }

  listAssetQueueRows() {
    return this.localFallback.listAssetQueueRows();
  }

  getAuditEvents() {
    const merged = [...this.fallbackAuditEvents, ...this.localFallback.getAuditEvents()];
    return merged.sort((a, b) => b.at.localeCompare(a.at));
  }

  previewAuditRetention(cutoffIso: string): AuditRetentionPreview {
    return this.invokeWorkflowClient(
      "previewAuditRetention",
      this.workflowClient?.previewAuditRetention
        ? () => this.workflowClient!.previewAuditRetention!(cutoffIso)
        : undefined,
      () => this.localFallback.previewAuditRetention(cutoffIso)
    );
  }

  applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): AuditRetentionApplyResult {
    return this.invokeWorkflowClient(
      "applyAuditRetention",
      this.workflowClient?.applyAuditRetention
        ? () => this.workflowClient!.applyAuditRetention!(cutoffIso, maxDeletePerRun)
        : undefined,
      () => this.localFallback.applyAuditRetention(cutoffIso, maxDeletePerRun)
    );
  }

  getIncidentCoordination() {
    return this.localFallback.getIncidentCoordination();
  }

  updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext) {
    return this.localFallback.updateIncidentGuidedActions(update, context);
  }

  addIncidentNote(input: IncidentNoteInput, context: WriteContext) {
    return this.localFallback.addIncidentNote(input, context);
  }

  updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext) {
    return this.localFallback.updateIncidentHandoff(update, context);
  }

  hasProcessedEvent(eventId: string): boolean {
    return this.invokeWorkflowClient(
      "hasProcessedEvent",
      this.workflowClient?.hasProcessedEvent
        ? () => this.workflowClient!.hasProcessedEvent!(eventId)
        : undefined,
      () => this.localFallback.hasProcessedEvent(eventId)
    );
  }

  markProcessedEvent(eventId: string): void {
    this.invokeWorkflowClient(
      "markProcessedEvent",
      this.workflowClient?.markProcessedEvent
        ? () => this.workflowClient!.markProcessedEvent!(eventId)
        : undefined,
      () => this.localFallback.markProcessedEvent(eventId)
    );
  }

  private invokeWorkflowClient<T>(operation: string, clientCall: (() => T) | undefined, fallbackCall: () => T): T {
    if (!clientCall) {
      return fallbackCall();
    }

    try {
      return clientCall();
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
    return this.localFallback.createProject(input, ctx);
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
    return this.localFallback.createSequence(input, ctx);
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
    return this.localFallback.createShot(input, ctx);
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
    return this.localFallback.updateShotStatus(shotId, status, ctx);
  }

  async createVersion(input: CreateVersionInput, ctx: WriteContext): Promise<Version> {
    return this.localFallback.createVersion(input, ctx);
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
    return this.localFallback.publishVersion(versionId, ctx);
  }

  async updateVersionReviewStatus(versionId: string, status: ReviewStatus, ctx: WriteContext): Promise<Version | null> {
    return this.localFallback.updateVersionReviewStatus(versionId, status, ctx);
  }

  async updateVersionTechnicalMetadata(
    versionId: string,
    meta: Partial<VfxMetadata>,
    ctx: WriteContext
  ): Promise<Version | null> {
    return this.localFallback.updateVersionTechnicalMetadata(versionId, meta, ctx);
  }

  async createVersionApproval(
    input: CreateVersionApprovalInput,
    ctx: WriteContext
  ): Promise<VersionApproval> {
    return this.localFallback.createVersionApproval(input, ctx);
  }

  async listApprovalsByVersion(versionId: string): Promise<VersionApproval[]> {
    if (!this.trinoClient) return this.localFallback.listApprovalsByVersion(versionId);
    return tq.queryApprovalsByVersion(this.trinoClient, versionId);
  }

  // Episodes
  async createEpisode(input: CreateEpisodeInput, ctx: WriteContext): Promise<Episode> {
    return this.localFallback.createEpisode(input, ctx);
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
    return this.localFallback.createTask(input, ctx);
  }

  async getTaskById(id: string): Promise<Task | null> {
    if (!this.trinoClient) return this.localFallback.getTaskById(id);
    return tq.queryTaskById(this.trinoClient, id);
  }

  async listTasksByShot(shotId: string): Promise<Task[]> {
    if (!this.trinoClient) return this.localFallback.listTasksByShot(shotId);
    return tq.queryTasksByShot(this.trinoClient, shotId);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null> {
    return this.localFallback.updateTaskStatus(taskId, status, ctx);
  }

  // Materials
  async createMaterial(input: CreateMaterialInput, ctx: WriteContext): Promise<Material> {
    return this.localFallback.createMaterial(input, ctx);
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
    return this.localFallback.createMaterialVersion(input, ctx);
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
    return this.localFallback.createLookVariant(input, ctx);
  }

  async listLookVariantsByMaterialVersion(materialVersionId: string): Promise<LookVariant[]> {
    if (!this.trinoClient) return this.localFallback.listLookVariantsByMaterialVersion(materialVersionId);
    return tq.queryLookVariantsByMaterialVersion(this.trinoClient, materialVersionId);
  }

  async createVersionMaterialBinding(input: CreateVersionMaterialBindingInput, ctx: WriteContext): Promise<VersionMaterialBinding> {
    return this.localFallback.createVersionMaterialBinding(input, ctx);
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
    return this.localFallback.createMaterialDependency(input, ctx);
  }

  async listDependenciesByMaterialVersion(materialVersionId: string): Promise<MaterialDependency[]> {
    if (!this.trinoClient) return this.localFallback.listDependenciesByMaterialVersion(materialVersionId);
    return tq.queryDependenciesByMaterialVersion(this.trinoClient, materialVersionId);
  }

  async countBindingsForMaterial(materialId: string): Promise<number> {
    if (!this.trinoClient) return this.localFallback.countBindingsForMaterial(materialId);
    return tq.queryCountBindingsForMaterial(this.trinoClient, materialId);
  }

  // Timelines (OTIO) — delegate to local
  async createTimeline(input: import("../types.js").CreateTimelineInput, ctx: import("../types.js").WriteContext): Promise<Timeline> {
    return this.localFallback.createTimeline(input, ctx);
  }
  async getTimelineById(id: string): Promise<Timeline | null> {
    return this.localFallback.getTimelineById(id);
  }
  async listTimelinesByProject(projectId: string): Promise<Timeline[]> {
    return this.localFallback.listTimelinesByProject(projectId);
  }
  async updateTimelineStatus(id: string, status: TimelineStatus, ctx: import("../types.js").WriteContext): Promise<Timeline | null> {
    return this.localFallback.updateTimelineStatus(id, status, ctx);
  }
  async createTimelineClip(input: import("../types.js").CreateTimelineClipInput, ctx: import("../types.js").WriteContext): Promise<TimelineClip> {
    return this.localFallback.createTimelineClip(input, ctx);
  }
  async listClipsByTimeline(timelineId: string): Promise<TimelineClip[]> {
    return this.localFallback.listClipsByTimeline(timelineId);
  }
  async updateClipConformStatus(clipId: string, status: ClipConformStatus, shotId?: string, assetId?: string): Promise<void> {
    return this.localFallback.updateClipConformStatus(clipId, status, shotId, assetId);
  }
}
