import { LocalPersistenceAdapter } from "./local-persistence.js";
import type { PersistenceAdapter } from "../types.js";

interface VastConfig {
  databaseUrl: string | undefined;
  eventBrokerUrl: string | undefined;
  dataEngineUrl: string | undefined;
}

export class VastPersistenceAdapter implements PersistenceAdapter {
  readonly backend = "vast" as const;

  private readonly localFallback = new LocalPersistenceAdapter();

  constructor(private readonly config: VastConfig) {}

  reset(): void {
    this.localFallback.reset();
  }

  createIngestAsset(input: Parameters<PersistenceAdapter["createIngestAsset"]>[0]) {
    return this.localFallback.createIngestAsset(input);
  }

  setJobStatus(
    jobId: Parameters<PersistenceAdapter["setJobStatus"]>[0],
    status: Parameters<PersistenceAdapter["setJobStatus"]>[1],
    lastError: Parameters<PersistenceAdapter["setJobStatus"]>[2]
  ) {
    return this.localFallback.setJobStatus(jobId, status, lastError);
  }

  getJobById(jobId: Parameters<PersistenceAdapter["getJobById"]>[0]) {
    return this.localFallback.getJobById(jobId);
  }

  getPendingJobs() {
    return this.localFallback.getPendingJobs();
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
