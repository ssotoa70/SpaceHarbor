# Event Contracts

AssetHarbor accepts canonical workflow events on `POST /api/v1/events`.

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

## Compatibility

Legacy snake_case envelope remains accepted on `POST /events` for internal migration compatibility.
