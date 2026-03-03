# Operations Runbook

## Startup

- `docker compose up --build`

## Health checks

- `GET /health`

## Recovery baseline

- Inspect job status via `/api/v1/jobs/:id`.
- Inspect dead-letter jobs via `/api/v1/dlq`.
- Replay failed jobs via `/api/v1/jobs/:id/replay`.
- Requeue stale processing leases via `/api/v1/queue/reap-stale`.
- Inspect workflow counters via `/api/v1/metrics`.

## VAST mode policy

- `ASSETHARBOR_VAST_STRICT=true` + `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=false` runs strict fail-fast mode.
- `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=true` enables fallback continuity mode.
- Verify fallback usage by checking `/api/v1/audit` for `vast fallback` entries.

## Alert Thresholds

| Signal | Warning | Critical | Action |
| --- | --- | --- | --- |
| `degradedMode.fallbackEvents` increase | >=5 in 10 minutes | >=20 in 10 minutes | Trigger degraded-mode playbook |
| `queue.pending` backlog | >50 for 15 minutes | >150 for 15 minutes | Scale workers and review upstream traffic |
| `dlq.total` growth | +3 in 15 minutes | +10 in 15 minutes | Pause canary and evaluate rollback |

## Ownership and Escalation Matrix

| Incident class | Primary | Secondary | Escalate to | SLA |
| --- | --- | --- | --- | --- |
| Warning alerts | On-call operator | Service owner | Engineering manager | 30 minutes |
| Critical alerts | Service owner | Incident commander | Director on-call | 15 minutes |
| Security or data risk | Incident commander | Security lead | Executive on-call | Immediate |

## Canary Rollback Triggers

- Critical threshold breach that remains after one mitigation cycle.
- Two consecutive health checks with SLO burn rate >2x baseline.
- Any verified data integrity regression in ingest/workflow/audit paths.
- Pager acknowledgment not received within the escalation SLA.

Use these templates during incidents:

- `docs/runbooks/degraded-mode-playbook.md`
- `docs/runbooks/fault-injection-checklist.md`
- `docs/runbooks/release-day-checklist.md`

## Security checks

- If API key mode is enabled, verify matching values for:
  - `ASSETHARBOR_API_KEY`
  - `CONTROL_PLANE_API_KEY`
  - `VITE_API_KEY`
