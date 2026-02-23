# SERGIO-62 Slice 4 Bulk-Safe Replay Actions Design

## Context

SERGIO-62 Slice 1 through Slice 3 delivered:

- additive production metadata on `GET /api/v1/assets`
- role-based operational boards (Operator/Coordinator/Supervisor)
- client-side queue search/filter/aging
- read-only dependency readiness visibility and blocker reasons

The remaining SERGIO-62 scope includes bulk-safe actions. This slice delivers replay-only bulk actions first, using existing APIs, to keep risk low and throughput high.

## Goal

Enable Coordinator and Supervisor users to run safe, replay-only bulk actions for eligible rows, with explicit preflight checks and deterministic per-item outcome reporting.

## Scope Boundaries

In scope:

- Bulk replay actions in CoordinatorBoard and SupervisorBoard.
- Eligibility gating based on status + dependency readiness.
- Preflight summary with eligible/blocked counts and reasons.
- Sequential execution with strict max batch cap.
- Per-item result reporting (`replayed`, `failed`, `skipped`).

Out of scope:

- Bulk status mutation beyond replay.
- New backend batch endpoints.
- Backend dependency graph model/endpoints.
- Advanced approval/RBAC policy workflows.

## Chosen Approach

Implement a UI-level bulk orchestrator that calls existing single-item replay endpoint per eligible row.

Rationale:

- preserves current API contracts
- avoids new backend complexity and policy decisions
- provides immediate operational speed-up with bounded risk

## Architecture

Add shared bulk replay utility in web UI queue layer:

- classify selected rows as eligible vs blocked
- enforce max batch size (25)
- execute replay calls sequentially
- stop immediately on rate-limit (`429`)
- record deterministic per-item results

UI integration:

- CoordinatorBoard and SupervisorBoard gain:
  - multi-select controls
  - bulk action panel
  - preflight summary
  - confirm-to-run action
  - results panel and retry-failed option

OperatorBoard remains unchanged.

## Bulk Safety Rules

Eligibility criteria for replay execution:

- `jobId` present
- `status` in `failed` or `needs_replay`
- `dependencyReadiness.ready === true`

Execution rules:

- max 25 rows per run
- sequential processing only
- stop on `429` rate-limit response
- continue across non-`429` failures and capture outcomes

Outcome model per row:

- `replayed`
- `failed`
- `skipped`

Each outcome includes reason/message and status code where available.

## UX Behavior

- Bulk panel appears only when rows are selected.
- Preflight must show exact counts:
  - selected
  - eligible
  - blocked (with grouped reasons)
- Confirm action required before execution starts.
- Post-run view includes:
  - aggregate summary counts
  - detailed per-row outcomes
  - quick action: retry failed only
  - clear selection

Accessibility:

- selection controls with labels
- confirmation and results announced via existing live-region conventions
- outcome indicators include explicit text labels, not color-only state

## TDD and Testing Strategy

TDD cycle per behavior:

1. write failing test first (RED)
2. run target command and confirm failure
3. implement minimal code (GREEN)
4. rerun tests
5. refactor with tests still green

Add tests:

- new utility tests for bulk replay orchestration and safety rules
- coordinator board tests for selection/preflight/execute/results flows
- supervisor board tests for same behavior in supervisor context
- non-regression checks for role switching and existing readiness/filter behaviors

Verification commands:

- `npm --prefix services/web-ui test -- src/queue/bulk-replay.test.ts src/boards/CoordinatorBoard.test.tsx src/boards/SupervisorBoard.test.tsx`
- `npm --prefix services/web-ui test`
- `npm run test:web-ui`
- `npm run test:all`
- `npm run check:workspace`

## Acceptance Criteria (Slice 4)

- Coordinator and Supervisor can multi-select rows and run replay-only bulk actions.
- Only eligible rows (`failed`/`needs_replay` + dependency-ready) execute.
- Preflight clearly reports eligible/blocked counts and reasons.
- Execution is sequential, capped at 25, and halts on `429`.
- Results show deterministic per-row outcomes and messages.
- No backend/API contract changes are introduced.

## Deferred to Slice 5+

- bulk status mutation beyond replay
- backend batch replay endpoint
- persisted dependency graph and server-side traversal
- advanced approval/RBAC action policy controls
