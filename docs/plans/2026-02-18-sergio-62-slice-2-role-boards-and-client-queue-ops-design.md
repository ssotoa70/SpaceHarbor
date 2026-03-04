# SERGIO-62 Slice 2 Role Boards and Client Queue Ops Design

## Context

SERGIO-62 Slice 1 delivered additive queue metadata exposure on `GET /api/v1/assets` with contract-safe guardrails. The next increment should improve day-to-day coordinator and supervisor usability without backend contract churn.

User direction for Slice 2:

- UI/read-only only for now
- metadata write/update APIs deferred to a later slice
- prefer stronger UI separation (Option 2) even with higher implementation cost

## Goal

Deliver role-specific operational views (Operator, Coordinator, Supervisor) with client-side queue search/filter/aging while preserving existing backend contracts.

## Scope Boundaries

In scope:

- Split UI into role-oriented board components.
- Add role/view switching in app shell.
- Add client-side queue search/filter capabilities for coordinator and supervisor workflows.
- Add deterministic aging derivation and supervisor summary indicators.
- Keep operator baseline workflows intact (including replay path).

Out of scope:

- New backend endpoints.
- Metadata write/update APIs.
- Server-side filtering/search.
- Bulk-safe actions.
- Dependency visibility and handoff graph features.

## Chosen Approach

Use Option 2: explicit role board components with a shared app shell and shared client-side derivation utilities.

Rationale:

- better separation of concerns and safer long-term maintenance
- cleaner boundaries for future role hardening and eventual auth alignment
- lower risk of accidental cross-role behavior coupling

## Architecture

App shell remains the single route and owns refresh orchestration:

- fetches assets/audit/metrics/incident coordination
- stores shared state and freshness indicators
- hosts role selector and board mounting

Board components (read-only presentation logic):

- `OperatorBoard`: preserves action-centric operations and replay affordance
- `CoordinatorBoard`: triage-oriented queue view with search/filter controls
- `SupervisorBoard`: summary-first oversight with aging/status distribution and condensed queue

Shared utility layer (pure functions):

- queue row normalization and role-ready projections
- searchable index text derivation from row + metadata
- filter application and sorting
- aging derivation (`fresh`, `warning`, `critical`) from available timestamps

## Data Flow and Role Behavior

Shared source data:

- `GET /api/v1/assets`
- existing audit/metrics/coordination APIs already in app shell

Derived client model (`QueueViewModel`) per row includes:

- base asset fields
- metadata aliases for role displays
- searchable text index
- aging metrics and badge state

Role-specific behavior:

- Operator: keep existing queue actionability and incident context
- Coordinator: default urgency-centric ordering + status/priority/owner/vendor filters + free-text search
- Supervisor: summary cards (status/aging/priority counts) + compact escalation table

State handling:

- role selection persisted in query string for safe reload/sharing
- board filters local to each board, with explicit reset controls

## Error Handling and Accessibility

Error handling:

- refresh failures preserve last known good board state
- shell-level stale/refresh indicator remains source of truth
- boards distinguish between "no data" and "no matches"

Accessibility:

- role selector implemented with keyboard-accessible semantics (tabs/radiogroup pattern)
- labeled filter controls and semantic table headers
- non-color-only status/aging/priority indicators
- maintain existing health live-region behavior

## Testing Strategy

Web UI tests should cover:

- role switching behavior and persisted selection
- coordinator and supervisor filter/search behavior
- aging derivation edge cases and summary bucket correctness
- operator regression behavior (ingest/replay visibility and controls intact)

Utility tests should cover:

- search index composition
- filter combinations
- aging thresholds and deterministic bucketing

Verification commands:

- `npm --prefix services/web-ui test`
- `npm run test:web-ui`
- `npm run test:all`
- `npm run check:workspace`

## Acceptance Criteria (Slice 2)

- Operator, Coordinator, Supervisor views are selectable in app shell.
- Coordinator and Supervisor views provide client-side search/filter over queue data.
- Aging indicators and supervisor summaries render deterministic results.
- Operator workflow remains intact with replay affordance and existing operational panels.
- No backend/API contract changes are introduced.
- Web UI tests cover role switching, filtering, aging derivation, and operator regressions.

## Deferred Follow-On Slices

- Metadata authoring/update APIs.
- Server-side filtering/search APIs.
- Bulk-safe operations.
- Dependency visibility/handoff dependency graph.
- RBAC enforcement beyond presentation-level role boards.
