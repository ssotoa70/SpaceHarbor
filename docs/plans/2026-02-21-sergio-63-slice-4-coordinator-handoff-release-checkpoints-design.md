# SERGIO-63 Slice 4: Coordinator Handoff, Release Templates, and Verification Checkpoints Design

## Context

Slices 1-3 delivered review/QC lifecycle, preview/annotation readiness metadata, and webhook outbound integrations. Slice 4 closes SERGIO-63 by improving coordinator handoff execution with explicit release-readiness checkpoints and communication templates.

## Selected Approach

Use an in-place coordinator handoff workflow overlay on the existing queue view (recommended path), rather than creating a separate board.

Why:

- Lowest UX disruption and delivery risk.
- Keeps coordinator work in the same operational surface.
- Enables explicit handoff quality gates without workflow-state churn.

## Scope (Slice 4)

- Add coordinator-focused handoff metadata fields (additive, optional).
- Add handoff checklist and readiness gating in UI for `qc_approved` assets.
- Add release communication templates (promotion, rollback, post-release note).
- Add post-release verification checkpoints and references in docs/UI.

## Out of Scope

- New backend terminal workflow status for handoff/release.
- Automatic Slack/Teams message sending from templates.
- Full release orchestration engine.

## Data Model (Additive)

Add optional metadata on queue/job read surfaces:

- `handoffChecklist`:
  - `releaseNotesReady: boolean`
  - `verificationComplete: boolean`
  - `commsDraftReady: boolean`
  - `ownerAssigned: boolean`
- `handoff`:
  - `status: "not_ready" | "ready_for_release"`
  - `owner: string | null`
  - `lastUpdatedAt: string | null`

Defaults for existing items:

- checklist flags `false`
- `status: "not_ready"`
- `owner: null`
- `lastUpdatedAt: null`

## Coordinator UX

In queue rows where status is `qc_approved`:

- show handoff panel with checklist toggles and owner entry.
- compute release readiness from checklist + owner presence.
- enable `Mark release-ready` action only when fully satisfied.
- show blocking reason text when action is disabled.

Non-coordinator roles keep existing workflow actions and do not receive handoff controls.

## Release Communication Templates

Ship static templates in docs and surface snippets in UI:

- Promotion announcement template
- Rollback notice template
- Post-release verification completion template

Templates remain copy-first (no direct dispatch in Slice 4).

## Post-Release Verification Checkpoints

Add standardized checkpoint sections:

- T+15m checks (health, queue behavior, error trends)
- T+60m checks (SLO budget, fallback trend, audit anomalies)
- explicit rollback trigger confirmation

UI links to these checkpoints from handoff panel.

## API and Contract Strategy

- Keep endpoint set unchanged.
- Extend response schemas additively with optional handoff metadata.
- Preserve backward compatibility for existing clients.

## Risks and Mitigations

Risks:

- UI complexity in queue table.
- Ambiguous handoff ownership conventions.
- Partial checklist data causing inconsistent readiness display.

Mitigations:

- Keep handoff panel compact and scoped to `qc_approved` rows.
- Enforce deterministic readiness rule in one helper function.
- Add tests for all gating branches and defaults.

## Testing Strategy

- Control-plane tests for additive metadata defaults and schema exposure.
- OpenAPI/contract tests for optional handoff fields.
- Web UI tests for:
  - coordinator-only handoff visibility
  - readiness gating behavior
  - disabled reason text when incomplete
- Docs tests for new template/checkpoint sections.
- Full verification: `npm run test:all`.

## Acceptance Criteria

- Coordinator can complete handoff checklist in UI for `qc_approved` assets.
- Release-ready action only unlocks when all checklist requirements are met.
- Communication templates and checkpoint guidance are available and linked.
- Existing workflow behavior and contracts remain stable.
