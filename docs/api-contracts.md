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
- Additive contract (Slice 1): each queue row now includes `productionMetadata` on `GET /api/v1/assets`.
- `productionMetadata` uses stable keys with null-first defaults until metadata write paths are introduced.
- `GET /api/v1/jobs/pending` returns pending jobs for worker polling.
- `GET /api/v1/jobs/:id` returns full workflow job state.
- `POST /api/v1/queue/claim` claims a pending job and sets processing lease.
- `POST /api/v1/jobs/:id/heartbeat` extends an active worker lease.
- `POST /api/v1/queue/reap-stale` requeues processing jobs with expired leases.
- `POST /api/v1/jobs/:id/replay` moves failed/DLQ job back to pending queue.
- `GET /api/v1/dlq` lists dead-lettered jobs.
- Review/QC Slice 1 note: workflow status is additive with `qc_pending`, `qc_in_review`, `qc_approved`, and `qc_rejected`.
- Review/QC Slice 1 note: canonical event types are additive with `asset.review.qc_pending`, `asset.review.in_review`, `asset.review.approved`, and `asset.review.rejected`.
- Track 2 note: workflow status is additive with `revision_required`, `retake`, `client_submitted`, `client_approved`, and `client_rejected`.
- Track 2 note: canonical event types are additive:
  - `asset.review.revision_required` — supervisor requests revisions
  - `asset.retake.started` — artist begins new version after revision
  - `asset.client.submitted` — QC-approved asset submitted for client review
  - `asset.client.approved` — client approves the asset
  - `asset.client.rejected` — client rejects, triggers `revision_required`
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
- Slice 3 note: dependency readiness visibility is UI-derived/read-only over the existing assets read model.
- Slice 3 note: no API contract changes are introduced.
- Slice 3 note: bulk actions are deferred to Slice 4.
- Slice 4 note: bulk actions are replay-only.
- Slice 4 note: UI orchestrates the existing single-item replay API (`POST /api/v1/jobs/:id/replay`).
- Slice 4 note: no API contract changes are introduced.
- Slice 4 note: bulk status mutation is deferred.

```json
{
  "assets": [
    {
      "id": "uuid",
      "jobId": "uuid",
      "title": "Queue Asset",
      "sourceUri": "s3://bucket/queue-asset.mov",
      "status": "pending",
      "productionMetadata": {
        "show": null,
        "episode": null,
        "sequence": null,
        "shot": null,
        "version": null,
        "vendor": null,
        "priority": null,
        "dueDate": null,
        "owner": null
      }
    }
  ]
}
```

- Scope note: metadata write/update APIs are intentionally deferred in this slice; this change is read-model exposure only.
- Slice 2 note: role boards are UI/read-only presentation over existing queue data.
- Slice 2 note: client-side filters/search use the existing `GET /api/v1/assets` read model.
- Slice 2 note: no API contract changes are introduced.

## Outbox

- `GET /api/v1/outbox` lists outbox events.
- `POST /api/v1/outbox/publish` marks unpublished outbox items as published.
- Slice 3 note: outbox publish triggers webhook outbound delivery for configured `slack`, `teams`, and `production` targets.
- Slice 3 note: outbound payloads include signed headers (`x-spaceharbor-signature`, `x-spaceharbor-timestamp`) and retain pending outbox state on delivery failure.

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

## Analytics

Admin-only endpoints (tag: `admin`) for operational metrics and trends. All endpoints support time-range filtering via query parameters and return cached results with a 10-minute TTL.

### Asset Metrics

- `GET /api/v1/analytics/assets` returns asset statistics aggregated by status, media type, and access frequency.

**Query parameters:**
- `range` (optional): `"24h"`, `"7d"` (default), `"30d"`, `"90d"` — predefined time windows
- `from` (optional): ISO-8601 datetime — start of custom range (overrides `range`)
- `to` (optional): ISO-8601 datetime — end of custom range (defaults to now)

**Response `200 OK`:**

```json
{
  "totalAssets": 1247,
  "byStatus": [
    { "status": "approved", "count": 842 },
    { "status": "pending_review", "count": 215 },
    { "status": "in_progress", "count": 134 },
    { "status": "rejected", "count": 56 }
  ],
  "byMediaType": [
    { "mediaType": "exr", "count": 423 },
    { "mediaType": "mov", "count": 312 },
    { "mediaType": "abc", "count": 198 },
    { "mediaType": "usd", "count": 167 },
    { "mediaType": "mtlx", "count": 147 }
  ],
  "topAccessed": [
    { "assetId": "ast-001", "name": "hero_char_v12.exr", "accessCount": 89 },
    { "assetId": "ast-002", "name": "env_forest_v08.usd", "accessCount": 76 },
    { "assetId": "ast-003", "name": "fx_explosion_v03.abc", "accessCount": 64 }
  ],
  "range": "7d",
  "cachedAt": "2026-03-22T12:00:00.000Z"
}
```

