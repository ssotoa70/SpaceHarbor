import { LocalPersistenceAdapter } from "./local-persistence.js";
import type { FailureResult, PersistenceAdapter, WorkflowStats, WriteContext } from "../types.js";
import type { VastWorkflowClient } from "../vast/workflow-client.js";

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

  private readonly localFallback = new LocalPersistenceAdapter();
  private readonly fetchFn: FetchLike;
  private readonly workflowClient?: Partial<VastWorkflowClient>;

  constructor(private readonly config: VastConfig, fetchFn?: FetchLike, workflowClient?: Partial<VastWorkflowClient>) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.workflowClient = workflowClient;

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
    const clientResult = this.callWorkflowClient("createIngestAsset", () => this.workflowClient?.createIngestAsset?.(input, context));
    if (clientResult) {
      return clientResult;
    }

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

  getJobById(jobId: Parameters<PersistenceAdapter["getJobById"]>[0]) {
    const clientResult = this.callWorkflowClient("getJobById", () => this.workflowClient?.getJobById?.(jobId));
    if (clientResult) {
      return clientResult;
    }

    return this.localFallback.getJobById(jobId);
  }

  getPendingJobs() {
    return this.localFallback.getPendingJobs();
  }

  claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext) {
    const clientResult = this.callWorkflowClient("claimNextJob", () => this.workflowClient?.claimNextJob?.(workerId, leaseSeconds, context));
    if (clientResult) {
      return clientResult;
    }

    return this.localFallback.claimNextJob(workerId, leaseSeconds, context);
  }

  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext) {
    const clientResult = this.callWorkflowClient("heartbeatJob", () => this.workflowClient?.heartbeatJob?.(jobId, workerId, leaseSeconds, context));
    if (clientResult) {
      return clientResult;
    }

    return this.localFallback.heartbeatJob(jobId, workerId, leaseSeconds, context);
  }

  reapStaleLeases(nowIso: string): number {
    return this.localFallback.reapStaleLeases(nowIso);
  }

  handleJobFailure(jobId: string, error: string, context: WriteContext): FailureResult {
    return this.localFallback.handleJobFailure(jobId, error, context);
  }

  replayJob(jobId: string, context: WriteContext) {
    const clientResult = this.callWorkflowClient("replayJob", () => this.workflowClient?.replayJob?.(jobId, context));
    if (clientResult) {
      return clientResult;
    }

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

  private callWorkflowClient<T>(operation: string, call: () => T | null | undefined): T | null {
    try {
      return call() ?? null;
    } catch (error) {
      if (!this.shouldFallback(error)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`vast workflow client failure (${operation}): ${errorMessage}`);
      }

      return null;
    }
  }

  private shouldFallback(_error: unknown): boolean {
    if (this.config.strict) {
      return false;
    }

    return this.config.fallbackToLocal;
  }
}
