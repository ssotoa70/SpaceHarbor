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
- `asset.processing.failed` -> job status `failed`
- `asset.processing.replay_requested` -> job status `needs_replay`

## Reliability Rules

- `eventId` is the idempotency key.
- Duplicate `eventId` values are accepted and treated as no-op.
- Unknown jobs return `404` with `code: NOT_FOUND`.
- Invalid envelopes return `400` with `code: CONTRACT_VALIDATION_ERROR`.

## Compatibility

Legacy snake_case envelope remains accepted on `POST /events` for internal migration compatibility.
