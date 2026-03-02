import { LocalPersistenceAdapter } from "./local-persistence.js";
import type { FailureResult, PersistenceAdapter, WorkflowStats, WriteContext } from "../types.js";

interface VastConfig {
  databaseUrl: string | undefined;
  eventBrokerUrl: string | undefined;
  dataEngineUrl: string | undefined;
  strict: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class VastPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "vast" as const;

  private readonly localFallback = new LocalPersistenceAdapter();
  private readonly fetchFn: FetchLike;

  constructor(private readonly config: VastConfig, fetchFn?: FetchLike) {
    this.fetchFn = fetchFn ?? globalThis.fetch;

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
  }

  createIngestAsset(
    input: Parameters<PersistenceAdapter["createIngestAsset"]>[0],
    context: Parameters<PersistenceAdapter["createIngestAsset"]>[1]
  ) {
    return this.localFallback.createIngestAsset(input, context);
  }

  setJobStatus(
    jobId: Parameters<PersistenceAdapter["setJobStatus"]>[0],
    status: Parameters<PersistenceAdapter["setJobStatus"]>[1],
    lastError: Parameters<PersistenceAdapter["setJobStatus"]>[2],
    context: Parameters<PersistenceAdapter["setJobStatus"]>[3]
  ) {
    return this.localFallback.setJobStatus(jobId, status, lastError, context);
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
    return this.localFallback.getJobById(jobId);
  }

  getPendingJobs() {
    return this.localFallback.getPendingJobs();
  }

  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.localFallback.claimNextJob(workerId, leaseSeconds, context);
  }

  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.localFallback.heartbeatJob(jobId, workerId, leaseSeconds, context);
  }

  reapStaleLeases(nowIso: string): number {
    return this.localFallback.reapStaleLeases(nowIso);
  }

  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult {
    return this.localFallback.handleJobFailure(jobId, error, context);
  }

  replayJob(jobId: string, context: WriteContext) {
    return this.localFallback.replayJob(jobId, context);
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
    return this.localFallback.getWorkflowStats(nowIso);
  }

  listAssetQueueRows() {
    return this.localFallback.listAssetQueueRows();
  }

  getAuditEvents() {
    return this.localFallback.getAuditEvents();
  }

  hasProcessedEvent(eventId: string): boolean {
    return this.localFallback.hasProcessedEvent(eventId);
  }

  markProcessedEvent(eventId: string): void {
    this.localFallback.markProcessedEvent(eventId);
  }
}
