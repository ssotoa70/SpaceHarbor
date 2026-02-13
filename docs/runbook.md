# Runbook

## Startup

1. Copy `.env.example` to `.env` and set `ASSETHARBOR_PERSISTENCE_BACKEND` plus VAST endpoints/token.
2. Run `docker compose up --build` from `AssetHarbor/`.
3. Verify:
   - API: `http://localhost:8080/health`
   - UI: `http://localhost:4173`

## Core Workflow Check

1. Submit ingest through UI or `POST /api/v1/assets/ingest`.
2. Confirm pending job appears in `GET /api/v1/jobs/pending`.
3. Worker emits events to `POST /api/v1/events`.
4. Confirm status updates on `GET /api/v1/assets` and UI queue.

## Failure Recovery

- If job processing fails, emit `asset.processing.failed` with error detail.
- Mark replay intent with `asset.processing.replay_requested`.
- Re-run worker cycle and emit `asset.processing.completed` after recovery.

## Troubleshooting

- `400` on `/api/v1/events`: verify canonical event envelope fields (`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `producer`, `data.assetId`, `data.jobId`).
- No worker progress: verify `CONTROL_PLANE_URL` and worker container logs.
- UI empty: verify API returns data from `/assets` and `/audit`.
