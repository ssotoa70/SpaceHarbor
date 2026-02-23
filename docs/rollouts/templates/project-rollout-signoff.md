# Project Rollout Signoff Template

## Project Identity and Scope

- project_key:
- project_name:
- cohort:
- environment:
- rollout_window_utc:
- change_ref (PR/tag):
- rollback_runbook_ref:

## Pilot Entry Checklist

- [ ] Prechecks complete (`npm run test:all` and release gates reviewed).
- [ ] Monitoring and alerting dashboards verified.
- [ ] Rollback command path tested in staging.
- [ ] On-call and escalation contacts confirmed.

## Pilot Exit Criteria and Outcome

- success_criteria:
- observed_result:
- decision: go / hold
- decision_owner:
- decision_time_utc:

## Cutover Go/No-Go Decision

- go_no_go_status: go / no-go
- decision_owner:
- decision_time_utc:
- known_issues:
- blocked_by:

## Rollback Trigger Matrix

| Trigger | Threshold | Owner | Action |
| --- | --- | --- | --- |
| Critical alert | Any active critical during cutover | Release commander | Roll back immediately |
| Error budget burn | >2x baseline for two consecutive checks | Incident commander | Roll back and page service owner |
| Data integrity concern | Any customer-impacting integrity regression | Incident commander | Roll back and open incident |

## Rollback Execution Log

- rollback_invoked: yes / no
- rollback_time_utc:
- rollback_owner:
- incident_ref:
- validation_after_rollback:

## Post-Cutover Checkpoints

### T+15m

- [ ] Health endpoint stable.
- [ ] Queue/outbound counters within expected range.

### T+1h

- [ ] SLO/error budget within baseline.
- [ ] No unresolved pager incidents.

### T+24h

- [ ] No sustained regressions.
- [ ] Final release communications completed.

## Signoff

- service_owner_signoff_name:
- service_owner_signoff_time_utc:
- ops_owner_signoff_name:
- ops_owner_signoff_time_utc:
