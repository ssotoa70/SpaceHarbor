# AssetHarbor Handoff (for Claude Code)

## Snapshot
- Date: 2026-02-24
- Repo path: `/Users/sergio.soto/opencode/AssetHarbor`
- Goal of this document: enable a new coding agent to continue development with minimal re-discovery.
- Source docs used as "original PRD" baseline:
  - `docs/plans/2026-02-12-assetharbor-design.md` (product/design requirements)
  - `docs/plans/2026-02-12-assetharbor-mvp-bootstrap.md` (delivery plan)

## What is built so far

### Runtime architecture in place
- Monorepo with 3 services wired in `docker-compose.yml`:
  - `control-plane` (Fastify/TypeScript)
  - `media-worker` (Python)
  - `web-ui` (React/Vite/TypeScript)
- CI/CD wiring and docs baseline exist (`README`, `runbook`, API/event contract docs, wiki seed docs).

### Control-plane capabilities implemented
- Health + OpenAPI + Swagger UI route support.
- Ingest flow (`POST /api/v1/assets/ingest` and legacy alias) creates asset + workflow job.
- Queue/job worker control endpoints:
  - claim, heartbeat lease, stale lease reap, replay.
- Event ingestion endpoint with canonical contract support (`/api/v1/events`) and legacy support (`/events`).
- Idempotency by `eventId` via processed-event tracking.
- Retry and DLQ behavior for failed events (`failed -> retry/pending or DLQ`).
- Outbox listing + publish endpoint.
- Audit feed and metrics endpoint.
- API key gate on write methods (`x-api-key`) when configured.
- Correlation ID propagation (`x-correlation-id`).

### Media-worker capabilities implemented
- Poll/claim loop against control-plane queue.
- Emits started/completed events and sends heartbeat for claimed jobs.
- Supports API key header for secured environments.

### Web UI capabilities implemented
- Queue-first operator page with:
  - ingest form,
  - asset queue/status table,
  - replay action for failed jobs,
  - recent audit list.

### Verification status (current)
- `npm run test:all` passes locally on 2026-02-24.
- Suites include compose/docs checks, API & event contracts, control-plane tests, worker tests, and web-ui tests.

## Important current state notes

### Working tree is not clean
At time of exploration, there are local uncommitted changes and untracked files in control-plane (not created by this handoff task), including:
- modified: `services/control-plane/src/app.ts`, `src/domain/models.ts`, `src/http/openapi.ts`, `src/persistence/types.ts`, `test/persistence-contract.test.ts`
- untracked: `src/integrations/`, `src/workflow/`, `test/outbound-config.test.ts`, `test/workflow-semantics.test.ts`

Treat these as in-progress branch work; do not assume `main` parity without checking.

### Known implementation gaps/risks (technical)
1. Persistence is still effectively in-memory.
- `VastPersistenceAdapter` currently delegates most behavior to `LocalPersistenceAdapter`.
- Restart durability and horizontal-safe concurrency are not yet production-ready.

2. Startup reset behavior is destructive.
- `buildApp()` calls `persistence.reset()` on startup.
- This wipes runtime state every process start.

3. Outbox order is reversed.
- Local adapter enqueues with `unshift` (LIFO), which can publish newer events before older ones.

4. Worker loop resilience is minimal.
- `run_forever()` has no exception handling/recovery logic around network failures.

5. Contract drift is emerging.
- Domain now includes QC statuses (`qc_pending`, `qc_in_review`, `qc_approved`, `qc_rejected`) but API schema enum in `http/schemas.ts` still exposes only the original 5 statuses.
- This can break OpenAPI/contract fidelity as QC transitions are expanded.

## Original PRD requirements and current status
(Based on `docs/plans/2026-02-12-assetharbor-design.md`)

1. Asset ingest registration
- Status: Implemented (MVP baseline).
- Evidence: ingest routes + tests.

2. Metadata CRUD and searchable listing/filtering
- Status: Partially implemented.
- Current: basic list (`GET /assets`), no full metadata CRUD/search/filter model.

3. Workflow/job tracking with event-driven updates
- Status: Implemented (MVP baseline).
- Current: queue claim/heartbeat/reap/replay, events, retries, DLQ.

4. Approval panel and basic RBAC
- Status: Not implemented as product workflow.
- Current: API key gate exists, but no role model, no approval workflow surfaces in UI/API.

5. Media preview via proxy outputs
- Status: Partially scaffolded only.
- Current: model fields for `thumbnail`/`proxy` exist, but no end-to-end generation/storage/serving flow.

6. Audit trail visibility
- Status: Implemented baseline.
- Current: audit events endpoint + UI panel.

7. VAST-native backend integrations (DB, broker, data engine)
- Status: Partially scaffolded.
- Current: env/config + event broker publish attempt; DB/data-engine durability path not fully implemented.

## Pending workstreams (recommended)

1. Persistence hardening (highest priority)
- Remove startup `reset()` in non-test runtime.
- Convert persistence contract to async-safe shape if needed for real backend I/O.
- Implement durable VAST/DB adapter for assets/jobs/queue/dlq/outbox/audit/idempotency.
- Add atomic claim semantics for multi-worker safety.

2. Reliability hardening
- Fix outbox ordering (`push`/FIFO semantics).
- Add bounded retention/cleanup policy for audit/outbox/idempotency store.
- Add worker exception handling + retry/backoff around transport failures.
- Add compose healthchecks + restart policies.

3. Contract and schema consistency
- Reconcile workflow status model vs OpenAPI schemas and tests.
- Unify behavior differences between legacy and `/api/v1` event processing where intentional.
- Keep docs (`api-contracts.md`, `event-contracts.md`) synced with true runtime behavior.

4. Security & auth progression
- Move beyond static API key to role-aware auth (at minimum role claims + route guards).
- Avoid browser-exposed secrets model for privileged actions.
- Add signing/auth for outbound broker/webhook integrations.

5. Product scope completion from PRD
- Metadata CRUD and query/filter UX/API.
- Approval workflow and RBAC-aware UI affordances.
- Preview/proxy materialization flow and UI exposure.

6. Observability and operations
- Enable structured logging in control-plane and worker.
- Emit basic latency/error counters beyond current aggregate metrics.
- Expand runbook with incident diagnostics for persistence/broker failures.

## Suggested next execution plan for Claude Code

1. Stabilize branch and contract baseline
- Confirm target branch and whether in-progress local files should be included.
- Run: `npm run test:all`.
- Add a focused "contract drift" task for status enum/schema parity.

2. Land safety fixes with low blast radius
- Remove/guard startup `persistence.reset()`.
- Fix outbox insertion ordering.
- Add worker top-level exception handling with controlled sleep/retry.
- Add/adjust tests for each change.

3. Implement durable persistence slice
- Start with one vertical slice: ingest -> claim -> completed event -> list assets survives restart.
- Keep current route surface stable while swapping adapter internals.

4. Complete PRD product gaps incrementally
- Metadata read/write + filter first.
- Approval/RBAC workflow next.
- Preview/proxy fields then worker/data-engine integration.

5. Keep docs and contracts in lockstep
- Update API/event docs and OpenAPI contract tests in same PR for every route/status change.

## Fast start commands for next agent
- `cd /Users/sergio.soto/opencode/AssetHarbor`
- `git status --short`
- `npm run test:all`
- `npm --prefix services/control-plane test -- test/openapi-contract.test.ts`
- `npm --prefix services/control-plane test -- test/phase2-workflow.test.ts`

## Key files to inspect first
- `services/control-plane/src/app.ts`
- `services/control-plane/src/persistence/types.ts`
- `services/control-plane/src/persistence/adapters/local-persistence.ts`
- `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- `services/control-plane/src/routes/events.ts`
- `services/control-plane/src/http/schemas.ts`
- `services/media-worker/worker/main.py`
- `docs/plans/2026-02-12-assetharbor-design.md`
