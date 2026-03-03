# Release Process

## Versioning

- Use semantic tags: `vX.Y.Z`.

## SLO Release Gates

- Confirm 7-day baseline meets runbook SLOs before cutover.
- Require zero active critical alerts and no unresolved data-integrity incidents.
- Require reliability trend to be stable or improving (no sustained fallback growth).

## Gates

- CI green on default branch.
- Contract tests pass.
- Compose config valid.

## Canary Promotion and Rollback Gates

| Phase | Promotion gate | Rollback gate |
| --- | --- | --- |
| 10% canary | 30 minutes with no critical alerts and <= warning thresholds | Any critical alert, or warning threshold sustained for 10 minutes |
| 50% canary | 45 minutes with SLO latency/error budget inside baseline | SLO budget burn >2x baseline for two consecutive checks |
| 100% rollout | 60 minutes stable metrics, no unresolved pager events | Any customer-impacting regression or data integrity concern |

Rollback owner: release commander (primary) and incident commander (backup).

## Go/No-Go Checklist

- [ ] `npm run test:all` passed on release candidate branch.
- [ ] `docs/runbooks/release-day-checklist.md` completed and signed by release commander.
- [ ] Cohort tracker and project signoff records updated for all in-scope projects.
- [ ] Canary rollback command path tested in staging during the same release window.
- [ ] On-call ownership/escalation matrix reviewed in `docs/wiki-2.0/Operations-Runbook.md`.
- [ ] Communications plan prepared for promotion and rollback announcements.

## Project-by-Project Rollout Tracking

- Cohort tracker template: `docs/rollouts/templates/cohort-rollout-tracker.md`
- Project signoff template: `docs/rollouts/templates/project-rollout-signoff.md`
- Keep one project signoff record per project and link each record in the cohort tracker.
- Status values are limited to `not_started`, `ready`, `in_pilot`, `go_live_ready`, `live`, `rolled_back`.

## Post-Release Verification Checkpoints

- T+15m: health endpoint, queue metrics, and outbound delivery counters are stable.
- T+60m: SLO/error budget and fallback trend remain within baseline.
- Any rollback trigger requires immediate incident commander acknowledgment.

## Communication Templates

- Promotion announcement template: `docs/runbooks/release-day-checklist.md#promotion-announcement`
- Rollback notice template: `docs/runbooks/release-day-checklist.md#rollback-notice`
- Post-release completion template: `docs/runbooks/release-day-checklist.md#post-release-verification-complete`

## Publish

- CD workflow publishes service images to GHCR on `main` pushes as `edge` images.
- CD workflow also publishes versioned images when semantic tags (`vX.Y.Z`) are pushed.
