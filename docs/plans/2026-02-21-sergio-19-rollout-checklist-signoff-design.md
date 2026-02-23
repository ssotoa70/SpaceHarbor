# SERGIO-19: Project-by-Project Rollout Checklist and Signoff Design

## Scope

- Deliver docs + lightweight in-repo tracking artifacts.
- No backend/UI implementation in this ticket.

## Deliverables

- `docs/rollouts/templates/cohort-rollout-tracker.md`
- `docs/rollouts/templates/project-rollout-signoff.md`
- Link integration in:
  - `docs/wiki-2.0/Release-Process.md`
  - `docs/runbooks/release-day-checklist.md`
  - `docs/runbook.md`

## Tracking Model

- Cohort tracker: one row per project, links to project signoff record and evidence refs.
- Project signoff record: pilot entry/exit, cutover decision, rollback matrix/log, and owner signoff.

Allowed status values:

- `not_started`
- `ready`
- `in_pilot`
- `go_live_ready`
- `live`
- `rolled_back`

## Acceptance Mapping

- Checklist includes pilot, cutover, rollback, owner signoff: covered by project template sections.
- Supports cohort enablement/tracking: covered by cohort tracker table + status model.
- Linked from deployment/rollout runbooks: covered by runbook/release-process updates.
