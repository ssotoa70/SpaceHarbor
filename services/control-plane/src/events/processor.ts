import type { WorkflowStatus } from "../domain/models.js";
import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";
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

export function processAssetEvent(
  persistence: PersistenceAdapter,
  event: NormalizedAssetEvent,
  context: WriteContext,
  options?: {
    enableRetryOnFailure?: boolean;
  }
): {
  accepted: boolean;
  duplicate: boolean;
  status?: WorkflowStatus;
  movedToDlq?: boolean;
  retryScheduled?: boolean;
  message?: string;
} {
  if (persistence.hasProcessedEvent(event.eventId)) {
    return {
      accepted: true,
      duplicate: true
    };
  }

  if (event.eventType === "asset.processing.failed") {
    if (!options?.enableRetryOnFailure) {
      const updated = persistence.setJobStatus(event.jobId, "failed", event.error ?? null, context);
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
        status: "failed"
      };
    }

    const failedResult = persistence.handleJobFailure(event.jobId, event.error ?? "unknown processing error", context);
    if (!failedResult.accepted) {
      return {
        accepted: false,
        duplicate: false,
        message: failedResult.message ?? `job not found: ${event.jobId}`
      };
    }

    persistence.markProcessedEvent(event.eventId);
    return {
      accepted: true,
      duplicate: false,
      status: failedResult.status,
      movedToDlq: failedResult.movedToDlq,
      retryScheduled: failedResult.retryScheduled
    };
  }

  const status = mapEventToStatus(event.eventType);

  const updated = persistence.setJobStatus(event.jobId, status, event.error ?? null, context);
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