**Errors:**
- `400 BAD_REQUEST` — Invalid time range parameter
- Fallback (when Trino unavailable): Returns sample metrics with `range` and `cachedAt` fields populated

### Pipeline Metrics

- `GET /api/v1/analytics/pipeline` returns pipeline execution metrics including completion rate, throughput, and job status breakdown.

**Query parameters:**
- `range` (optional): `"24h"`, `"7d"` (default), `"30d"`, `"90d"`
- `from` (optional): ISO-8601 datetime
- `to` (optional): ISO-8601 datetime

**Response `200 OK`:**

```json
{
  "completionRate": 94.2,
  "throughputPerHour": 12.7,
  "dlqSize": 3,
  "retrySuccessRate": 78.5,
  "jobsByStatus": [
    { "status": "completed", "count": 2841 },
    { "status": "failed", "count": 168 },
    { "status": "retrying", "count": 42 },
    { "status": "pending", "count": 87 }
  ],
  "range": "7d",
  "cachedAt": "2026-03-22T12:00:00.000Z"
}
```

**Completion rate** is the percentage of completed jobs relative to total jobs. **Throughput per hour** is computed as total jobs divided by elapsed time in hours. **DLQ size** is the count of dead-lettered jobs awaiting replay or manual intervention. **Retry success rate** is the percentage of retried jobs that eventually succeeded.

### Storage Metrics

- `GET /api/v1/analytics/storage` returns storage utilization and coverage metrics.

**Query parameters:**
- `range` (optional): `"24h"`, `"7d"` (default), `"30d"`, `"90d"`
- `from` (optional): ISO-8601 datetime
- `to` (optional): ISO-8601 datetime

**Response `200 OK`:**

```json
{
  "totalBytes": 8.81e12,
  "byMediaType": [
    { "mediaType": "exr", "bytes": 3.2e12 },
    { "mediaType": "mov", "bytes": 2.4e12 },
    { "mediaType": "abc", "bytes": 1.5e12 },
    { "mediaType": "usd", "bytes": 1.1e12 },
    { "mediaType": "mtlx", "bytes": 610e9 }
  ],
  "proxyCoverage": 87.3,
  "thumbnailCoverage": 95.1,
  "growthTrend": [7.2e12, 7.5e12, 7.8e12, 8.1e12, 8.3e12, 8.6e12, 8.81e12],
  "range": "7d",
  "cachedAt": "2026-03-22T12:00:00.000Z"
}
```

**Total bytes** includes all asset originals. **Proxy coverage** and **thumbnail coverage** are percentages of assets with proxy and thumbnail derivatives, respectively. **Growth trend** is a time-series array showing cumulative storage growth over the selected range (number of data points may vary with range).

### Render Metrics

- `GET /api/v1/analytics/render` returns render farm metrics including core hours consumed and engine distribution.

**Query parameters:**
- `range` (optional): `"24h"`, `"7d"` (default), `"30d"`, `"90d"`
- `from` (optional): ISO-8601 datetime
- `to` (optional): ISO-8601 datetime

**Response `200 OK`:**

```json
{
  "totalCoreHours": 12480,
  "avgRenderTimeSeconds": 930,
  "peakMemoryTrend": [28.4, 31.2, 29.8, 33.1, 30.5, 35.2, 32.8],
  "jobsByEngine": [
    { "engine": "Arnold", "count": 142 },
    { "engine": "Karma", "count": 78 },
    { "engine": "RenderMan", "count": 42 },
    { "engine": "V-Ray", "count": 22 }
  ],
  "range": "7d",
  "cachedAt": "2026-03-22T12:00:00.000Z"
}
```

**Total core hours** is the sum of CPU time across all render jobs. **Avg render time** is the mean duration per job. **Peak memory trend** is a time-series showing peak memory utilization (in GB) over the range. **Jobs by engine** breaks down render job counts by render engine.

---

## SQL Console

Admin-only endpoints (tag: `admin`) for executing ad-hoc SQL queries against the VAST Catalog and returning structured query results. All queries are validated, rate-limited, and audit-logged.

