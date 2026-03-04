# SERGIO-62 Slice 3 Dependency Readiness Visibility Design

## Context

SERGIO-62 Slice 1 and Slice 2 delivered:

- additive `productionMetadata` on assets read models
- role-based Operator/Coordinator/Supervisor boards
- client-side search/filter/aging for coordinator and supervisor views

Remaining SERGIO-62 scope includes bulk-safe actions and dependency visibility for handoff management. This slice targets dependency visibility first to minimize risk and reduce decision overhead.

## Goal

Deliver read-only dependency readiness visibility in coordinator and supervisor views using existing queue data, with no backend/API contract changes.

## Scope Boundaries

In scope:

- Add deterministic dependency-readiness derivation in web UI.
- Show readiness state and blocker reasons in CoordinatorBoard and SupervisorBoard.
- Add readiness and reason filters in coordinator view.
- Add readiness and blocker-reason summary in supervisor view.
- Keep existing app-shell fetch path and contracts unchanged.

Out of scope:

- bulk replay or bulk state mutation actions
- server-side dependency graph endpoints
- persisted dependency edges/advanced graph traversal
- metadata authoring/update APIs

## Chosen Approach

Use client-derived readiness rules (Option B, read-only first):

- derive readiness from existing `AssetRow` + `productionMetadata` + status + aging
- apply pure utility functions, then render in role boards

Rationale:

- lowest-risk path with no contract churn
- minimal required user interaction/decisioning
- strong fit with existing role-board architecture and shared utility layer

## Architecture

Add a pure utility module under `services/web-ui/src/queue/` for dependency readiness:

- `deriveDependencyReadiness(row)`
- readiness summary aggregation helpers for supervisor
- filter helper for readiness/reason selection

CoordinatorBoard:

- new readiness column (`Ready` / `Blocked`)
- blocker reason chips per row
- quick filters: ready-only, blocked-only, by specific reason

SupervisorBoard:

- summary counts: ready vs blocked
- blocker reason distribution summary
- keep existing compact queue view and aging cues

OperatorBoard:

- no behavior changes in this slice

## Dependency Readiness Rule Set (Deterministic v1)

Blocked reasons:

- `missing_owner`
- `missing_priority`
- `missing_due_date`
- `aged_critical`
- `status_not_actionable`

Actionable status set for this slice:

- `pending`
- `failed`
- `needs_replay`

Derived shape:

- `isReady: boolean`
- `reasons: DependencyReason[]`
- `severity: "info" | "warning" | "critical"`

Severity policy:

- `critical` if `aged_critical` is present
- `warning` if blocked without critical aging
- `info` if ready

## UX and State Behavior

- Distinguish "no assets" from "no filter matches" states.
- Keep role selection/query-string behavior unchanged.
- Keep filter state local to each board and resettable.
- Use explicit text labels for readiness and reason chips; no color-only semantics.

## TDD and Testing Strategy

TDD discipline per change:

1. write failing test first (RED)
2. run target test to confirm failure
3. implement minimal code (GREEN)
4. rerun tests
5. refactor while staying green

Add tests:

- `services/web-ui/src/queue/dependency-readiness.test.ts`
  - ready path
  - each blocker reason
  - multi-reason aggregation and deterministic output
  - actionable status include/exclude behavior
- `services/web-ui/src/boards/CoordinatorBoard.test.tsx`
  - readiness column and reason chips
  - readiness/reason filters and reset behavior
  - empty state for no matching rows
- `services/web-ui/src/boards/SupervisorBoard.test.tsx`
  - ready/blocked summary counts
  - blocker reason distribution

Regression tests:

- `services/web-ui/src/App.test.tsx` role switching still intact
- `services/web-ui/src/boards/OperatorBoard.test.tsx` remains unchanged behavior

Verification commands:

- `npm --prefix services/web-ui test -- src/queue/dependency-readiness.test.ts src/boards/CoordinatorBoard.test.tsx src/boards/SupervisorBoard.test.tsx`
- `npm --prefix services/web-ui test`
- `npm run test:web-ui`
- `npm run test:all`
- `npm run check:workspace`

## Acceptance Criteria (Slice 3)

- Coordinator and Supervisor views show dependency readiness per queue item.
- Blocked rows expose deterministic reason chips from the v1 rule set.
- Coordinator supports filtering by readiness and blocker reason.
- Supervisor shows ready/blocked totals and blocker-reason distribution.
- No backend/API contract changes are introduced.
- Operator workflow remains unchanged.

## Deferred to Slice 4

- bulk-safe replay/state change actions (bulk actions deferred to Slice 4)
- server-side dependency endpoints
- persisted dependency graph model
- advanced graph traversal/visualization
- RBAC action gating refinements
