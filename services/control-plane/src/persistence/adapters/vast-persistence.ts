import { LocalPersistenceAdapter } from "./local-persistence.js";
import type { FailureResult, PersistenceAdapter, WriteContext } from "../types.js";

interface VastConfig {
  databaseUrl: string | undefined;
  eventBrokerUrl: string | undefined;
  dataEngineUrl: string | undefined;
}

export class VastPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "vast" as const;

  private readonly localFallback = new LocalPersistenceAdapter();

  constructor(private readonly config: VastConfig) {
    void this.config;
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

  publishOutbox(context: WriteContext) {
    return this.localFallback.publishOutbox(context);
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
