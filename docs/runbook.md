# Runbook

## Startup

1. Copy `.env.example` to `.env` and set:
   - `ASSETHARBOR_PERSISTENCE_BACKEND`
   - `ASSETHARBOR_VAST_STRICT` (recommended `true` for VAST-backed deployments)
   - VAST endpoints and token
   - optional API keys (`ASSETHARBOR_API_KEY`, `CONTROL_PLANE_API_KEY`, `VITE_API_KEY`)
2. Run `docker compose up --build` from `AssetHarbor/`.
3. Verify:
   - API: `http://localhost:8080/health`
   - UI: `http://localhost:4173`

## Core Workflow Check

1. Submit ingest through UI or `POST /api/v1/assets/ingest`.
2. Worker claims jobs via `POST /api/v1/queue/claim`.
3. Confirm active lease heartbeat on `POST /api/v1/jobs/:id/heartbeat`.
4. Worker emits events to `POST /api/v1/events`.
5. Confirm status updates on `GET /api/v1/assets` and UI queue.
6. Validate counters on `GET /api/v1/metrics`.

## Failure Recovery

- If processing fails and attempts remain, system schedules retry automatically.
- When retries are exhausted, verify job appears in `GET /api/v1/dlq`.
- Replay a failed job with `POST /api/v1/jobs/:id/replay`.
- Use `POST /api/v1/queue/reap-stale` to requeue expired processing leases.

## Troubleshooting

- `400` on `/api/v1/events`: verify canonical event envelope fields (`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `producer`, `data.assetId`, `data.jobId`).
- No worker progress: verify `CONTROL_PLANE_URL` and worker container logs.
- UI empty: verify API returns data from `/api/v1/assets` and `/api/v1/audit`.
- Check `x-correlation-id` response header for request tracing.
- `401/403` on POST routes: verify matching API keys across control-plane, worker, and web-ui.
