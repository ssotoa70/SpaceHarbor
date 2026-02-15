# Release Day Checklist

## Pre-Release Gates

- [ ] `npm run test:docs` passed.
- [ ] `npm run test:all` passed on release branch.
- [ ] SLO and threshold dashboards reviewed.
- [ ] On-call and escalation assignments confirmed.

## Canary Promotion Gates

- [ ] 10% canary passed for 30 minutes.
- [ ] 50% canary passed for 45 minutes.
- [ ] No critical alerts or unresolved incidents.

## Go/No-Go Decision

- Decision time (UTC):
- Decision: go / no-go
- Release commander:
- Incident commander:
- Notes:

## Rollback Plan

- Rollback trigger(s):
- Rollback owner:
- Rollback command path:
- Validation steps after rollback:

## Sign-Off Log

| Role | Name | Timestamp (UTC) | Status |
| --- | --- | --- | --- |
| Release commander |  |  |  |
| Incident commander |  |  |  |
| Service owner |  |  |  |
