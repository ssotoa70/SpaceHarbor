# Release Day Checklist

## Pre-Release Gates

- [ ] `npm run test:docs` passed.
- [ ] `npm run test:all` passed on release branch.
- [ ] SLO and threshold dashboards reviewed.
- [ ] On-call and escalation assignments confirmed.
- [ ] Shared incident coordination baseline recorded (`GET /api/v1/incident/coordination`).
- [ ] Cohort rollout tracker created/updated (`docs/rollouts/templates/cohort-rollout-tracker.md`).
- [ ] Project rollout signoff record created/updated (`docs/rollouts/templates/project-rollout-signoff.md`).

## Canary Promotion Gates

- [ ] 10% canary passed for 30 minutes.
- [ ] 50% canary passed for 45 minutes.
- [ ] No critical alerts or unresolved incidents.
- [ ] Rollout tracker status advanced for each in-scope project.

## Go/No-Go Decision

- Decision time (UTC):
- Decision: go / no-go
- Release commander:
- Incident commander:
- Active operator handoff state (`none` / `handoff_requested` / `handoff_accepted`):
- Project-by-project rollout tracker link:
- Notes:

## Communication Templates

### Promotion Announcement

- Release `<version>` is promoted to `<environment>` at `<time UTC>`.
- Scope: `<features/slices>`.
- Verification checkpoints at T+15m and T+60m are in progress.

### Rollback Notice

- Release `<version>` rollback initiated at `<time UTC>`.
- Trigger: `<alert/regression>`.
- Owner: `<name>`.
- Next update at `<time UTC>`.

### Post-Release Verification Complete

- Release `<version>` passed post-release checkpoints.
- T+15m and T+60m verification complete.
- No rollback triggers observed.

## Post-Release Verification Checkpoints

### T+15m

- [ ] `GET /health` stable and error-free.
- [ ] Queue pending/leased counters within expected range.
- [ ] No spike in outbound delivery failures.

### T+60m

- [ ] SLO/error budget remains within baseline.
- [ ] No sustained fallback growth in metrics/audit.
- [ ] No unresolved pager incidents.
- [ ] Rollout tracker and project signoff records updated to reflect final state.

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
