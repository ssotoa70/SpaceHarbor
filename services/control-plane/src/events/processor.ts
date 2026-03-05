import type { WorkflowStatus } from "../domain/models.js";
import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";
import { canTransitionWorkflowStatus } from "../workflow/transitions.js";
import type { NormalizedAssetEvent, ProxyGeneratedEvent } from "./types.js";

export function processProxyGeneratedEvent(
  event: ProxyGeneratedEvent,
  persistence: PersistenceAdapter,
  context: WriteContext,
): void {
  const asset = persistence.getAssetById(event.asset_id);
  if (!asset) return;

  persistence.updateAsset(
    event.asset_id,
    {
      metadata: {
        ...(asset.metadata ?? {}),
        thumbnail_url: event.thumbnail_uri,
        proxy_url: event.proxy_uri,
      },
    },
    context,
  );
}

function isReviewContractEvent(eventType: NormalizedAssetEvent["eventType"]): boolean {
  return (
    eventType === "asset.review.annotation_created" ||
    eventType === "asset.review.annotation_resolved" ||
    eventType === "asset.review.task_linked" ||
    eventType === "asset.review.submission_created" ||
    eventType === "asset.review.decision_recorded" ||
    eventType === "asset.review.decision_overridden"
  );
}

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
    case "asset.review.qc_pending":
      return "qc_pending";
    case "asset.review.in_review":
      return "qc_in_review";
    case "asset.review.approved":
      return "qc_approved";
    case "asset.review.rejected":
      return "qc_rejected";
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
  reason?: "NOT_FOUND" | "WORKFLOW_TRANSITION_NOT_ALLOWED";
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
    const existing = persistence.getJobById(event.jobId);
    if (!existing) {
      return {
        accepted: false,
        duplicate: false,
        reason: "NOT_FOUND",
        message: `job not found: ${event.jobId}`
      };
    }

    if (!canTransitionWorkflowStatus(existing.status, "failed")) {
      return {
        accepted: false,
        duplicate: false,
        reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
        message: `transition not allowed: ${existing.status} -> failed`
      };
    }

    if (!options?.enableRetryOnFailure) {
      const updated = persistence.setJobStatus(event.jobId, "failed", event.error ?? null, context);
      if (!updated) {
        return {
          accepted: false,
          duplicate: false,
          reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
          message: `transition not allowed: ${existing.status} -> failed`
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
        reason: "NOT_FOUND",
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

  if (isReviewContractEvent(event.eventType)) {
    const existing = persistence.getJobById(event.jobId);
    if (!existing) {
      return {
        accepted: false,
        duplicate: false,
        reason: "NOT_FOUND",
        message: `job not found: ${event.jobId}`
      };
    }

    persistence.markProcessedEvent(event.eventId);
    return {
      accepted: true,
      duplicate: false,
      status: existing.status
    };
  }

  const status = mapEventToStatus(event.eventType);

  const existing = persistence.getJobById(event.jobId);
  if (!existing) {
    return {
      accepted: false,
      duplicate: false,
      reason: "NOT_FOUND",
      message: `job not found: ${event.jobId}`
    };
  }

  if (!canTransitionWorkflowStatus(existing.status, status)) {
    return {
      accepted: false,
      duplicate: false,
      reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
      message: `transition not allowed: ${existing.status} -> ${status}`
    };
  }

  const updated = persistence.setJobStatus(event.jobId, status, event.error ?? null, context);
  if (!updated) {
    return {
      accepted: false,
      duplicate: false,
      reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
      message: `transition not allowed: ${existing.status} -> ${status}`
    };
  }

  persistence.markProcessedEvent(event.eventId);

  return {
    accepted: true,
    duplicate: false,
    status
  };
}
