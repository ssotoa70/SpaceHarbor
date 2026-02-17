import { randomUUID } from "node:crypto";

import type { AuditEvent } from "../../domain/models.js";
import { canTransitionWorkflowStatus } from "../../workflow/transitions.js";
import { LocalPersistenceAdapter } from "./local-persistence.js";
import type {
  FailureResult,
  IncidentGuidedActionsUpdate,
  IncidentHandoffUpdate,
  IncidentNoteInput,
  PersistenceAdapter,
  WorkflowStats,
  WriteContext
} from "../types.js";
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
  private readonly fallbackAuditEvents: AuditEvent[] = [];
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
    this.fallbackAuditEvents.length = 0;
  }

  createIngestAsset(
    input: Parameters<PersistenceAdapter["createIngestAsset"]>[0],
    context: Parameters<PersistenceAdapter["createIngestAsset"]>[1]
  ) {
    return this.invokeWorkflowClient(
      "createIngestAsset",
      this.workflowClient?.createIngestAsset
        ? () => this.workflowClient!.createIngestAsset(input, context)
        : undefined,
      () => this.localFallback.createIngestAsset(input, context)
    );
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
      this.workflowClient?.setJobStatus
        ? () => this.workflowClient!.setJobStatus(jobId, status, lastError, context)
        : undefined,
      () => this.localFallback.setJobStatus(jobId, status, lastError, context)
    );
  }

  getJobById(jobId: Parameters<PersistenceAdapter["getJobById"]>[0]) {
    return this.invokeWorkflowClient(
      "getJobById",
      this.workflowClient?.getJobById
        ? () => this.workflowClient!.getJobById(jobId)
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
        ? () => this.workflowClient!.claimNextJob(workerId, leaseSeconds, context)
        : undefined,
      () => this.localFallback.claimNextJob(workerId, leaseSeconds, context)
    );
  }

  heartbeatJob(jobId: string, workerId: string, leaseSeconds: number, context: WriteContext) {
    return this.invokeWorkflowClient(
      "heartbeatJob",
      this.workflowClient?.heartbeatJob
        ? () => this.workflowClient!.heartbeatJob(jobId, workerId, leaseSeconds, context)
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
      this.workflowClient?.handleJobFailure
        ? () => this.workflowClient!.handleJobFailure(jobId, error, context)
        : undefined,
      () => this.localFallback.handleJobFailure(jobId, error, context)
    );
  }

  replayJob(jobId: string, context: WriteContext) {
    return this.invokeWorkflowClient(
      "replayJob",
      this.workflowClient?.replayJob
        ? () => this.workflowClient!.replayJob(jobId, context)
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
        ? () => this.workflowClient!.hasProcessedEvent(eventId)
        : undefined,
      () => this.localFallback.hasProcessedEvent(eventId)
    );
  }

  markProcessedEvent(eventId: string): void {
    this.invokeWorkflowClient(
      "markProcessedEvent",
      this.workflowClient?.markProcessedEvent
        ? () => this.workflowClient!.markProcessedEvent(eventId)
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
    this.fallbackAuditEvents.unshift({
      id: randomUUID(),
      message: `[corr:system] vast fallback (${operation}) due to client error: ${errorMessage}`,
      at: new Date().toISOString()
    });
  }

  private shouldFallback(_error: unknown): boolean {
    if (this.config.strict) {
      return false;
    }

    return this.config.fallbackToLocal;
  }
}
