# API Reference

> This page redirects to the canonical API contracts.

For the complete API reference including request/response schemas, error envelopes, and authentication details, see [API Contracts](../api-contracts.md).

## Route Groups

The API contracts document covers all route groups:

| Group | Key Endpoints |
|-------|---------------|
| **Health** | `GET /health` |
| **Ingest** | `POST /api/v1/assets/ingest` |
| **Queue and Jobs** | `GET /api/v1/assets`, `GET /api/v1/jobs/pending`, `POST /api/v1/queue/claim`, `POST /api/v1/jobs/:id/replay` |
| **Outbox** | `GET /api/v1/outbox`, `POST /api/v1/outbox/publish` |
| **Metrics** | `GET /api/v1/metrics` |
| **Audit** | `GET /api/v1/audit` |
| **Incident Coordination** | `GET /api/v1/incident/coordination`, `PUT .../actions`, `POST .../notes`, `PUT .../handoff` |
| **Approval** | `POST /api/v1/assets/:id/request-review`, `/approve`, `/reject`, `GET .../approval-queue` |
| **Review** | `GET /api/v1/assets/:id/review-uri` |
| **DCC (stubs)** | `POST /api/v1/dcc/maya/export-asset`, `POST .../nuke/import-metadata`, `GET .../supported-formats`, `GET .../status/:job_id` |
| **Materials** | Full MaterialX lifecycle: materials, versions, look variants, bindings, texture dependencies |
| **Timelines** | OTIO timeline ingest, clip browsing, conform |

## Cross-Cutting Concerns

- **Authentication:** `x-api-key` header required for write operations when `SPACEHARBOR_API_KEY` is configured
- **Correlation:** `x-correlation-id` header propagated through all responses
- **Error envelope:** Stable `{ code, message, requestId, details }` format
- **OpenAPI:** `GET /openapi.json` (generated), `GET /docs` (Swagger UI, non-production)
