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
- SERGIO-17 note: canonical event types are additive with review annotation/approval contracts:
  - `asset.review.annotation_created`
  - `asset.review.annotation_resolved`
  - `asset.review.task_linked`
  - `asset.review.submission_created`
  - `asset.review.decision_recorded`
  - `asset.review.decision_overridden`
- SERGIO-17 traceability note: review-to-task correlation fields are contract-level and additive:
  - `reviewId`, `submissionId`, `versionId`, `annotationId`, `taskId`, `taskSystem`
- Slice 2 note: asset/job read models add optional preview metadata fields `thumbnail` and `proxy` (nullable).
- Slice 2 note: asset/job read models add `annotationHook` integration metadata (`enabled`, `provider`, `contextId`) with default disabled/null values.
- Slice 4 note: asset/job read models add additive coordinator handoff metadata:
  - `handoffChecklist` (`releaseNotesReady`, `verificationComplete`, `commsDraftReady`, `ownerAssigned`)
  - `handoff` (`status`, `owner`, `lastUpdatedAt`)

## Outbox

- `GET /api/v1/outbox` lists outbox events.
- `POST /api/v1/outbox/publish` marks unpublished outbox items as published.
- Slice 3 note: outbox publish triggers webhook outbound delivery for configured `slack`, `teams`, and `production` targets.
- Slice 3 note: outbound payloads include signed headers (`x-assetharbor-signature`, `x-assetharbor-timestamp`) and retain pending outbox state on delivery failure.

## Metrics

- `GET /api/v1/metrics` returns workflow counters:
  - assets total
  - jobs by status
  - queue pending/leased
  - outbox pending/published
- DLQ total
- outbound attempts/success/failure (including per-target counters)

## Audit

- `GET /api/v1/audit` returns recent audit events in reverse chronological order.
- SERGIO-18 note: automated retention can remove audit entries older than configured retention window (default 90 days) when mode is set to `apply`; default mode is `dry-run`.

```json
{
  "events": [
    {
      "id": "uuid",
      "message": "[corr:system] vast fallback (createIngestAsset) due to client error: db write failed",
      "at": "2026-02-16T12:00:00.000Z",
      "signal": {
        "type": "fallback",
        "code": "VAST_FALLBACK",
        "severity": "warning"
      }
    }
  ]
}
```

- `signal` is always present; it is either a structured signal object or `null`.
- `signal.type` is `fallback` when present.
- `signal.code` is `VAST_FALLBACK` when present.
- `signal.severity` is `warning` or `critical`.
- Fallback signals should be used by operator clients instead of parsing `message` text.

## Incident Coordination

- `GET /api/v1/incident/coordination` returns shared incident state for guided actions, handoff, and timeline notes.
- `notes` are returned newest-first (reverse chronological order).
- Current durability semantics: coordination state is in-process memory for local/fallback adapters and is reset on service restart.
- Coordination writes are shared across operators connected to the same running control-plane instance; cross-instance durable coordination is tracked as a follow-up phase.

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
- Read-only incident coordination endpoints (`GET /api/v1/incident/coordination`, `GET /api/v1/audit`, `GET /api/v1/metrics`) intentionally remain accessible without API key to preserve operator dashboard visibility during active incidents.

## VAST strict and fallback behavior

- VAST mode uses `ASSETHARBOR_VAST_STRICT` and `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` to control fail-fast vs continuity behavior.
- In strict fail-fast mode, internal VAST workflow client failures surface as `500` with the same unified error envelope.
- In fallback mode, workflow continuity is preserved and fallback usage is visible via audit events.
- Durability semantics (current): fallback counters and fallback audit signals are derived from in-process adapter state and reset on control-plane restart.

## Compatibility

Legacy non-versioned endpoints remain available for internal compatibility during Phase 1 migration.
