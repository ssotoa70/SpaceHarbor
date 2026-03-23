export type LegacyAssetEventType =
  | "asset.processing.started"
  | "asset.processing.completed"
  | "asset.processing.failed"
  | "asset.processing.replay_requested"
  | "asset.review.qc_pending"
  | "asset.review.in_review"
  | "asset.review.approved"
  | "asset.review.rejected";

export type AssetEventType =
  | LegacyAssetEventType
  | "asset.review.annotation_created"
  | "asset.review.annotation_resolved"
  | "asset.review.task_linked"
  | "asset.review.submission_created"
  | "asset.review.decision_recorded"
  | "asset.review.decision_overridden";

export interface LegacyAssetEventEnvelope {
  event_id: string;
  event_type: LegacyAssetEventType;
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
    projectId?: string;
    shotId?: string;
    reviewId?: string;
    submissionId?: string;
    versionId?: string;
    actorId?: string;
    actorRole?: "artist" | "coordinator" | "supervisor" | "producer";
    annotationId?: string;
    content?: string;
    anchor?: {
      frame?: number;
      timecode?: string;
      [key: string]: unknown;
    };
    resolvedBy?: string;
    resolutionNote?: string;
    taskId?: string;
    taskSystem?: string;
    submissionStatus?: string;
    decision?: "approved" | "changes_requested" | "rejected";
    decisionReasonCode?: string;
    /** Plain-text rejection reason provided by the reviewer */
    rejectionReason?: string;
    /** Identity of the user who performed the rejection */
    rejectedBy?: string;
    /** Frame comments associated with the rejection */
    comments?: Array<{
      id: string;
      body: string;
      frameNumber: number | null;
      timecode: string | null;
      authorId: string;
    }>;
    priorDecisionEventId?: string;
    overrideReasonCode?: string;
  };
}

export interface NormalizedAssetEvent {
  eventId: string;
  eventType: AssetEventType;
  jobId: string;
  error?: string;
}

const LEGACY_EVENT_TYPES: LegacyAssetEventType[] = [
  "asset.processing.started",
  "asset.processing.completed",
  "asset.processing.failed",
  "asset.processing.replay_requested",
  "asset.review.qc_pending",
  "asset.review.in_review",
  "asset.review.approved",
  "asset.review.rejected"
];

const EVENT_TYPES: AssetEventType[] = [
  ...LEGACY_EVENT_TYPES,
  "asset.review.annotation_created",
  "asset.review.annotation_resolved",
  "asset.review.task_linked",
  "asset.review.submission_created",
  "asset.review.decision_recorded",
  "asset.review.decision_overridden"
];

function isLegacyAssetEventType(input: string): input is LegacyAssetEventType {
  return LEGACY_EVENT_TYPES.includes(input as LegacyAssetEventType);
}

function isAssetEventType(input: string): input is AssetEventType {
  return EVENT_TYPES.includes(input as AssetEventType);
}

function hasReviewCommonFields(data: CanonicalAssetEventEnvelope["data"]): boolean {
  return (
    typeof data.projectId === "string" &&
    typeof data.shotId === "string" &&
    typeof data.reviewId === "string" &&
    typeof data.submissionId === "string" &&
    typeof data.versionId === "string" &&
    typeof data.actorId === "string" &&
    (data.actorRole === "artist" ||
      data.actorRole === "coordinator" ||
      data.actorRole === "supervisor" ||
      data.actorRole === "producer")
  );
}

function hasReviewContractData(eventType: AssetEventType, data: CanonicalAssetEventEnvelope["data"]): boolean {
  switch (eventType) {
    case "asset.review.annotation_created":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return (
        typeof data.annotationId === "string" &&
        typeof data.content === "string" &&
        !!data.anchor &&
        typeof data.anchor === "object"
      );
    case "asset.review.annotation_resolved":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return typeof data.annotationId === "string" && typeof data.resolvedBy === "string";
    case "asset.review.task_linked":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return (
        typeof data.annotationId === "string" &&
        typeof data.taskId === "string" &&
        typeof data.taskSystem === "string"
      );
    case "asset.review.submission_created":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return typeof data.submissionStatus === "string";
    case "asset.review.decision_recorded":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return (
        (data.decision === "approved" || data.decision === "changes_requested" || data.decision === "rejected") &&
        typeof data.decisionReasonCode === "string"
      );
    case "asset.review.decision_overridden":
      if (!hasReviewCommonFields(data)) {
        return false;
      }
      return (
        typeof data.priorDecisionEventId === "string" &&
        (data.decision === "approved" || data.decision === "changes_requested" || data.decision === "rejected") &&
        typeof data.overrideReasonCode === "string"
      );
    default:
      return true;
  }
}

export function isLegacyAssetEventEnvelope(input: unknown): input is LegacyAssetEventEnvelope {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Partial<LegacyAssetEventEnvelope>;

  return (
    typeof value.event_id === "string" &&
    typeof value.event_type === "string" &&
    isLegacyAssetEventType(value.event_type) &&
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

  const hasBaseFields =
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
    typeof (value.data as { jobId?: string }).jobId === "string";

  if (!hasBaseFields) {
    return false;
  }

  return value.data ? hasReviewContractData(value.eventType as AssetEventType, value.data) : false;
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

// ---------------------------------------------------------------------------
// OIIO Proxy Generator CloudEvent — published by oiio-proxy-generator container
// ---------------------------------------------------------------------------

export interface ProxyGeneratedEvent {
  type: "proxy.generated";
  asset_id: string;
  thumbnail_uri: string;
  proxy_uri: string;
  timestamp: string;
}

export function isProxyGeneratedEvent(input: unknown): input is ProxyGeneratedEvent {
  if (!input || typeof input !== "object") return false;
  const v = input as Record<string, unknown>;
  return (
    v["type"] === "proxy.generated" &&
    typeof v["asset_id"] === "string" &&
    typeof v["thumbnail_uri"] === "string" &&
    typeof v["proxy_uri"] === "string"
  );
}

// ---------------------------------------------------------------------------
// VAST DataEngine CloudEvent — published by VAST Event Broker on pipeline completion
// ---------------------------------------------------------------------------

export interface VastDataEngineCompletionEvent {
  specversion: "1.0";
  type: "vast.dataengine.pipeline.completed";
  source: string;
  id: string;
  time: string;
  data: {
    asset_id: string;
    job_id: string;
    function_id: string;
    success: boolean;
    metadata?: Record<string, unknown>;
    error?: string;
  };
}

export interface NormalizedVastEvent extends NormalizedAssetEvent {
  metadata?: Record<string, unknown>;
}

export function isVastDataEngineCompletionEvent(
  input: unknown,
): input is VastDataEngineCompletionEvent {
  if (!input || typeof input !== "object") return false;
  const v = input as Record<string, unknown>;
  if (v["type"] !== "vast.dataengine.pipeline.completed") return false;
  if (typeof v["id"] !== "string") return false;
  const data = v["data"] as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return false;
  return (
    typeof data["asset_id"] === "string" &&
    typeof data["job_id"] === "string" &&
    typeof data["function_id"] === "string" &&
    typeof data["success"] === "boolean"
  );
}

export function normalizeVastDataEngineEvent(
  event: VastDataEngineCompletionEvent,
): NormalizedVastEvent {
  return {
    eventId: event.id,
    eventType: event.data.success
      ? "asset.processing.completed"
      : "asset.processing.failed",
    jobId: event.data.job_id,
    error: event.data.error,
    metadata: event.data.metadata,
  };
}
