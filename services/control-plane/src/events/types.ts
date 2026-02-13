export type AssetEventType =
  | "asset.processing.started"
  | "asset.processing.completed"
  | "asset.processing.failed"
  | "asset.processing.replay_requested";

export interface LegacyAssetEventEnvelope {
  event_id: string;
  event_type: AssetEventType;
  asset_id: string;
  occurred_at: string;
  producer: string;
  schema_version: string;
  data: {
    job_id: string;
    error?: string;
  };
}

export interface CanonicalAssetEventEnvelope {
  eventId: string;
  eventType: AssetEventType;
  eventVersion: string;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: {
    assetId: string;
    jobId: string;
    error?: string;
  };
}

export interface NormalizedAssetEvent {
  eventId: string;
  eventType: AssetEventType;
  jobId: string;
  error?: string;
}

const EVENT_TYPES: AssetEventType[] = [
  "asset.processing.started",
  "asset.processing.completed",
  "asset.processing.failed",
  "asset.processing.replay_requested"
];

function isAssetEventType(input: string): input is AssetEventType {
  return EVENT_TYPES.includes(input as AssetEventType);
}

export function isLegacyAssetEventEnvelope(input: unknown): input is LegacyAssetEventEnvelope {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Partial<LegacyAssetEventEnvelope>;

  return (
    typeof value.event_id === "string" &&
    typeof value.event_type === "string" &&
    isAssetEventType(value.event_type) &&
    typeof value.asset_id === "string" &&
    typeof value.occurred_at === "string" &&
    typeof value.producer === "string" &&
    typeof value.schema_version === "string" &&
    !!value.data &&
    typeof value.data === "object" &&
    typeof (value.data as { job_id?: string }).job_id === "string"
  );
}

export function isCanonicalAssetEventEnvelope(input: unknown): input is CanonicalAssetEventEnvelope {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Partial<CanonicalAssetEventEnvelope>;

  return (
    typeof value.eventId === "string" &&
    typeof value.eventType === "string" &&
    isAssetEventType(value.eventType) &&
    typeof value.eventVersion === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.correlationId === "string" &&
    typeof value.producer === "string" &&
    !!value.data &&
    typeof value.data === "object" &&
    typeof (value.data as { assetId?: string }).assetId === "string" &&
    typeof (value.data as { jobId?: string }).jobId === "string"
  );
}

export function normalizeLegacyEvent(event: LegacyAssetEventEnvelope): NormalizedAssetEvent {
  return {
    eventId: event.event_id,
    eventType: event.event_type,
    jobId: event.data.job_id,
    error: event.data.error
  };
}

export function normalizeCanonicalEvent(event: CanonicalAssetEventEnvelope): NormalizedAssetEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    jobId: event.data.jobId,
    error: event.data.error
  };
}
