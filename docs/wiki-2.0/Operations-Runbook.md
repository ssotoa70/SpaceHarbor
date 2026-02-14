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
- Inspect workflow counters via `/api/v1/metrics`.

## VAST mode policy

- `ASSETHARBOR_VAST_STRICT=true` + `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=false` runs strict fail-fast mode.
- `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=true` enables fallback continuity mode.
- Verify fallback usage by checking `/api/v1/audit` for `vast fallback` entries.

## Security checks

- If API key mode is enabled, verify matching values for:
  - `ASSETHARBOR_API_KEY`
  - `CONTROL_PLANE_API_KEY`
  - `VITE_API_KEY`
