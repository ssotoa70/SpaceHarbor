import { randomUUID } from "node:crypto";

import type {
  Asset,
  AssetQueueRow,
  AuditEvent,
  IngestResult,
  WorkflowJob,
  WorkflowStatus
} from "../../domain/models.js";
import type { IngestInput, PersistenceAdapter } from "../types.js";

export class LocalPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "local" as const;

  private readonly assets = new Map<string, Asset>();
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly processedEventIds = new Set<string>();

  reset(): void {
    this.assets.clear();
    this.jobs.clear();
    this.auditEvents.length = 0;
    this.processedEventIds.clear();
  }

  createIngestAsset(input: IngestInput): IngestResult {
    const now = new Date().toISOString();
    const asset: Asset = {
      id: randomUUID(),
      title: input.title,
      sourceUri: input.sourceUri,
      createdAt: now
    };

    const job: WorkflowJob = {
      id: randomUUID(),
      assetId: asset.id,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      lastError: null
    };

    this.assets.set(asset.id, asset);
    this.jobs.set(job.id, job);
    this.recordAudit(`asset registered: ${asset.title}`);

    return { asset, job };
  }

  setJobStatus(jobId: string, status: WorkflowStatus, lastError: string | null = null): WorkflowJob | null {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return null;
    }

    const updated: WorkflowJob = {
      ...existing,
      status,
      lastError,
      updatedAt: new Date().toISOString()
    };

    this.jobs.set(jobId, updated);
    this.recordAudit(`job ${jobId} moved to ${status}`);
    return updated;
  }

  getJobById(jobId: string): WorkflowJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  getPendingJobs(): WorkflowJob[] {
    return [...this.jobs.values()].filter((job) => job.status === "pending");
  }

  listAssetQueueRows(): AssetQueueRow[] {
    const latestJobByAssetId = new Map<string, WorkflowJob>();
    for (const job of this.jobs.values()) {
      latestJobByAssetId.set(job.assetId, job);
    }

    return [...this.assets.values()].map((asset) => ({
      id: asset.id,
      title: asset.title,
      sourceUri: asset.sourceUri,
      status: latestJobByAssetId.get(asset.id)?.status ?? "pending"
    }));
  }

  getAuditEvents(): AuditEvent[] {
    return [...this.auditEvents];
  }

  hasProcessedEvent(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  markProcessedEvent(eventId: string): void {
    this.processedEventIds.add(eventId);
  }

  private recordAudit(message: string): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      message,
      at: new Date().toISOString()
    };
    this.auditEvents.unshift(event);
    return event;
  }
}
