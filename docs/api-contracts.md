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

## Incident Coordination

- `GET /api/v1/incident/coordination` returns shared incident state for guided actions, handoff, and timeline notes.
- `notes` are returned newest-first (reverse chronological order).

```json
{
  "guidedActions": {
    "acknowledged": false,
    "owner": "",
    "escalated": false,
    "nextUpdateEta": null,
    "updatedAt": null
  },
  "handoff": {
    "state": "none",
    "fromOwner": "",
    "toOwner": "",
    "summary": "",
    "updatedAt": null
  },
  "notes": [
    {
      "id": "uuid",
      "message": "Waiting on storage team update",
      "correlationId": "corr-vast-fallback-123",
      "author": "operator-a",
      "at": "2026-02-15T02:55:00.000Z"
    }
  ]
}
```

- `PUT /api/v1/incident/coordination/actions` updates shared guided actions.

```json
{
  "acknowledged": true,
  "owner": "oncall-supervisor",
  "escalated": true,
  "nextUpdateEta": "2026-02-15T03:00:00.000Z",
  "expectedUpdatedAt": "2026-02-15T02:40:00.000Z"
}
```

- `200 OK`

```json
{
  "guidedActions": {
    "acknowledged": true,
    "owner": "oncall-supervisor",
    "escalated": true,
    "nextUpdateEta": "2026-02-15T03:00:00.000Z",
    "updatedAt": "2026-02-15T02:45:10.000Z"
  }
}
```

- Validation rule: `nextUpdateEta` must be an ISO date-time or `null`.
- `expectedUpdatedAt` is required to prevent stale-write overwrites; pass the `guidedActions.updatedAt` value from the latest read.
- `400`, `401`, `403`, and `409` use the standard error envelope.

- `POST /api/v1/incident/coordination/notes` appends a timeline note linked to a workflow/event correlation.

```json
{
  "message": "Waiting on storage team update",
  "correlationId": "corr-vast-fallback-123",
  "author": "operator-a"
}
```

- `201 Created`

```json
{
  "note": {
    "id": "uuid",
    "message": "Waiting on storage team update",
    "correlationId": "corr-vast-fallback-123",
    "author": "operator-a",
    "at": "2026-02-15T02:55:00.000Z"
  }
}
```

- Validation rule: `message`, `correlationId`, and `author` are required and trimmed.
- `400`, `401`, and `403` use the standard error envelope.

- `PUT /api/v1/incident/coordination/handoff` updates handoff ownership state.

```json
{
  "state": "handoff_requested",
  "fromOwner": "operator-a",
  "toOwner": "operator-b",
  "summary": "Shift change at 19:00 UTC",
  "expectedUpdatedAt": "2026-02-15T02:50:00.000Z"
}
```

- `200 OK`

```json
{
  "handoff": {
    "state": "handoff_requested",
    "fromOwner": "operator-a",
    "toOwner": "operator-b",
    "summary": "Shift change at 19:00 UTC",
    "updatedAt": "2026-02-15T03:00:00.000Z"
  }
}
```

- `state` values: `none`, `handoff_requested`, `handoff_accepted`.
- Validation rule: `fromOwner` and `toOwner` are required when `state` is not `none`.
- `expectedUpdatedAt` is required to prevent stale-write overwrites; pass the `handoff.updatedAt` value from the latest read.
- `400`, `401`, `403`, and `409` use the standard error envelope.
- Timeline notes and audit entries should reference the same `correlationId` to keep incident history traceable end-to-end.

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
- `COORDINATION_CONFLICT`

## Correlation ID

- API responds with `x-correlation-id` header.
- If request sends `x-correlation-id`, the same value is echoed.
- If omitted, API uses `request.id` as correlation ID.

## API key protection

- If `ASSETHARBOR_API_KEY` is configured, all write API requests (`POST`, `PUT`, `PATCH`, `DELETE`) require header `x-api-key` (versioned and legacy aliases).
- Missing key returns `401` with `code: UNAUTHORIZED`.
- Invalid key returns `403` with `code: FORBIDDEN`.

## VAST strict and fallback behavior

- VAST mode uses `ASSETHARBOR_VAST_STRICT` and `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` to control fail-fast vs continuity behavior.
- In strict fail-fast mode, internal VAST workflow client failures surface as `500` with the same unified error envelope.
- In fallback mode, workflow continuity is preserved and fallback usage is visible via audit events.

## Compatibility

Legacy non-versioned endpoints remain available for internal compatibility during Phase 1 migration.
