import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

const OCCURRED_AT = "2026-02-21T00:00:00.000Z";

function makeCanonicalEvent(input: {
  eventId: string;
  eventType: string;
  correlationId: string;
  producer: string;
  data: Record<string, unknown>;
}) {
  return {
    eventId: input.eventId,
    eventType: input.eventType,
    eventVersion: "1.0",
    occurredAt: OCCURRED_AT,
    correlationId: input.correlationId,
    producer: input.producer,
    data: input.data
  };
}

test("POST /api/v1/events accepts canonical event envelope", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Canonical Event Demo",
      sourceUri: "s3://bucket/canonical-event-demo.mov"
    }
  });

  const ingestBody = ingest.json();
  const eventPayload = makeCanonicalEvent({
    eventId: "evt-canonical-1",
    eventType: "asset.processing.started",
    correlationId: "corr-canonical-1",
    producer: "media-worker",
    data: {
      assetId: ingestBody.asset.id,
      jobId: ingestBody.job.id
    }
  });

  const first = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: eventPayload
  });

  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, false);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: eventPayload
  });

  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);

  const job = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "processing");

  await app.close();
});

test("POST /api/v1/events rejects invalid contract with unified error envelope", async () => {
  const app = buildApp();

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-invalid-1",
      eventType: "asset.processing.started"
    }
  });

  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, "CONTRACT_VALIDATION_ERROR");
  assert.equal(typeof invalid.json().requestId, "string");
  assert.equal(typeof invalid.json().details, "object");

  await app.close();
});

test("POST /api/v1/events rejects out-of-order transition with deterministic error", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Out-of-Order Event Demo",
      sourceUri: "s3://bucket/out-of-order-event-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-order-completed-1",
      eventType: "asset.processing.completed",
      correlationId: "corr-order-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    })
  });

  assert.equal(completed.statusCode, 202);

  const outOfOrder = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-order-failed-1",
      eventType: "asset.processing.failed",
      correlationId: "corr-order-failed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id,
        error: "out-of-order failure"
      }
    })
  });

  assert.equal(outOfOrder.statusCode, 409);
  assert.equal(outOfOrder.json().code, "WORKFLOW_TRANSITION_NOT_ALLOWED");

  await app.close();
});

test("POST /api/v1/events accepts additive review/QC canonical event types", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "QC Canonical Event Demo",
      sourceUri: "s3://bucket/qc-canonical-event-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-v1-qc-completed-1",
      eventType: "asset.processing.completed",
      correlationId: "corr-v1-qc-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    })
  });
  assert.equal(completed.statusCode, 202);

  const qcPending = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-v1-qc-pending-1",
      eventType: "asset.review.qc_pending",
      correlationId: "corr-v1-qc-pending-1",
      producer: "post-qc",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    })
  });
  assert.equal(qcPending.statusCode, 202);

  const job = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "qc_pending");

  await app.close();
});

test("POST /api/v1/events accepts review event canonical envelope variants without mutating status", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Review Event Canonical Variants",
      sourceUri: "s3://bucket/review-event-canonical-variants.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-v1-review-completed-1",
      eventType: "asset.processing.completed",
      correlationId: "corr-v1-review-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    })
  });
  assert.equal(completed.statusCode, 202);

  const baseReviewData = {
    assetId: ingestBody.asset.id,
    jobId: ingestBody.job.id,
    projectId: "proj-001",
    shotId: "shot-001",
    reviewId: "rev-001",
    submissionId: "sub-001",
    versionId: "ver-001",
    actorId: "user-001",
    actorRole: "supervisor"
  };

  const reviewEvents = [
    {
      eventId: "evt-v1-review-annotation-created-1",
      eventType: "asset.review.annotation_created",
      correlationId: "corr-v1-review-annotation-created-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        annotationId: "ann-001",
        content: "Please tighten this transition.",
        anchor: {
          frame: 1024
        }
      }
    },
    {
      eventId: "evt-v1-review-annotation-resolved-1",
      eventType: "asset.review.annotation_resolved",
      correlationId: "corr-v1-review-annotation-resolved-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        annotationId: "ann-001",
        resolvedBy: "user-002",
        resolutionNote: "Addressed in v2"
      }
    },
    {
      eventId: "evt-v1-review-task-linked-1",
      eventType: "asset.review.task_linked",
      correlationId: "corr-v1-review-task-linked-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        annotationId: "ann-002",
        taskId: "task-001",
        taskSystem: "jira"
      }
    },
    {
      eventId: "evt-v1-review-submission-created-1",
      eventType: "asset.review.submission_created",
      correlationId: "corr-v1-review-submission-created-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        submissionStatus: "in_review"
      }
    },
    {
      eventId: "evt-v1-review-decision-recorded-1",
      eventType: "asset.review.decision_recorded",
      correlationId: "corr-v1-review-decision-recorded-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        decision: "changes_requested",
        decisionReasonCode: "TECHNICAL_QUALITY"
      }
    },
    {
      eventId: "evt-v1-review-decision-overridden-1",
      eventType: "asset.review.decision_overridden",
      correlationId: "corr-v1-review-decision-overridden-1",
      producer: "review-service",
      data: {
        ...baseReviewData,
        priorDecisionEventId: "evt-v1-review-decision-recorded-1",
        decision: "approved",
        overrideReasonCode: "SUPERVISOR_OVERRIDE"
      }
    }
  ] as const;

  const jobBeforeReviewEvent = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobBeforeReviewEvent.statusCode, 200);

  const firstReviewResponse = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent(reviewEvents[0])
  });
  const duplicateFirstReviewResponse = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent(reviewEvents[0])
  });

  const jobAfterSingleReviewEvent = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterSingleReviewEvent.statusCode, 200);
  assert.equal(jobAfterSingleReviewEvent.json().status, jobBeforeReviewEvent.json().status);

  const remainingReviewResponses = [];
  for (const reviewEvent of reviewEvents.slice(1)) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: makeCanonicalEvent(reviewEvent)
    });
    remainingReviewResponses.push(response);
  }

  const allReviewResponses = [firstReviewResponse, ...remainingReviewResponses];
  for (const [index, response] of allReviewResponses.entries()) {
    const eventType = reviewEvents[index]?.eventType ?? "unknown";
    assert.equal(response.statusCode, 202, `expected 202 for ${eventType}`);
    assert.equal(response.json().duplicate, false, `expected non-duplicate response for ${eventType}`);
  }

  assert.equal(duplicateFirstReviewResponse.statusCode, 202);
  assert.equal(duplicateFirstReviewResponse.json().duplicate, true);

  const jobAfterAllReviewEvents = await app.inject({
    method: "GET",
    url: `/api/v1/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterAllReviewEvents.statusCode, 200);
  assert.equal(jobAfterAllReviewEvents.json().status, jobBeforeReviewEvent.json().status);

  await app.close();
});

test("POST /api/v1/events rejects decision_recorded without decisionReasonCode", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Review Decision Validation",
      sourceUri: "s3://bucket/review-decision-validation.mov"
    }
  });

  const ingestBody = ingest.json();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: makeCanonicalEvent({
      eventId: "evt-v1-review-decision-missing-reason-1",
      eventType: "asset.review.decision_recorded",
      correlationId: "corr-v1-review-decision-missing-reason-1",
      producer: "coord-ops-console",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id,
        projectId: "proj-001",
        shotId: "shot-001",
        reviewId: "rev-001",
        submissionId: "sub-001",
        versionId: "ver-001",
        actorId: "user-010",
        actorRole: "supervisor",
        decision: "changes_requested"
      }
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "CONTRACT_VALIDATION_ERROR");

  await app.close();
});
