# Operations Runbook

> **Canonical document:** [`docs/runbook.md`](../runbook.md)
>
> This wiki page is a lightweight summary. For the complete runbook including SLO definitions,
> escalation matrix, incident coordination, and audit retention procedures, see the canonical document.

## Quick Reference

- **Health check:** `GET /health`
- **Readiness:** `GET /health/ready`
- **Metrics:** `GET /api/v1/metrics`
- **Audit log:** `GET /api/v1/audit`
- **DLQ inspection:** `GET /api/v1/dlq`
- **Reap stale leases:** `POST /api/v1/queue/reap-stale`
- **Replay failed job:** `POST /api/v1/jobs/:id/replay`

## VAST mode policy

- Strict mode: `SPACEHARBOR_VAST_STRICT=true` + `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=false` runs strict fail-fast mode.
- Fallback continuity: `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=true` enables fallback mode.
- Verify fallback usage by checking `/api/v1/audit` for `VAST_FALLBACK` entries.

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

## Related Documentation

- [Runbook](../runbook.md) — full operational procedures, SLOs, escalation matrix
- [Disaster Recovery](../disaster-recovery.md) — RTO/RPO targets, recovery procedures
- [Troubleshooting](../troubleshooting.md) — decision trees for common failures
- [Monitoring Setup](../monitoring-setup.md) — Prometheus, alerting, Grafana dashboards
