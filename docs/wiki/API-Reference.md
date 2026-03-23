# API Reference

Complete SpaceHarbor REST API documentation with examples.

## OpenAPI Specification

The full API specification is available as OpenAPI 3.0:

```bash
GET /openapi.json       # Download OpenAPI document
GET /docs               # Interactive Swagger UI (development only)
```

## Authentication

### API Key (Service-to-Service)

Include the API key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer sh_your-api-key" \
  http://localhost:3000/api/v1/assets
```

### JWT Token (User Sessions)

After login, include the JWT:

```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiI..." \
  http://localhost:3000/api/v1/assets
```

### Local Development (No Auth)

Development mode has auth disabled by default:

```bash
curl http://localhost:3000/api/v1/assets
```

## Core Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "control-plane"
}
```

### Ingest Asset

```bash
POST /api/v1/assets/ingest
Content-Type: application/json

{
  "title": "My First Clip",
  "sourceUri": "s3://bucket/clip.mov",
  "metadata": {
    "show": "Project Alpha",
    "sequence": "SEQ010",
    "shot": "SH001"
  }
}
```

Response (201 Created):
```json
{
  "asset": {
    "id": "7f8e5c3a-2b1d-4e6f-9a8c-3d2e1f0a9b8c",
    "title": "My First Clip",
    "sourceUri": "s3://bucket/clip.mov",
    "elementHandle": "elem_abc123xyz",
    "status": "ingest",
    "createdAt": "2026-03-23T10:30:00.000Z",
    "metadata": {
      "show": "Project Alpha",
      "sequence": "SEQ010",
      "shot": "SH001"
    }
  },
  "job": {
    "id": "job-uuid",
    "assetId": "asset-uuid",
    "status": "pending",
    "createdAt": "2026-03-23T10:30:00.000Z"
  }
}
```

### List Assets

```bash
GET /api/v1/assets?status=processing&sort=createdAt&limit=50&offset=0
```

Query Parameters:
- `status` — Filter by status (ingest, processing, approved, archived)
- `sort` — Sort field (createdAt, updatedAt, title)
- `order` — Sort order (asc, desc)
- `limit` — Results per page (default 50, max 500)
- `offset` — Pagination offset (default 0)
- `search` — Full-text search on title/description

Response:
```json
{
  "assets": [
    {
      "id": "asset-uuid",
      "title": "My First Clip",
      "status": "processing",
      "elementHandle": "elem_abc123xyz",
      "createdAt": "2026-03-23T10:30:00.000Z",
      "metadata": {...}
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### Get Asset Details

```bash
GET /api/v1/assets/:assetId
```

Response:
```json
{
  "id": "asset-uuid",
  "title": "My First Clip",
  "sourceUri": "s3://bucket/clip.mov",
  "elementHandle": "elem_abc123xyz",
  "status": "approved",
  "mediaType": "video",
  "duration_ms": 240000,
  "resolution": "1920x1080",
  "frameRate": 23.976,
  "codec": "h264",
  "thumbnailUri": "s3://bucket/thumbs/asset-uuid.jpg",
  "proxyUri": "s3://bucket/proxies/asset-uuid-proxy.mov",
  "metadata": {
    "show": "Project Alpha",
    "sequence": "SEQ010",
    "shot": "SH001",
    "version": "v002"
  },
  "approvalStatus": "approved",
  "approvedBy": "supervisor@example.com",
  "approvedAt": "2026-03-23T12:00:00.000Z",
  "createdAt": "2026-03-23T10:30:00.000Z"
}
```

## Job Queue

### Get Pending Jobs (Worker)

```bash
GET /api/v1/jobs/pending?limit=10
```

Response:
```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "assetId": "asset-uuid",
      "status": "pending",
      "stage": "probe",
      "createdAt": "2026-03-23T10:30:00.000Z",
      "maxAttempts": 3,
      "attemptCount": 0
    }
  ]
}
```

### Claim Job

```bash
POST /api/v1/queue/claim
Content-Type: application/json

{
  "jobId": "job-uuid",
  "workerId": "worker-1"
}
```

Response (200 OK):
```json
{
  "id": "job-uuid",
  "leaseOwner": "worker-1",
  "leaseExpiresAt": "2026-03-23T10:35:00.000Z"
}
```

### Send Heartbeat

Keep the lease active while processing:

```bash
POST /api/v1/jobs/:jobId/heartbeat
Content-Type: application/json

{
  "workerId": "worker-1",
  "progress": 50
}
```

Response (204 No Content)

### Report Job Completion

```bash
POST /api/v1/jobs/:jobId/complete
Content-Type: application/json

{
  "status": "completed",
  "result": {
    "proxyUri": "s3://bucket/proxy.mov",
    "metadata": {
      "frameRate": 23.976,
      "codec": "h264"
    }
  }
}
```

Response (200 OK)

### Get Job Details

```bash
GET /api/v1/jobs/:jobId
```

Response:
```json
{
  "id": "job-uuid",
  "assetId": "asset-uuid",
  "status": "completed",
  "stage": "transcode",
  "attemptCount": 1,
  "maxAttempts": 3,
  "processingStartedAt": "2026-03-23T10:31:00.000Z",
  "processingCompletedAt": "2026-03-23T10:35:00.000Z",
  "durationSeconds": 240,
  "lastError": null,
  "result": {...}
}
```

## Approval Workflow

### Submit Asset for Review

```bash
POST /api/v1/approvals
Content-Type: application/json

