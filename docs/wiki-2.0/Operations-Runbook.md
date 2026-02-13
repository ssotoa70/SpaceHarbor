# Operations Runbook

## Startup

- `docker compose up --build`

## Health checks

- `GET /health`

## Recovery baseline

- Inspect job status via `/api/v1/jobs/:id`.
- Replay via event submission path when retries are implemented.