### Execute Query

- `POST /api/v1/query/execute` executes a SQL query against the catalog database.

**Authentication:** JWT authentication required (API keys rejected). Rate limit: 10 queries per minute per user.

**Request body:**

```json
{
  "sql": "SELECT id, name, status FROM vast.\"spaceharbor/production\".assets WHERE status = 'approved' LIMIT 100"
}
```

**Response `200 OK`:**

```json
{
  "columns": ["id", "name", "status"],
  "rows": [
    ["ast-001", "hero_char_v12.exr", "approved"],
    ["ast-002", "env_forest_v08.usd", "approved"]
  ],
  "rowCount": 2,
  "truncated": false,
  "durationMs": 245,
  "queryId": "uuid"
}
```

**Validation rules:**
- SQL text must not exceed 10,000 characters (400 response if exceeded)
- Statement type must be `SELECT` (403 response for INSERT, UPDATE, DELETE, DDL)
- Blocked tables: `users`, `roles`, `secrets`, `credentials` (403 response if referenced)
- Query will be automatically wrapped with `LIMIT 10000` if not present (prevents full-table scans)

**Errors:**
- `400 BAD_REQUEST` — Missing `sql` field or SQL exceeds length limit
- `403 FORBIDDEN` — Statement type not allowed, blocked table referenced, or API key used instead of JWT
- `429 TOO_MANY_REQUESTS` — Rate limit exceeded (maximum 10 queries per minute)
- `500 INTERNAL_SERVER_ERROR` — Query execution failed with SQL error message

**Query ID** is a UUID that can be used to correlate with audit logs and cancel running queries.

### Query History

- `GET /api/v1/query/history` returns recent query history for the authenticated user.

**Response `200 OK`:**

```json
{
  "history": [
    {
      "id": "uuid",
      "userId": "user-123",
      "sqlText": "SELECT * FROM assets LIMIT 10",
      "sqlHash": "sha256-hash",
      "rowCount": 10,
      "durationMs": 145,
      "status": "success",
      "errorMessage": null,
      "createdAt": "2026-03-22T12:00:00.000Z"
    },
    {
      "id": "uuid",
      "userId": "user-123",
      "sqlText": "SELECT * FROM users",
      "sqlHash": "sha256-hash",
      "rowCount": null,
      "durationMs": 0,
      "status": "denied",
      "errorMessage": "Blocked table: users",
      "createdAt": "2026-03-22T11:59:30.000Z"
    }
  ]
}
```

History is returned in reverse chronological order (newest first), limited to the 50 most recent queries for the authenticated user. **Status** values: `success`, `error`, `denied`. **Error message** is populated only when status is `error` or `denied`; null otherwise. **Row count** and **duration** are null for denied queries.

### Cancel Query

- `DELETE /api/v1/query/:queryId` cancels a running query by ID.

**Response `200 OK`:**

```json
{
  "queryId": "uuid",
  "cancelled": true
}
```

**Notes:** In the current implementation, the cancel endpoint acknowledges the request and logs it to audit. Full Trino integration for in-flight query cancellation is a planned enhancement. **Query ID** must match a query from the user's history; cancelling another user's query is rejected with `403 FORBIDDEN`.

## Approval

Approval workflow routes transition assets through the QC review state machine. All actions require `performed_by` and validate against the current workflow status via the approval state machine.

- `POST /api/v1/assets/:id/request-review` moves an asset into the review queue.

```json
{
  "performed_by": "artist-jane",
  "note": "Ready for supervisor review"
}
```

- `200 OK`

```json
{
  "asset": { "id": "uuid", "status": "qc_in_review", "...": "..." },
  "audit": {
    "id": "uuid",
    "assetId": "uuid",
    "action": "request_review",
    "performedBy": "artist-jane",
    "note": "Ready for supervisor review",
    "fromStatus": "completed",
    "toStatus": "qc_in_review",
    "at": "2026-03-01T12:00:00.000Z"
  }
}
```

- `POST /api/v1/assets/:id/approve` approves an asset that is currently in review.

```json
{
  "performed_by": "supervisor-bob",
  "note": "Looks good"
}
```

- `200 OK` — same response shape as `request-review` with `action: "approve"` and status transition to `qc_approved`.

- `POST /api/v1/assets/:id/reject` rejects an asset that is currently in review.

```json
{
  "performed_by": "supervisor-bob",
  "reason": "Color grading needs rework"
}
```

