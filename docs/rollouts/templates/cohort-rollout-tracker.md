# Cohort Rollout Tracker Template

Use one row per project participating in the cohort rollout window.

Allowed status values:

`not_started | ready | in_pilot | go_live_ready | live | rolled_back`

| project_key | project_name | cohort | environment | ops_owner | service_owner | oncall_contact | status | pilot_window_utc | cutover_window_utc | rollback_trigger_summary | rollback_runbook_ref | project_record_ref | change_ref | incident_ref | last_updated_utc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRJ-001 | Example Project | 2026-Q1-A | production | @ops-owner | @service-owner | @oncall | ready | 2026-03-18T14:00Z-2026-03-18T18:00Z | 2026-03-20T15:00Z-2026-03-20T17:00Z | error budget burn >2x baseline for two checks | docs/runbooks/release-day-checklist.md#rollback-plan | docs/rollouts/projects/prj-001-rollout.md | PR #000 / v0.0.0 | INC-000 (optional) | 2026-03-18T12:00:00Z |

## Usage Notes

- Keep this tracker in the same PR as release readiness changes when possible.
- Always link to the per-project signoff record in `project_record_ref`.
- Never mark `live` unless the project signoff record contains both required owner signatures.
