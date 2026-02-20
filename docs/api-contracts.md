# API Contracts

## OpenAPI

- `GET /openapi.json` exposes the generated OpenAPI 3 document.
- `GET /docs` serves Swagger UI in non-production environments.
- Contract rule: any new or changed HTTP endpoint must include Fastify `schema` metadata so the OpenAPI document stays current.

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
- Review/QC Slice 1 note: workflow status is additive with `qc_pending`, `qc_in_review`, `qc_approved`, and `qc_rejected`.
- Review/QC Slice 1 note: canonical event types are additive with `asset.review.qc_pending`, `asset.review.in_review`, `asset.review.approved`, and `asset.review.rejected`.

## Outbox

- `GET /api/v1/outbox` lists outbox events.
- `POST /api/v1/outbox/publish` marks unpublished outbox items as published.

## Metrics

- `GET /api/v1/metrics` returns workflow counters:
  - assets total
  - jobs by status
  - queue pending/leased
  - outbox pending/published
  - DLQ total

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
- `UNAUTHORIZED`
- `FORBIDDEN`

## Correlation ID

- API responds with `x-correlation-id` header.
- If request sends `x-correlation-id`, the same value is echoed.
- If omitted, API uses `request.id` as correlation ID.

## API key protection

- If `ASSETHARBOR_API_KEY` is configured, all POST API requests require header `x-api-key` (versioned and legacy aliases).
- Missing key returns `401` with `code: UNAUTHORIZED`.
- Invalid key returns `403` with `code: FORBIDDEN`.

## VAST strict and fallback behavior

- VAST mode uses `ASSETHARBOR_VAST_STRICT` and `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` to control fail-fast vs continuity behavior.
- In strict fail-fast mode, internal VAST workflow client failures surface as `500` with the same unified error envelope.
- In fallback mode, workflow continuity is preserved and fallback usage is visible via audit events.

## Compatibility

Legacy non-versioned endpoints remain available for internal compatibility during Phase 1 migration.
