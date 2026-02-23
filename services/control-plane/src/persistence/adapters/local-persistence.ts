import { randomUUID } from "node:crypto";

import type {
  AnnotationHookMetadata,
  Asset,
  ProductionMetadata,
  AuditSignal,
  AssetQueueRow,
  AuditEvent,
  DlqItem,
  IncidentCoordination,
  IncidentGuidedActions,
  IncidentHandoff,
  IncidentNote,
  IngestResult,
  OutboxItem,
  WorkflowJob,
  WorkflowStatus
} from "../../domain/models.js";
import { mapOutboxItemToOutboundPayload } from "../../integrations/outbound/payload-mapper.js";
import type { OutboundNotifier } from "../../integrations/outbound/notifier.js";
import type { OutboundConfig, OutboundTarget } from "../../integrations/outbound/types.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import type {
  AuditRetentionApplyResult,
  AuditRetentionPreview,
  FailureResult,
  IncidentGuidedActionsUpdate,
  IncidentHandoffUpdate,
  IncidentNoteInput,
  IngestInput,
  PersistenceAdapter,
  WorkflowStats,
  WriteContext
} from "../types.js";

interface QueueEntry {
  jobId: string;
  assetId: string;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

const DEFAULT_MAX_ATTEMPTS = 3;

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
  private readonly processedEventIds = new Set<string>();
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
    this.outboundCounters.attempts = 0;
    this.outboundCounters.success = 0;
    this.outboundCounters.failure = 0;
    this.outboundCounters.byTarget.slack = { attempts: 0, success: 0, failure: 0 };
    this.outboundCounters.byTarget.teams = { attempts: 0, success: 0, failure: 0 };
    this.outboundCounters.byTarget.production = { attempts: 0, success: 0, failure: 0 };
  }

  createIngestAsset(input: IngestInput, context: WriteContext): IngestResult {
    const now = this.resolveNow(context);
    const asset: Asset = {
      id: randomUUID(),
      title: input.title,
      sourceUri: input.sourceUri,
      createdAt: now.toISOString()
    };

    const job: WorkflowJob = {
      id: randomUUID(),
      assetId: asset.id,
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

  setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null | undefined,
    context: WriteContext
  ): WorkflowJob | null {
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

  getJobById(jobId: string): WorkflowJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  getPendingJobs(): WorkflowJob[] {
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

  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null {
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

  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null {
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

  reapStaleLeases(nowIso: string): number {
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

  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult {
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

  replayJob(jobId: string, context: WriteContext): WorkflowJob | null {
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

  getDlqItems(): DlqItem[] {
    return [...this.dlq.values()].sort((a, b) => b.failedAt.localeCompare(a.failedAt));
  }

  getOutboxItems(): OutboxItem[] {
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

  getWorkflowStats(nowIso = new Date().toISOString()): WorkflowStats {
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

  listAssetQueueRows(): AssetQueueRow[] {
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

  getAuditEvents(): AuditEvent[] {
    return [...this.auditEvents];
  }

  previewAuditRetention(cutoffIso: string): AuditRetentionPreview {
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

  applyAuditRetention(cutoffIso: string, maxDeletePerRun?: number): AuditRetentionApplyResult {
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

  getIncidentCoordination(): IncidentCoordination {
    return {
      guidedActions: { ...this.incidentGuidedActions },
      handoff: { ...this.incidentHandoff },
      notes: [...this.incidentNotes]
    };
  }

  updateIncidentGuidedActions(update: IncidentGuidedActionsUpdate, context: WriteContext): IncidentGuidedActions {
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

  addIncidentNote(input: IncidentNoteInput, context: WriteContext): IncidentNote {
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

  updateIncidentHandoff(update: IncidentHandoffUpdate, context: WriteContext): IncidentHandoff {
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

  hasProcessedEvent(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  markProcessedEvent(eventId: string): void {
    this.processedEventIds.add(eventId);
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
    this.outbox.unshift({
      id: randomUUID(),
      eventType,
      correlationId,
      payload,
      createdAt: now.toISOString(),
      publishedAt: null
    });
  }

  private recordAudit(message: string, correlationId: string, now: Date, signal?: AuditSignal): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      message: `[corr:${correlationId}] ${message}`,
      at: now.toISOString(),
      ...(signal ? { signal } : {})
    };
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
}
