# Degraded Mode Playbook

## Trigger Conditions

- Warning or critical fallback-event threshold breach.
- Sustained queue backlog with rising DLQ totals.
- Repeated `vast fallback` audit entries during release or steady state.

## Detection and Triage

1. Capture current `GET /api/v1/metrics` and `GET /api/v1/audit` snapshots.
2. Confirm whether fallback behavior is active and identify impacted workflows.
3. Classify impact level (warning vs critical) using threshold tables.
4. Read current shared incident state from `GET /api/v1/incident/coordination`.

## Immediate Containment

- Freeze canary promotion.
- Assign incident commander and comms owner.
- Apply lowest-risk mitigation (traffic reduction, worker scale-up, rollback prep).
- Record containment owner/escalation updates with `PUT /api/v1/incident/coordination/actions`.
- Post a timeline note with `POST /api/v1/incident/coordination/notes` using the active incident correlation ID.

## Recovery Steps

1. Resolve primary failure source.
2. Re-run workflow verification (ingest -> queue -> events -> metrics).
3. Confirm thresholds return below warning level for 30 minutes.
4. If shift ownership changes, set `PUT /api/v1/incident/coordination/handoff` to `handoff_requested`, then `handoff_accepted` when transfer completes.
5. Post final recovery and ownership note with `POST /api/v1/incident/coordination/notes`.

## Exit Criteria

- No active critical alerts.
- Fallback events stabilize or decline.
- Incident summary posted with owner and follow-up actions.

## Post-Incident Notes

- Incident ID:
- Correlation ID(s):
- Start/end UTC:
- Root cause:
- Mitigation summary:
- Follow-up tasks and owners:
