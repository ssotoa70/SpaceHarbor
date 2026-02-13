# API Contracts

## Health

- `GET /health`
- `200 OK`

```json
{
  "status": "ok",
  "service": "control-plane"
}
```

## Ingest

- `POST /api/v1/assets/ingest`

```json
{
  "title": "Launch Teaser",
  "sourceUri": "s3://bucket/launch-teaser.mov"
}
```

- `201 Created`

```json
{
  "asset": {
    "id": "uuid",
    "title": "Launch Teaser",
    "sourceUri": "s3://bucket/launch-teaser.mov",
    "createdAt": "2026-02-12T00:00:00.000Z"
  },
  "job": {
    "id": "uuid",
    "assetId": "uuid",
    "status": "pending",
    "createdAt": "2026-02-12T00:00:00.000Z",
    "updatedAt": "2026-02-12T00:00:00.000Z",
    "lastError": null,
    "attemptCount": 0,
    "maxAttempts": 3,
    "nextAttemptAt": "2026-02-12T00:00:00.000Z",
    "leaseOwner": null,
    "leaseExpiresAt": null
  }
}
```

## Queue and Jobs

- `GET /api/v1/assets` returns queue rows with current status.
- `GET /api/v1/jobs/pending` returns pending jobs for worker polling.
- `GET /api/v1/jobs/:id` returns full workflow job state.
- `POST /api/v1/queue/claim` claims a pending job and sets processing lease.
- `POST /api/v1/jobs/:id/heartbeat` extends an active worker lease.
- `POST /api/v1/queue/reap-stale` requeues processing jobs with expired leases.
- `POST /api/v1/jobs/:id/replay` moves failed/DLQ job back to pending queue.
- `GET /api/v1/dlq` lists dead-lettered jobs.

## Outbox

- `GET /api/v1/outbox` lists outbox events.
- `POST /api/v1/outbox/publish` marks unpublished outbox items as published.

## Audit

- `GET /api/v1/audit` returns recent audit events in reverse chronological order.

## Error envelope

Validation and lookup failures return a stable envelope:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "title and sourceUri are required",
  "requestId": "req-123",
  "details": {
    "fields": [
      "title",
      "sourceUri"
    ]
  }
}
```

Current common `code` values:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `CONTRACT_VALIDATION_ERROR`

## Correlation ID

- API responds with `x-correlation-id` header.
- If request sends `x-correlation-id`, the same value is echoed.
- If omitted, API uses `request.id` as correlation ID.

## Compatibility

Legacy non-versioned endpoints remain available for internal compatibility during Phase 1 migration.