{
  "assetId": "asset-uuid",
  "status": "submitted_for_review"
}
```

### Approve Asset

```bash
POST /api/v1/approvals/:assetId/approve
Content-Type: application/json

{
  "reviewerId": "reviewer-uuid",
  "notes": "Approved for delivery"
}
```

Response (200 OK):
```json
{
  "assetId": "asset-uuid",
  "status": "approved",
  "approvedBy": "reviewer@example.com",
  "approvedAt": "2026-03-23T12:00:00.000Z",
  "notes": "Approved for delivery"
}
```

### Reject Asset

```bash
POST /api/v1/approvals/:assetId/reject
Content-Type: application/json

{
  "reviewerId": "reviewer-uuid",
  "reason": "Color grading needs adjustment",
  "suggestedActions": ["Color correction", "Re-render"]
}
```

### Request Revisions

```bash
POST /api/v1/approvals/:assetId/revise
Content-Type: application/json

{
  "reviewerId": "reviewer-uuid",
  "issues": [
    {
      "category": "color",
      "severity": "major",
      "note": "Highlights are clipped"
    }
  ]
}
```

## Events and Real-Time Updates

### Subscribe to Events (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3000/events/stream');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Asset updated:', data);
};

ws.onerror = (error) => console.error('WebSocket error:', error);
ws.onclose = () => console.log('Disconnected');
```

### Post Event (HTTP)

```bash
POST /api/v1/events
Content-Type: application/json

{
  "eventId": "evt-123",
  "eventType": "asset.processing.started",
  "eventVersion": "1.0",
  "occurredAt": "2026-03-23T10:30:00.000Z",
  "correlationId": "corr-123",
  "producer": "media-worker",
  "data": {
    "assetId": "asset-uuid",
    "jobId": "job-uuid"
  }
}
```

## Metrics and Monitoring

### Get Metrics

```bash
GET /api/v1/metrics
```

Response:
```json
{
  "assets": {
    "total": 150,
    "byStatus": {
      "ingest": 10,
      "processing": 5,
      "approved": 120,
      "archived": 15
    }
  },
  "jobs": {
    "pending": 8,
    "processing": 3,
    "completed": 142,
    "failed": 2
  },
  "queue": {
    "pending": 8,
    "leased": 3,
    "dlq": 2
  },
  "processingTime": {
    "avg_seconds": 45,
    "p95_seconds": 120,
    "p99_seconds": 300
  }
}
```

## Audit and Compliance

### Get Audit Log

```bash
GET /api/v1/audit?actor=user-123&action=approval&limit=50&days=30
```

Query Parameters:
- `actor` — Filter by user ID
- `action` — Filter by action (ingest, approval, reject, archive)
- `resource` — Filter by asset/job ID
- `days` — Look back (default 30)
- `limit` — Results per page

Response:
```json
{
  "events": [
    {
      "id": "audit-event-uuid",
      "correlationId": "corr-123",
      "timestamp": "2026-03-23T12:00:00.000Z",
      "actor": {
        "id": "user-123",
        "email": "user@example.com"
      },
      "action": "approval",
      "resource": {
        "type": "asset",
        "id": "asset-uuid"
      },
      "result": "success",
      "metadata": {
        "approvalStatus": "approved",
        "notes": "Approved for delivery"
      }
    }
  ],
  "total": 42
}
```

## Dead-Letter Queue

### Get DLQ Jobs

```bash
GET /api/v1/dlq
```

Response:
```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "assetId": "asset-uuid",
      "attemptCount": 3,
      "maxAttempts": 3,
      "lastError": "Transcoding timeout after 600s",
      "failedAt": "2026-03-23T11:30:00.000Z"
    }
  ],
  "total": 2
}
```

### Replay DLQ Job

```bash
POST /api/v1/jobs/:jobId/replay
```

Response (200 OK):
```json
{
  "id": "job-uuid",
  "status": "pending",
  "attemptCount": 0,
  "nextAttemptAt": "2026-03-23T11:31:00.000Z"
}
```

## Error Responses

All errors follow this format:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid request parameters",
  "details": [
    {
      "field": "title",
      "message": "Title is required"
    }
  ]
}
```

Common Error Codes:
- `VALIDATION_ERROR` (400) — Invalid input
- `UNAUTHORIZED` (401) — Missing or invalid credentials
- `FORBIDDEN` (403) — Insufficient permissions
- `NOT_FOUND` (404) — Resource not found
- `CONFLICT` (409) — State conflict (e.g., already approved)
- `RATE_LIMITED` (429) — Too many requests
- `INTERNAL_ERROR` (500) — Server error

## Rate Limiting

API rate limits:
- **Standard**: 100 requests/second per API key
- **Burst**: 500 requests in 1-second window

Response headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1677060000
```

## See Also

- [Architecture Overview](Architecture.md) — System design
- [Pipeline and Functions](Pipeline-and-Functions.md) — Processing details
- [Event Contracts](../docs/event-contracts.md) — Detailed event schemas