- `200 OK` — same response shape with `action: "reject"` and status transition to `qc_rejected`.

- `GET /api/v1/assets/approval-queue` lists assets currently in the `qc_in_review` status, each annotated with its approval audit trail.

```json
{
  "assets": [
    {
      "id": "uuid",
      "title": "Shot 010",
      "status": "qc_in_review",
      "auditTrail": [
        {
          "id": "uuid",
          "assetId": "uuid",
          "action": "request_review",
          "performedBy": "artist-jane",
          "note": "Ready for supervisor review",
          "fromStatus": "completed",
          "toStatus": "qc_in_review",
          "at": "2026-03-01T12:00:00.000Z"
        }
      ]
    }
  ]
}
```

- Error codes: `400 VALIDATION_ERROR` (missing `performed_by`), `404 NOT_FOUND` (asset not found), `409 APPROVAL_INVALID_TRANSITION` (status not valid for action), `409 CAS_CONFLICT` (concurrent modification).

## Review

Review routes provide integration with OpenRV for visual review of assets.

- `GET /api/v1/assets/:id/review-uri` returns an `rvlink://` URI suitable for launching OpenRV to review the asset.

- `200 OK`

```json
{
  "asset_id": "uuid",
  "uri": "rvlink:///vast/bucket/shot-010.exr",
  "format": "exr_sequence"
}
```

- `format` values: `exr_sequence`, `mov`, `dpx_sequence`, `mp4`, `unknown`.
- URI construction normalizes `vast://` and `mock://` schemes to NFS-style `/vast/` paths for RV compatibility.
- `404 NOT_FOUND` if the asset does not exist or has no `sourceUri`.

## DCC (stubs)

Digital Content Creation integration endpoints. All endpoints in this group are **stubs** that return canned responses; real DCC orchestration is deferred to a future phase. Each stub records an entry in the in-memory DCC audit trail.

- `POST /api/v1/dcc/maya/export-asset` requests an asset export via Maya.

```json
{
  "asset_id": "uuid",
  "shot_id": "SH010",
  "version_label": "v003",
  "export_format": "exr"
}
```

- `200 OK`

```json
{
  "job_id": "dcc-job-uuid",
  "status": "queued",
  "manager_uri": "http://openassetio-manager:8001/resolve"
}
```

- `manager_uri` is derived from `OPENASSETIO_MANAGER_URL` env var (default `http://openassetio-manager:8001`).

- `POST /api/v1/dcc/nuke/import-metadata` imports metadata from a Nuke project file.

```json
{
  "asset_id": "uuid",
  "nuke_project_path": "/projects/show/nuke/comp_010.nk"
}
```

- `200 OK`

```json
{
  "asset_id": "uuid",
  "metadata_imported": true
}
```

- `GET /api/v1/dcc/supported-formats` lists supported DCC export formats.

- `200 OK`

```json
{
  "formats": ["exr", "mov", "dpx"]
}
```

- `GET /api/v1/dcc/status/:job_id` checks the status of a DCC job.

- `200 OK`

```json
{
  "job_id": "dcc-job-uuid",
  "status": "completed"
}
```

- `status` values: `completed`, `in_progress`, `failed`.
- Stub note: always returns `completed` in the current implementation.

## Materials

MaterialX material management routes covering the full lifecycle: materials, versioned material definitions, look variants, render-version bindings, and texture dependencies.

### Material CRUD

- `POST /api/v1/materials` creates a material.

```json
{
  "projectId": "proj-uuid",
  "name": "chrome_brushed",
  "description": "Brushed chrome shader",
  "status": "active",
  "createdBy": "artist-jane"
}
```

- `201 Created` — returns the created material object.
- `status` values: `active`, `deprecated`, `archived`. Defaults to `active` if omitted.

- `GET /api/v1/materials?projectId=<projectId>` lists materials for a project. Query parameter `projectId` is required.

- `GET /api/v1/materials/:materialId` returns a single material by ID. `404` if not found.

### Material Versions

- `POST /api/v1/materials/:materialId/versions` creates a material version.

```json
{
  "versionLabel": "v002",
  "sourcePath": "/materials/chrome_brushed/v002/chrome_brushed.mtlx",
  "contentHash": "sha256:abc123",
  "usdMaterialPath": "/Materials/chrome_brushed",
  "renderContexts": ["arnold", "karma"],
  "colorspaceConfig": "ACES 1.2",
  "mtlxSpecVersion": "1.38",
  "lookNames": ["default", "weathered"],
  "createdBy": "artist-jane"
}
```

