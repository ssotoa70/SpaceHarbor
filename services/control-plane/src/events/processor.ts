import type { WorkflowStatus } from "../domain/models.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { NormalizedAssetEvent } from "./types.js";

function mapEventToStatus(eventType: NormalizedAssetEvent["eventType"]): WorkflowStatus {
  switch (eventType) {
    case "asset.processing.started":
      return "processing";
    case "asset.processing.completed":
      return "completed";
    case "asset.processing.failed":
      return "failed";
    case "asset.processing.replay_requested":
      return "needs_replay";
    default:
      return "pending";
  }
}

export function processAssetEvent(persistence: PersistenceAdapter, event: NormalizedAssetEvent): {
  accepted: boolean;
  duplicate: boolean;
  status?: WorkflowStatus;
  message?: string;
} {
  if (persistence.hasProcessedEvent(event.eventId)) {
    return {
      accepted: true,
      duplicate: true
    };
  }

  const status = mapEventToStatus(event.eventType);

  const updated = persistence.setJobStatus(event.jobId, status, event.error ?? null);
  if (!updated) {
    return {
      accepted: false,
      duplicate: false,
      message: `job not found: ${event.jobId}`
    };
  }

  persistence.markProcessedEvent(event.eventId);

  return {
    accepted: true,
    duplicate: false,
    status
  };
}
