# API Reference

Primary versioned endpoints are under `/api/v1`.

- `POST /api/v1/assets/ingest`
- `GET /api/v1/assets`
- `GET /api/v1/jobs/pending`
- `GET /api/v1/jobs/:id`
- `POST /api/v1/jobs/:id/heartbeat`
- `POST /api/v1/jobs/:id/replay`
- `POST /api/v1/queue/claim`
- `POST /api/v1/queue/reap-stale`
- `GET /api/v1/dlq`
- `POST /api/v1/events`
- `GET /api/v1/outbox`
- `POST /api/v1/outbox/publish`
- `GET /api/v1/audit`
- `GET /api/v1/metrics`

Notes:

- All POST API endpoints require `x-api-key` when `ASSETHARBOR_API_KEY` is configured.
- API responses include `x-correlation-id` for traceability.