- `201 Created` — returns the created version. Initial `status` is always `draft`.
- `404` if the parent material does not exist.

- `GET /api/v1/materials/:materialId/versions` lists all versions for a material. `404` if the material does not exist.

- `GET /api/v1/materials/:materialId/versions/:versionId` returns a single version by ID. `404` if not found.

### Look Variants

- `POST /api/v1/materials/versions/:versionId/looks` creates a look variant.

```json
{
  "lookName": "weathered",
  "description": "Aged surface variant",
  "materialAssigns": "{\"geom\": \"/World/Props/Helmet\", \"material\": \"/Materials/chrome_weathered\"}"
}
```

- `201 Created` — returns the created look variant.
- `404` if the parent material version does not exist.

- `GET /api/v1/materials/versions/:versionId/looks` lists look variants for a material version. `404` if the version does not exist.

### Bindings

- `POST /api/v1/materials/looks/:lookVariantId/bind` binds a look variant to a render version.

```json
{
  "versionId": "render-version-uuid",
  "boundBy": "artist-jane"
}
```

- `201 Created` — returns the created binding.

- `GET /api/v1/materials/looks/:lookVariantId/bindings` lists bindings for a look variant.

- `GET /api/v1/versions/:versionId/material-bindings` lists material bindings for a render version.

### Texture Dependencies

- `POST /api/v1/materials/versions/:versionId/dependencies` creates a texture dependency record.

```json
{
  "texturePath": "/textures/chrome_roughness.exr",
  "contentHash": "sha256:def456",
  "textureType": "roughness",
  "colorspace": "linear",
  "dependencyDepth": 0
}
```

- `201 Created` — returns the created dependency.
- `404` if the parent material version does not exist.

- `GET /api/v1/materials/versions/:versionId/dependencies` lists texture dependencies for a material version. `404` if the version does not exist.

## Timelines

OTIO timeline management routes for ingesting editorial timelines, browsing clips, and conforming clips to shot/version records.

- `POST /api/v1/timelines/ingest` ingests a timeline from an OTIO file reference.

```json
{
  "name": "Episode 3 Edit v5",
  "projectId": "proj-uuid",
  "sourceUri": "vast://timelines/ep3_edit_v5.otio",
  "frameRate": 24.0,
  "durationFrames": 86400,
  "tracks": [
    {
      "name": "V1",
      "kind": "Video",
      "clips": [
        {
          "clip_name": "SH010_comp_v3",
          "source_uri": "vast://renders/SH010_comp_v3.exr",
          "in_frame": 1001,
          "out_frame": 1048,
          "duration_frames": 48,
          "shot_name": "SH010",
          "vfx_cut_in": 1001,
          "vfx_cut_out": 1048,
          "handle_head": 8,
          "handle_tail": 8,
          "delivery_in": 993,
          "delivery_out": 1056,
          "source_timecode": "01:00:00:00"
        }
      ]
    }
  ]
}
```

- `201 Created` — returns the created timeline object. If `tracks` with `clips` are provided, clip records are also created.
- `frameRate` defaults to `24.0` if omitted. `durationFrames` defaults to `0`.

- `GET /api/v1/timelines?projectId=<projectId>` lists timelines for a project. Query parameter `projectId` is required.

- `GET /api/v1/timelines/:id` returns a timeline with its clips.

```json
{
  "id": "uuid",
  "name": "Episode 3 Edit v5",
  "projectId": "proj-uuid",
  "sourceUri": "vast://timelines/ep3_edit_v5.otio",
  "frameRate": 24.0,
  "durationFrames": 86400,
  "status": "ingested",
  "clips": [
    {
      "id": "uuid",
      "timelineId": "uuid",
      "trackName": "V1",
      "clipName": "SH010_comp_v3",
      "sourceUri": "vast://renders/SH010_comp_v3.exr",
      "inFrame": 1001,
      "outFrame": 1048,
      "durationFrames": 48,
      "vfxCutIn": 1001,
      "vfxCutOut": 1048,
      "handleHead": 8,
      "handleTail": 8,
      "deliveryIn": 993,
      "deliveryOut": 1056,
      "sourceTimecode": "01:00:00:00",
      "conformStatus": null,
      "matchedShotId": null
    }
  ]
}
```

- `404` if the timeline does not exist.

- `GET /api/v1/timelines/:id/clips` lists clips for a timeline. `404` if the timeline does not exist.

