# AssetHarbor

[![CI](https://github.com/ssotoa70/assetharbor/actions/workflows/ci.yml/badge.svg)](https://github.com/ssotoa70/assetharbor/actions/workflows/ci.yml)
[![CD](https://github.com/ssotoa70/assetharbor/actions/workflows/cd.yml/badge.svg)](https://github.com/ssotoa70/assetharbor/actions/workflows/cd.yml)
[![Wiki 2.0](https://img.shields.io/badge/docs-Wiki%202.0-blue)](https://github.com/ssotoa70/assetharbor/wiki)

Lightweight, VAST-native MAM MVP with three deployables:

- `control-plane`
- `media-worker`
- `web-ui`

Runtime services are containerized and orchestrated via Docker Compose.

## Quick start

1. Copy `.env.example` to `.env` and set persistence backend and VAST endpoints/token.
2. Build and start containers:

```bash
docker compose up --build
```

3. Open UI at `http://localhost:4173`.
4. Control-plane API runs at `http://localhost:8080`.

## Test commands

- Root compose contract: `npm run test:compose`
- Root docs contract: `npm run test:docs`
- Contract suite (API + events): `npm run test:contracts`
- Control-plane tests: `npm run test:control-plane`
- Media-worker tests: `npm run test:worker`
- Web-ui tests: `npm run test:web-ui`
- Full suite: `npm run test:all`

## Core routes

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

Legacy-compatible aliases (for existing internal clients):

- `POST /assets/ingest`
- `GET /assets`
- `GET /jobs/pending`
- `GET /jobs/:id`
- `POST /events`
- `GET /audit`

## Persistence backend

- `ASSETHARBOR_PERSISTENCE_BACKEND=local` uses local in-memory adapter.
- `ASSETHARBOR_PERSISTENCE_BACKEND=vast` uses VAST adapter mode.
- `ASSETHARBOR_VAST_STRICT=true` enforces required VAST endpoint configuration at startup.

## Security baseline

- Set `ASSETHARBOR_API_KEY` to require `x-api-key` on all POST API endpoints (v1 and legacy aliases).
- Configure `CONTROL_PLANE_API_KEY` for media-worker requests in secured environments.
- Configure `VITE_API_KEY` for web-ui requests in secured environments.

## Observability baseline

- `x-correlation-id` is echoed on API responses and propagated through workflow/audit traces.
- `GET /api/v1/metrics` returns queue, job, DLQ, and outbox counters.

## CI/CD

- `ci.yml` validates compose config, docs checks, API/event contract checks, and all service tests.
- `cd.yml` builds and publishes container images to GHCR for each service on `main` and semantic version tags.
- Actions dashboard: `https://github.com/ssotoa70/assetharbor/actions`

## Wiki 2.0

Wiki 2.0 is the operational source of truth for deep docs that should not crowd the README.

- Wiki home: `https://github.com/ssotoa70/assetharbor/wiki`
- Seed content in repo: `docs/wiki-2.0/`

Suggested page map:

- `Home` - navigation and ownership
- `Getting-Started` - setup and first run
- `Architecture` - components and data flow
- `API-Reference` - endpoints and error model
- `Operations-Runbook` - deploy, rollback, incident workflow
- `Security-and-Compliance` - secrets, access, audit
- `Release-Process` - versioning and release checklist

Contribution flow:

1. Link docs updates to the related engineering issue.
2. Update wiki page(s) and matching `docs/wiki-2.0` mirror page in same change.
3. Include docs impact notes in PR description.
4. Verify links from `Home` before merge.
