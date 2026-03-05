# AssetHarbor

[![CI](https://github.com/ssotoa70/assetharbor/actions/workflows/ci.yml/badge.svg)](https://github.com/ssotoa70/assetharbor/actions/workflows/ci.yml)
[![CD](https://github.com/ssotoa70/assetharbor/actions/workflows/cd.yml/badge.svg)](https://github.com/ssotoa70/assetharbor/actions/workflows/cd.yml)
[![Wiki 2.0](https://img.shields.io/badge/docs-Wiki%202.0-blue)](https://github.com/ssotoa70/assetharbor/wiki)

A **VAST-native Media Asset Management (MAM)** system designed for Post-Production and VFX studios. AssetHarbor orchestrates VAST's core services—**VAST Database**, **VAST DataEngine**, and **VAST Event Broker**—to provide serverless media processing, durable event-driven workflows, and immutable metadata linking via element handles.

## Architecture

AssetHarbor is built on three core VAST services:

- **VAST Database (VastDB/Trino)** — persistent storage for assets, jobs, metadata, and audit logs
- **VAST DataEngine** — serverless media processing (exr_inspector, ASR, transcode) triggered automatically by VAST element events
- **VAST Event Broker** — Kafka-compatible streaming for DataEngine completion events and workflow coordination

**Processing flow:**

```
Artist ingest → POST /api/v1/assets/ingest
  → Asset record created in VastDB
  → File placed in VAST view (S3)
  → VAST element trigger fires (ElementCreated on *.exr / *.mov / audio)
  → VAST DataEngine runs registered pipeline
  → Results written to VastDB
  → VAST Event Broker publishes completion event
  → Control-plane VastEventSubscriber consumes event
  → Updates job status + asset metadata
  → Web UI approval queue reflects result
```

## Services

Three containerized deployables orchestrated via Docker Compose:

| Service | Tech | Port | Role |
|---------|------|------|------|
| `control-plane` | Fastify / TypeScript | 8080 | REST API, Kafka consumer, approval workflow, audit |
| `media-worker` | Python | — | DEV SIMULATION ONLY—local mock when no VAST cluster |
| `web-ui` | React / Vite | 4173 | Role-based UI (Operator, Coordinator, Supervisor) |

**Note:** In a production VAST environment, `media-worker` is not deployed. Processing is fully event-driven via VAST DataEngine and the Event Broker.

## Deployment Modes

**Production (VAST cluster available):**
- Set `ASSETHARBOR_PERSISTENCE_BACKEND=vast`
- Configure VAST endpoints (see Environment Variables below)
- `media-worker` service is optional (not deployed in docker-compose)
- Control-plane subscribes to VAST Event Broker for DataEngine completion events

**Development (local/no VAST cluster):**
- Set `ASSETHARBOR_PERSISTENCE_BACKEND=local`
- `media-worker` simulates VAST element triggers and DataEngine pipeline locally
- Posts mock CloudEvents to `POST /api/v1/events/vast-dataengine` for local testing

## Quick Start

1. Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

2. Set required environment variables (see below).

3. Build and start services:

```bash
docker compose up --build
```

4. Verify services are healthy:
   - API health: `http://localhost:8080/health`
   - Web UI: `http://localhost:4173`
   - API docs (Swagger): `http://localhost:8080/docs` (non-production only)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ASSETHARBOR_PERSISTENCE_BACKEND` | `local` | Persistence adapter: `local` (in-memory, dev) or `vast` (production) |
| `ASSETHARBOR_VAST_STRICT` | `false` | If true, fail hard at startup if VAST endpoints unavailable |
| `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` | `true` | If true, fall back to local adapter when VAST endpoints fail; if false, fail-fast |
| `ASSETHARBOR_API_KEY` | (empty) | Optional API key; if set, all POST endpoints require `x-api-key` header |
| `CONTROL_PLANE_API_KEY` | (empty) | API key for media-worker to call control-plane (in secured environments) |
| `VITE_API_KEY` | (empty) | API key for web-ui to call control-plane (in secured environments) |
| `VAST_DATABASE_URL` | (empty) | VAST Database (Trino REST API) endpoint, e.g., `https://vast-db.example/api` |
| `VAST_EVENT_BROKER_URL` | (empty) | VAST Event Broker (Kafka-compatible) endpoint, e.g., `https://vast-events.example/api` |
| `VAST_DATAENGINE_URL` | (empty) | VAST DataEngine REST API endpoint, e.g., `https://vast-engine.example/api` |
| `VAST_API_TOKEN` | (empty) | Authentication token for all VAST endpoints |

## API Routes

### Asset Management

- `POST /api/v1/assets/ingest` — Create new asset ingest job
- `GET /api/v1/assets` — List assets with current status

### Job Queue

- `GET /api/v1/jobs/pending` — Poll pending jobs (for media-worker)
- `GET /api/v1/jobs/:id` — Get full job state
- `POST /api/v1/queue/claim` — Claim a pending job (begin processing)
- `POST /api/v1/jobs/:id/heartbeat` — Extend worker lease
- `POST /api/v1/queue/reap-stale` — Requeue jobs with expired leases
- `POST /api/v1/jobs/:id/replay` — Replay failed job

### Dead Letter Queue

- `GET /api/v1/dlq` — List dead-lettered jobs (exhausted retries)

### Events

- `POST /api/v1/events` — Publish event (dev/test only)
- `POST /api/v1/events/vast-dataengine` — Receive simulated VAST DataEngine completion (local dev mode)

### Audit & Observability

- `GET /api/v1/audit` — Audit trail with correlation IDs
- `GET /api/v1/metrics` — Queue, job, DLQ, and outbox counters
- `GET /health` — Service health check

### Legacy Aliases

For backward compatibility with existing internal clients:

- `POST /assets/ingest` → `POST /api/v1/assets/ingest`
- `GET /assets` → `GET /api/v1/assets`
- `GET /jobs/pending` → `GET /api/v1/jobs/pending`
- `GET /jobs/:id` → `GET /api/v1/jobs/:id`
- `POST /events` → `POST /api/v1/events`
- `GET /audit` → `GET /api/v1/audit`

## Test Commands

```bash
npm run check:workspace          # Workspace preflight
npm run test:compose             # Docker Compose contract
npm run test:docs                # Documentation contract
npm run test:contracts           # API + event contracts
npm run test:control-plane       # Control-plane unit + integration
npm run test:worker              # Media-worker unit tests
npm run test:web-ui              # Web-UI component tests
npm run test:all                 # Full suite
```

## Security

- API key (`ASSETHARBOR_API_KEY`): protects POST endpoints
- Request correlation ID (`x-correlation-id`): propagated through all workflows and audit logs
- Service-to-service auth: use `CONTROL_PLANE_API_KEY` and `VITE_API_KEY` in secured deployments
- Audit trail (`GET /api/v1/audit`): all state changes logged with user, timestamp, and correlation ID

## CI/CD

- `ci.yml` — Validates Docker Compose config, docs, API/event contracts, and all service tests
- `cd.yml` — Builds and publishes container images to GHCR on `main` and semantic version tags
- Actions dashboard: `https://github.com/ssotoa70/assetharbor/actions`

## Documentation

For deeper architecture and operational guidance, see:

- **Architecture & Design:** [`docs/VAST_NATIVE_ARCHITECTURE.md`](docs/VAST_NATIVE_ARCHITECTURE.md) — comprehensive VAST-native system design
- **Operations Runbook:** [`docs/runbook.md`](docs/runbook.md) — deployment, troubleshooting, and SLO definitions
- **API Contracts:** [`docs/api-contracts.md`](docs/api-contracts.md) — OpenAPI schema and endpoint details
- **Event Contracts:** [`docs/event-contracts.md`](docs/event-contracts.md) — event types and payloads

## Contributing

1. Link documentation updates to related Linear issues.
2. Update wiki pages and matching `docs/wiki-2.0` mirror pages in same change.
3. Include docs impact notes in PR descriptions.
4. Verify all links before merge.