- `GET /api/v1/timelines/:id/changes` returns cut change diff compared to the previous version of the same timeline (matched by `projectId` + `name`). Returns `{ changes: [] }` if no previous version exists. Each change has `changeType` (`added`, `removed`, `modified`), `clipName`, and frame details.
- When re-ingesting a timeline with the same `projectId` + `name`, the system auto-detects cut changes and emits a `timeline.cut_change` event with affected shot identifiers.

- `POST /api/v1/timelines/:id/conform` triggers conforming, which attempts to match each clip to existing shots in the project by clip name or source URI containing the shot code.

- `200 OK` — returns the timeline with updated clips, each having `conformStatus` set to `matched` or `unmatched` and `matchedShotId` populated for matched clips.
- Timeline status transitions: `ingested` -> `conforming` -> `conformed`.
- `404` if the timeline does not exist.

### Clip Frame Range Fields

Timeline clips support optional VFX frame range and handle tracking fields:

| Field | Type | Description |
|-------|------|-------------|
| `vfx_cut_in` | integer | VFX cut-in frame number |
| `vfx_cut_out` | integer | VFX cut-out frame number |
| `handle_head` | integer | Head handle padding frames (default: 8) |
| `handle_tail` | integer | Tail handle padding frames (default: 8) |
| `delivery_in` | integer | Delivery start frame (cut_in - handle_head) |
| `delivery_out` | integer | Delivery end frame (cut_out + handle_tail) |
| `source_timecode` | string | Source timecode at cut-in (e.g., "01:00:00:00") |

All fields are optional and default to `null` when not provided.

## Review Sessions

Dailies-oriented review sessions allow supervisors to batch multiple asset submissions into a scheduled review. Assets are submitted to a session and reviewed in order.

- `POST /api/v1/review-sessions` creates a new review session.

```json
{
  "projectId": "proj-uuid",
  "department": "lighting",
  "sessionDate": "2026-03-12",
  "sessionType": "dailies",
  "supervisorId": "supervisor-bob"
}
```

- `201 Created`

```json
{
  "session": {
    "id": "uuid",
    "projectId": "proj-uuid",
    "department": "lighting",
    "sessionDate": "2026-03-12",
    "sessionType": "dailies",
    "supervisorId": "supervisor-bob",
    "status": "open",
    "createdAt": "2026-03-12T09:00:00.000Z"
  }
}
```

- `sessionType` values: `dailies`, `client_review`, `final`.
- `status` values: `open`, `in_progress`, `closed`.
- `department` and `supervisorId` are optional.

- `GET /api/v1/review-sessions` lists review sessions. Filterable by `status`, `department`, and `projectId` query parameters.

```json
{
  "sessions": [
    {
      "id": "uuid",
      "projectId": "proj-uuid",
      "department": "lighting",
      "sessionDate": "2026-03-12",
      "sessionType": "dailies",
      "supervisorId": "supervisor-bob",
      "status": "open",
      "createdAt": "2026-03-12T09:00:00.000Z"
    }
  ]
}
```

- `GET /api/v1/review-sessions/:id` returns a session with its submissions.

```json
{
  "session": {
    "id": "uuid",
    "projectId": "proj-uuid",
    "department": "lighting",
    "sessionDate": "2026-03-12",
    "sessionType": "dailies",
    "supervisorId": "supervisor-bob",
    "status": "open",
    "createdAt": "2026-03-12T09:00:00.000Z"
  },
  "submissions": [
    {
      "id": "uuid",
      "sessionId": "uuid",
      "assetId": "asset-uuid",
      "versionId": null,
      "submissionOrder": 1,
      "status": "pending",
      "submittedAt": "2026-03-12T09:05:00.000Z"
    }
  ]
}
```

- `404 NOT_FOUND` if the session does not exist.

- `POST /api/v1/review-sessions/:id/submissions` adds an asset to a session.

```json
{
  "assetId": "asset-uuid",
  "versionId": "version-uuid",
  "submissionOrder": 1
}
```

- `201 Created` — returns the created submission. `versionId` and `submissionOrder` are optional (order auto-increments if omitted).
- `404 NOT_FOUND` if the session does not exist.
- `409 INVALID_STATE` if the session is already closed.

- `POST /api/v1/review-sessions/:id/close` closes a session with supervisor sign-off.

```json
{
  "performed_by": "supervisor-bob"
}
```

- `200 OK` — returns the updated session with status `closed`.
- `404 NOT_FOUND` if the session does not exist.
- `409 INVALID_STATE` if the session is already closed.

