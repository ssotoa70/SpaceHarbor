# SERGIO-63 Slice 1: Review/QC States and Approval Gates Design

## Context

SERGIO-63 introduces postproduction review/QC workflow value. This first slice focuses on workflow lifecycle correctness and operator visibility by adding review/QC states and approval gates before external integrations.

Current state supports: `pending`, `processing`, `completed`, `failed`, `needs_replay`.

## Scope (Slice 1)

- Add additive review/QC statuses to workflow lifecycle.
- Add explicit transition guards for gate-driven movement.
- Accept and process review/QC transition events via existing event pipeline.
- Render new statuses and gate actions in the UI.
- Preserve existing API envelopes and endpoint shapes.

## Out of Scope (Deferred)

- Slack/Teams notification delivery.
- ShotGrid/ftrack-style outbound integration adapters.
- Annotation storage/authoring and media comment timeline.
- Proxy/thumbnail generation implementation details.

## Goals

- Make review lifecycle first-class in workflow status model.
- Keep contract changes additive and low-risk.
- Maintain strict transition integrity and audit traceability.
- Keep replay semantics compatible with existing endpoint behavior.

## Proposed Status Model

Add statuses:

- `qc_pending`
- `qc_in_review`
- `qc_approved`
- `qc_rejected`

Lifecycle intent:

- Processing completion path: `processing -> completed -> qc_pending -> qc_in_review -> qc_approved`
- Rejection path: `qc_in_review -> qc_rejected -> needs_replay`
- Replay path remains `needs_replay` or `failed` to `pending` via replay endpoint.

## Transition Rules

Transition guard updates will allow only explicit movement, including:

- `completed -> qc_pending`
- `qc_pending -> qc_in_review`
- `qc_in_review -> qc_approved`
- `qc_in_review -> qc_rejected`
- `qc_rejected -> needs_replay`

Forbidden transitions (examples):

- `pending -> qc_in_review`
- `processing -> qc_approved`
- `qc_approved -> processing`

All invalid transitions continue to return deterministic unified error envelopes.

## Event and API Contract Strategy

Use existing event endpoint flow and extend accepted event types additively for review/QC progression. Status enum expansion is additive in schemas/OpenAPI and should not break existing clients.

Compatibility rules:

- Existing clients sending legacy events continue functioning.
- Existing list/read endpoints return expanded status values.
- Unknown future statuses in UI should render as neutral fallback text.

## UI/UX Strategy

Update queue/role views to:

- Render review/QC statuses with clear badges.
- Expose gate-specific actions by role (coordinator/supervisor).
- Keep actions safe and explicit (no hidden auto-transitions).

Initial gate action examples:

- Move completed item to QC queue (`completed -> qc_pending`).
- Start review (`qc_pending -> qc_in_review`).
- Approve (`qc_in_review -> qc_approved`).
- Reject with reason (`qc_in_review -> qc_rejected`).

## Data and Audit Semantics

- Reuse current persistence model; no separate review aggregate in Slice 1.
- Audit records capture each gate transition with correlation ID.
- Rejection reason should be stored in `lastError`/message-compatible channel for now to avoid schema churn.

## Risk and Mitigations

Primary risks:

- State-machine regressions from expanded transition matrix.
- UI assumptions about terminal states.
- Event compatibility drift across endpoints.

Mitigations:

- Transition table tests for allowed/forbidden paths.
- Contract tests for schema enum updates and endpoint stability.
- UI tests for role-gated actions and fallback rendering.

## Testing Plan

- Unit: transition guard matrix for all new statuses.
- Event processor: mapping and idempotent behavior for review/QC events.
- Route/contract: status enum exposure, validation errors, OpenAPI updates.
- UI: status badge rendering and gate action visibility/flows.
- End-to-end verification: `npm run test:all` + `npm run check:workspace`.

## Acceptance Criteria (Slice 1)

- New review/QC statuses available end-to-end in API responses.
- Valid review gate transitions succeed; invalid transitions are blocked.
- UI displays and operates review/QC gates for intended roles.
- Existing workflows (ingest, processing, replay) continue to pass current test suite.
