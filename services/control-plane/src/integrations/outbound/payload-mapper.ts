import type { OutboxItem } from "../../domain/models.js";
import type { OutboundPayloadEnvelope, OutboundTarget } from "./types.js";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function mapOutboxItemToOutboundPayload(item: OutboxItem, target: OutboundTarget): OutboundPayloadEnvelope {
  const assetId = asString(item.payload.assetId, "unknown-asset");
  const jobId = asString(item.payload.jobId, "unknown-job");
  const status = asString(item.payload.status, inferStatusFromEventType(item.eventType));
  return {
    eventType: item.eventType,
    occurredAt: item.createdAt,
    correlationId: item.correlationId,
    assetId,
    jobId,
    status,
    summary: `${target}: ${item.eventType} for ${assetId}/${jobId}`,
    schemaVersion: "1.0"
  };
}

function inferStatusFromEventType(eventType: string): string {
  if (eventType.includes("completed")) {
    return "completed";
  }
  if (eventType.includes("failed")) {
    return "failed";
  }
  if (eventType.includes("claimed") || eventType.includes("started")) {
    return "processing";
  }
  return "pending";
}