- Existing `POST /api/v1/assets/:id/approve` and `POST /api/v1/assets/:id/reject` accept an optional `session_id` field to link the approval to a review session submission.

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

## Authentication

Three authentication strategies are evaluated in priority order:

| Strategy | Header | Use case |
|----------|--------|----------|
| **JWT Bearer** | `Authorization: Bearer <jwt>` | Interactive users via OIDC IdP |
| **API Key** | `x-api-key: <key>` | Automation, CI, DataEngine callbacks (legacy) |
| **Service Token** | `x-service-token: <token>` | Machine-to-machine (scanner-function, media-worker) |

All strategies resolve to a unified `RequestContext` with userId, roles, permissions, and tenant/project scope.

### JWT Bearer (Phase 8)

When `SPACEHARBOR_IAM_ENABLED=true`, the control-plane validates JWT tokens:
- **Claims:** `sub` (userId), `email`, `name`/`display_name`, `groups`, `roles`, `tenant_id`
- **Validation:** `exp` (not expired), `iss` (matches `SPACEHARBOR_OIDC_ISSUER`), `aud` (matches `SPACEHARBOR_OIDC_AUDIENCE`)
- **Dev mode:** When no JWKS URI is configured, JWT payloads are parsed without signature verification
- **Role mapping:** `roles` claim or group names matching known roles (`viewer`, `artist`, `coordinator`, `supervisor`, `producer`, `admin`, etc.)

### API Key (Legacy)

- If `SPACEHARBOR_API_KEY` is configured, all write API requests (`POST`, `PUT`, `PATCH`, `DELETE`) require header `x-api-key` (versioned and legacy aliases).
- Missing key returns `401` with `code: UNAUTHORIZED`.
- Invalid key returns `403` with `code: FORBIDDEN`.
- Read-only incident coordination endpoints (`GET /api/v1/incident/coordination`, `GET /api/v1/audit`, `GET /api/v1/metrics`) intentionally remain accessible without API key to preserve operator dashboard visibility during active incidents.

### Authorization (Phase 8)

When IAM is enabled, every request is evaluated against the permission catalog:
- **Shadow mode** (default): Decisions are logged but not enforced — existing behavior is preserved.
- **Enforcement mode**: Unauthorized requests receive `403 FORBIDDEN` with `details.permission` and `details.reason`.
- **Feature flags**: `SPACEHARBOR_IAM_ENFORCE_READ_SCOPE`, `SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE`, `SPACEHARBOR_IAM_ENFORCE_APPROVAL_SOD`.
- **Rollout rings**: Enforcement applies only to allowlisted tenants (`SPACEHARBOR_IAM_ALLOWLISTED_TENANTS`) until `SPACEHARBOR_IAM_ROLLOUT_RING=general`.

## VAST strict and fallback behavior

- VAST mode uses `SPACEHARBOR_VAST_STRICT` and `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL` to control fail-fast vs continuity behavior.
- In strict fail-fast mode, internal VAST workflow client failures surface as `500` with the same unified error envelope.
- In fallback mode, workflow continuity is preserved and fallback usage is visible via audit events.
- Durability semantics (current): fallback counters and fallback audit signals are derived from in-process adapter state and reset on control-plane restart.

## Compatibility

Legacy non-versioned endpoints remain available for internal compatibility during Phase 1 migration.

---

## VFX Hierarchy

The hierarchy API exposes the project structure: projects → sequences → shots → tasks/versions.

- `GET /api/v1/hierarchy` returns the full hierarchy tree for all projects.
- `200 OK`

