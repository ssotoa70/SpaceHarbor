# SpaceHarbor — CLAUDE.md

## Project Overview

**SpaceHarbor** is a VAST-native Media Asset Management platform for post-production and VFX studios. It provides asset ingest, metadata extraction, proxy generation, approval workflows, and VFX hierarchy management (projects/sequences/shots/versions).

**Status:** Phase 4.4 (Documentation) — Core features functional, security hardening and VAST integration in progress.

## Tech Stack

- **Control-Plane:** Fastify (TypeScript, tsx runtime, no build step)
- **Web-UI:** React 18 + Vite + TypeScript + Tailwind CSS v4
- **Media Worker:** Python (asyncio, VAST client libraries)
- **Persistence:** VAST Database (Trino), local in-memory fallback
- **Events:** VAST Event Broker (Kafka, Confluent client)
- **Deployment:** Docker Compose (dev), Kubernetes (production)

## Quick Start

### Prerequisites

- Node.js 18+ (npm 9+)
- Python 3.11+ (pipenv or venv)
- Docker + Docker Compose (for integration tests)

### Run Locally

```bash
# Control-plane: start Fastify server (auto-reloads on changes)
cd services/control-plane
npm ci
npm run dev          # port 3000

# Web-UI: start Vite dev server (in another terminal)
cd services/web-ui
npm ci
npm run dev          # http://localhost:4173

# Media worker (optional, for local dev simulation)
cd services/media-worker
pip install -r requirements.txt
python main.py       # polls control-plane job queue

# Run tests
cd services/control-plane
npm test             # unit tests
npm run test:contracts   # contract tests
npm run test:integration # requires docker-compose.test.yml up
```

## Project Structure

```
services/
├── control-plane/      # Fastify HTTP server + VAST integration
│   ├── src/
│   │   ├── routes/     # 30+ API route modules
│   │   ├── persistence/ # Adapter pattern for Local/VAST/Mock backends
│   │   ├── iam/        # Auth, RBAC, feature flags
│   │   ├── data-engine/ # Function registry + wrappers
│   │   └── db/         # Trino client + SQL migration tools
│   ├── test/           # Unit + integration tests
│   ├── ARCHITECTURE.md # Detailed design guide
│   └── package.json
├── web-ui/             # React SPA (Vite)
│   ├── src/
│   │   ├── pages/      # 25+ page components
│   │   ├── api.ts      # Centralized API client
│   │   ├── types.ts    # Shared TypeScript interfaces
│   │   └── boards/     # Role-based dashboard layouts
│   ├── test/           # Vitest tests
│   ├── ARCHITECTURE.md # Component & routing guide
│   └── package.json
└── media-worker/       # Python async job executor (dev-only)
    ├── main.py
    ├── worker/
    └── tests/

docs/
├── plans/              # Execution plans & gap analyses
│   └── 2026-03-22-gap-analysis-and-execution-plan.md
└── archive/            # Old planning docs
```

## Key Architectural Decisions

- **Persistence Adapter Pattern** (`services/control-plane/src/persistence/types.ts`): All data operations are abstracted behind an interface, enabling Local/Mock/VAST swapping without route changes.
- **Feature Flags** (`src/iam/feature-flags.ts`): IAM system is opt-in with shadow/enforcement modes for safe rollout.
- **Event-Driven**: VAST Event Broker (Kafka) triggers job status updates; HTTP streaming provides real-time web-UI updates.
- **No Build Step**: Control-plane runs TypeScript directly via `tsx` CLI.
- **TypeScript Everywhere**: Shared types in web-UI and control-plane.

## Common Tasks

### Add a New API Route

1. Create `services/control-plane/src/routes/my-feature.ts` with `registerMyFeatureRoute()` function
2. Register in `app.ts` line ~278: `void registerMyFeatureRoute(app, persistence, prefixes);`
3. Write unit test in `test/routes.test.ts`
4. Add OpenAPI schema via `@fastify/swagger` tags

See `services/control-plane/ARCHITECTURE.md` for detailed example.

### Add a New Web Page

1. Create `services/web-ui/src/pages/MyPage.tsx` with React component
2. Add fetch function to `src/api.ts` (or use sample data fallback)
3. Add types to `src/types.ts`
4. Link from `App.tsx` or a board component
5. Write test in `test/pages/MyPage.test.tsx`

See `services/web-ui/ARCHITECTURE.md` for detailed example.

### Run Database Migrations

```bash
# Requires VAST_DATABASE_URL set
cd services/control-plane
npm run db:install   # Executes SQL migrations against Trino
```

## Git Discipline

As you work on this project, follow strict git discipline:

- **Commits**: Clean, logical, revert-friendly
- **Staging**: Only relevant files per task — no `git add .`
- **Messages**: Use prefix (`feat:`, `fix:`, `docs:`, `test:`) + clear purpose
- **Branches**: Feature branches, PR reviews required before merge to main
- **Checkpoints**: Create `checkpoint:` commits at milestone boundaries for safe integration

## Important References

- **Execution Plan:** `docs/plans/2026-03-22-gap-analysis-and-execution-plan.md` (Phase analysis, open tasks, risks)
- **Control-Plane Architecture:** `services/control-plane/ARCHITECTURE.md` (routes, persistence, IAM, testing)
- **Web-UI Architecture:** `services/web-ui/ARCHITECTURE.md` (pages, API pattern, testing)
- **API Contracts:** `docs/api-contracts.md` (endpoint documentation)
- **Deployment:** `docs/deployment-guide.md` (production setup)

## Security Notes

- **IAM disabled by default** — enable with `SPACEHARBOR_IAM_ENABLED=true` for production
- **Shadow mode enabled by default** — set `SPACEHARBOR_IAM_SHADOW_MODE=false` to enforce RBAC
- **JWT secret required** — must set `SPACEHARBOR_JWT_SECRET` in production (not in env defaults)
- **API key enforcement** — optional via `SPACEHARBOR_API_KEY` or `SPACEHARBOR_API_KEYS`

