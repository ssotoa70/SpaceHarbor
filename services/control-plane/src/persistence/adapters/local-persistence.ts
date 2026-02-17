import { randomUUID } from "node:crypto";

import type {
  Asset,
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
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import type {
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

export class LocalPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "local" as const;

  private readonly assets = new Map<string, Asset>();
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly queue = new Map<string, QueueEntry>();
  private readonly dlq = new Map<string, DlqItem>();
  private readonly outbox: OutboxItem[] = [];
  private readonly auditEvents: AuditEvent[] = [];
  private incidentGuidedActions: IncidentGuidedActions = { ...DEFAULT_INCIDENT_GUIDED_ACTIONS };
  private incidentHandoff: IncidentHandoff = { ...DEFAULT_INCIDENT_HANDOFF };
  private readonly incidentNotes: IncidentNote[] = [];
  private readonly processedEventIds = new Set<string>();

  reset(): void {
    this.assets.clear();
    this.jobs.clear();
    this.queue.clear();
    this.dlq.clear();
    this.outbox.length = 0;
    this.auditEvents.length = 0;
    this.incidentGuidedActions = { ...DEFAULT_INCIDENT_GUIDED_ACTIONS };
    this.incidentHandoff = { ...DEFAULT_INCIDENT_HANDOFF };
    this.incidentNotes.length = 0;
    this.processedEventIds.clear();
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
      leaseExpiresAt: null
    };

    this.assets.set(asset.id, asset);
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
      }
    };
  }

  listAssetQueueRows(): AssetQueueRow[] {
    const latestJobByAssetId = new Map<string, WorkflowJob>();
    for (const job of this.jobs.values()) {
      latestJobByAssetId.set(job.assetId, job);
    }

    return [...this.assets.values()].map((asset) => ({
      id: asset.id,
      jobId: latestJobByAssetId.get(asset.id)?.id ?? null,
      title: asset.title,
      sourceUri: asset.sourceUri,
      status: latestJobByAssetId.get(asset.id)?.status ?? "pending"
    }));
  }

  getAuditEvents(): AuditEvent[] {
    return [...this.auditEvents];
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

  private recordAudit(message: string, correlationId: string, now: Date): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      message: `[corr:${correlationId}] ${message}`,
      at: now.toISOString()
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
}
