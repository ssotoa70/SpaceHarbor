# Event Contracts

SpaceHarbor accepts canonical workflow events on `POST /api/v1/events`.

## Envelope

```json
{
  "eventId": "evt-123",
  "eventType": "asset.processing.started",
  "eventVersion": "1.0",
  "occurredAt": "2026-02-12T00:00:00.000Z",
  "correlationId": "corr-123",
  "producer": "media-worker",
  "data": {
    "assetId": "asset-uuid",
    "jobId": "job-uuid",
    "error": "optional"
  }
}
```

## Supported Event Types

- `asset.processing.started` -> job status `processing`
- `asset.processing.completed` -> job status `completed`
- `asset.processing.failed` -> retry scheduling while attempts remain, then `failed` + DLQ
- `asset.processing.replay_requested` -> job status `needs_replay`
- `asset.review.qc_pending` -> job status `qc_pending`
- `asset.review.in_review` -> job status `qc_in_review`
- `asset.review.approved` -> job status `qc_approved`
- `asset.review.rejected` -> job status `qc_rejected`

Additive review annotation/approval contract events (accepted on the same v1 endpoint):

- `asset.review.annotation_created`
- `asset.review.annotation_resolved`
- `asset.review.task_linked`
- `asset.review.submission_created`
- `asset.review.decision_recorded`
- `asset.review.decision_overridden`

The six review annotation/approval events are additive contract events and do not mutate job workflow status.

## Review Event Data Fields

Common required `data` fields for review annotation/approval events:

- `assetId`, `jobId`
- `projectId`, `shotId`, `reviewId`, `submissionId`, `versionId`
- `actorId`
- `actorRole` (`artist` | `coordinator` | `supervisor` | `producer`)

Event-specific required fields:

- `asset.review.annotation_created`: `annotationId`, `content`, `anchor`
- `asset.review.annotation_resolved`: `annotationId`, `resolvedBy`
- `asset.review.task_linked`: `annotationId`, `taskId`, `taskSystem`
- `asset.review.submission_created`: `submissionStatus`
- `asset.review.decision_recorded`: `decision`, `decisionReasonCode`
- `asset.review.decision_overridden`: `priorDecisionEventId`, `decision`, `overrideReasonCode`

Decision enum values:

- `approved`
- `changes_requested`
- `rejected`

## Review Event Examples

`asset.review.annotation_created`:

```json
{
  "eventId": "evt-review-annotation-created-1",
  "eventType": "asset.review.annotation_created",
  "eventVersion": "1.0",
  "occurredAt": "2026-02-21T00:00:00.000Z",
  "correlationId": "corr-review-annotation-created-1",
  "producer": "rv-review-web",
  "data": {
    "assetId": "asset-uuid",
    "jobId": "job-uuid",
    "projectId": "proj-001",
    "shotId": "shot-001",
    "reviewId": "rev-001",
    "submissionId": "sub-001",
    "versionId": "ver-001",
    "actorId": "user-001",
    "actorRole": "supervisor",
    "annotationId": "ann-001",
    "content": "Tighten this transition",
    "anchor": {
      "frame": 1024
    }
  }
}
```

`asset.review.decision_recorded`:

```json
{
  "eventId": "evt-review-decision-recorded-1",
  "eventType": "asset.review.decision_recorded",
  "eventVersion": "1.0",
  "occurredAt": "2026-02-21T00:00:00.000Z",
  "correlationId": "corr-review-decision-recorded-1",
  "producer": "coord-ops-console",
  "data": {
    "assetId": "asset-uuid",
    "jobId": "job-uuid",
    "projectId": "proj-001",
    "shotId": "shot-001",
    "reviewId": "rev-001",
    "submissionId": "sub-001",
    "versionId": "ver-001",
    "actorId": "user-010",
    "actorRole": "supervisor",
    "decision": "changes_requested",
    "decisionReasonCode": "TECHNICAL_QUALITY"
  }
}
```

## Reliability Rules

- `eventId` is the idempotency key.
- Duplicate `eventId` values are accepted and treated as no-op.
- Unknown jobs return `404` with `code: NOT_FOUND`.
- Out-of-order workflow transitions are rejected with `409` and `code: WORKFLOW_TRANSITION_NOT_ALLOWED`.
- Invalid envelopes return `400` with `code: CONTRACT_VALIDATION_ERROR`.

## Retry and DLQ behavior

- Jobs retry with exponential backoff while `attemptCount < maxAttempts`.
- When retries are exhausted, job moves to DLQ and status becomes `failed`.
- Replay uses `POST /api/v1/jobs/:id/replay` to requeue the job.
- Replay returns deterministic guardrail errors:
  - `403` with `REPLAY_DISABLED` when replay is disabled.
  - `409` with `REPLAY_NOT_ALLOWED` when job status is not replayable.
  - `429` with `RATE_LIMITED` when replay request rate exceeds the configured limit.

## Timeline Events

### `timeline.cut_change`

Emitted when a re-ingested timeline (same `projectId` + `name`) has clip differences compared to the previous version.

```json
{
  "type": "timeline.cut_change",
  "timelineId": "new-timeline-uuid",
  "previousTimelineId": "old-timeline-uuid",
  "projectId": "proj-uuid",
  "name": "SEQ010_edit_v2",
  "changeCount": 3,
  "affectedShots": ["SH020", "SH030", "SH040"],
  "changes": [
    {
      "clipName": "SH020",
      "sourceUri": "s3://renders/SH020.exr",
      "changeType": "modified",
      "previousInFrame": 48,
      "previousOutFrame": 120,
      "newInFrame": 48,
      "newOutFrame": 130
    },
    {
      "clipName": "SH030",
      "sourceUri": "s3://renders/SH030.exr",
      "changeType": "removed",
      "previousInFrame": 120,
      "previousOutFrame": 200
    },
    {
      "clipName": "SH040",
      "sourceUri": "s3://renders/SH040.exr",
      "changeType": "added",
      "newInFrame": 130,
      "newOutFrame": 210
    }
  ]
}
```

Change types: `added` (new clip), `removed` (clip deleted), `modified` (in/out frames changed).

## Compatibility

Legacy snake_case envelope remains accepted on `POST /events` for internal migration compatibility.
