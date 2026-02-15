# Degraded Mode Playbook

## Trigger Conditions

- Warning or critical fallback-event threshold breach.
- Sustained queue backlog with rising DLQ totals.
- Repeated `vast fallback` audit entries during release or steady state.

## Detection and Triage

1. Capture current `GET /api/v1/metrics` and `GET /api/v1/audit` snapshots.
2. Confirm whether fallback behavior is active and identify impacted workflows.
3. Classify impact level (warning vs critical) using threshold tables.

## Immediate Containment

- Freeze canary promotion.
- Assign incident commander and comms owner.
- Apply lowest-risk mitigation (traffic reduction, worker scale-up, rollback prep).

## Recovery Steps

1. Resolve primary failure source.
2. Re-run workflow verification (ingest -> queue -> events -> metrics).
3. Confirm thresholds return below warning level for 30 minutes.

## Exit Criteria

- No active critical alerts.
- Fallback events stabilize or decline.
- Incident summary posted with owner and follow-up actions.

## Post-Incident Notes

- Incident ID:
- Start/end UTC:
- Root cause:
- Mitigation summary:
- Follow-up tasks and owners:
