# Operations Runbook

## Startup

- `docker compose up --build`

## Health checks

- `GET /health`

## Recovery baseline

- Inspect job status via `/api/v1/jobs/:id`.
- Inspect dead-letter jobs via `/api/v1/dlq`.
- Replay failed jobs via `/api/v1/jobs/:id/replay`.
- Requeue stale processing leases via `/api/v1/queue/reap-stale`.