```json
{
  "projects": [
    {
      "id": "proj-123",
      "label": "My Film Project",
      "type": "project",
      "status": "active",
      "children": [
        {
          "id": "seq-456",
          "label": "SQ010",
          "type": "sequence",
          "status": "active",
          "children": [
            {
              "id": "shot-789",
              "label": "SH0100",
              "type": "shot",
              "status": "in_progress",
              "frame_range": { "start": 1, "end": 120 },
              "children": [
                {
                  "id": "task-abc",
                  "label": "comp",
                  "type": "task",
                  "status": "in_progress",
                  "assignee": "compositor-bob",
                  "pipeline_stage": "compositing"
                },
                {
                  "id": "ver-def",
                  "label": "v001",
                  "type": "version",
                  "status": "pending_review",
                  "resolution": "1920x1080",
                  "color_space": "ACES",
                  "frame_range": { "start": 1, "end": 120 }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Identity & Access Management (IAM)

Authentication and user management endpoints.

### Login & Token Refresh

- `POST /api/v1/auth/login` — Local password authentication.

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

- `200 OK`

```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "Jane Doe",
    "roles": ["artist"]
  }
}
```

- `POST /api/v1/auth/refresh` — Refresh an expired access token using refresh token.

```json
{
  "refreshToken": "eyJhbGc..."
}
```

- `200 OK` — Returns new access/refresh token pair.

- `POST /api/v1/auth/logout` — Revoke all tokens for the current user.
- `200 OK`

### User Management

- `POST /api/v1/users` — Create a new user (admin only).

```json
{
  "email": "newuser@example.com",
  "name": "New User",
  "roles": ["artist"]
}
```

- `201 Created`

```json
{
  "user": {
    "id": "user-new",
    "email": "newuser@example.com",
    "name": "New User",
    "roles": ["artist"],
    "createdAt": "2026-03-22T12:00:00.000Z"
  }
}
```

- `GET /api/v1/users` — List all users (admin only).
- `200 OK` — Returns array of user objects.

- `GET /api/v1/users/:id` — Get user details.
- `200 OK` — Returns single user object.

- `PUT /api/v1/users/:id/status` — Enable/disable a user (admin only).

```json
{
  "enabled": false,
  "reason": "Offboarded"
}
```

- `200 OK` — Returns updated user object.

### API Key Management

- `POST /api/v1/api-keys` — Create a new API key (admin only).

```json
{
  "name": "CI/CD Token",
  "permissions": ["write:assets"]
}
```

- `201 Created`

```json
{
  "key": {
    "id": "key-abc",
    "name": "CI/CD Token",
    "secret": "sh_abc123xyz...",
    "permissions": ["write:assets"],
    "createdAt": "2026-03-22T12:00:00.000Z"
  }
}
```

- `GET /api/v1/api-keys` — List all API keys (admin only).
- `200 OK` — Returns array of key objects (secrets masked).

- `DELETE /api/v1/api-keys/:id` — Revoke an API key (admin only).
- `204 No Content`

---

## Platform Settings

Configuration and system health endpoints.

- `GET /api/v1/platform/settings` — Read current platform configuration (admin only).

- `200 OK`

```json
{
  "vastDatabase": {
    "configured": true,
    "endpoint": "https://vast-vip.example.c...",
    "status": "connected",
    "tablesDeployed": true
  },
  "vastEventBroker": {
    "configured": true,
    "brokerUrl": "vast-broker.example.c...",
    "topic": "spaceharbor.dataengine.completed",
    "status": "connected"
  },
  "vastDataEngine": {
    "configured": false,
    "url": null,
    "status": "not_configured"
  },
  "authentication": {
    "mode": "local",
    "oidcIssuer": null,
    "jwksUri": null,
    "iamEnabled": true,
    "shadowMode": true,
    "rolloutRing": "beta"
  },
  "storage": {
    "s3Endpoint": "https://s3.example.c...",
    "s3Bucket": "spaceharbor-assets",
    "configured": true
  },
  "scim": {
    "configured": false,
    "enabled": false
  }
}
```

- `PUT /api/v1/platform/settings` — Update platform configuration (admin only).

```json
{
  "vastDatabase": {
    "endpoint": "https://new-vast-vip.example.com:8443"
  },
  "authentication": {
    "shadowMode": false
  }
}
```

- `200 OK` — Returns updated settings object.

- `POST /api/v1/platform/settings/test-connection` — Test connectivity to a platform service (admin only).

```json
{
  "service": "vast_database"
}
```

- `200 OK`

```json
{
  "service": "vast_database",
  "status": "ok",
  "message": "Connected successfully"
}
```

- Supported services: `vast_database`, `event_broker`, `data_engine`, `s3`.

- `POST /api/v1/platform/settings/deploy-schema` — Run pending database migrations (admin only).
- `200 OK`

```json
{
  "status": "ok",
  "migrationsApplied": 3,
  "message": "Migration v003_add_approval_table applied successfully"
}
```

- `GET /api/v1/platform/settings/schema-status` — Check current schema version and pending migrations (admin only).

- `200 OK`

```json
{
  "currentVersion": 14,
  "availableMigrations": 2,
  "upToDate": false,
  "pending": [
    { "version": 15, "description": "add_retention_policy_table" },
    { "version": 16, "description": "add_audit_indexes" }
  ]
}
```
