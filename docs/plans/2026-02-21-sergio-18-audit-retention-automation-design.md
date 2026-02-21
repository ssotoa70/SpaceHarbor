# SERGIO-18: 90-Day Audit Retention Automation Design

## Summary

Implement an in-process retention runner for audit records with two modes:

- `dry-run` (default): preview-only, no mutation
- `apply`: enforce retention window by removing records older than cutoff

Retention window defaults to 90 days and is configurable by environment variables.

## Scope

- Add retention preview/apply methods to persistence adapter contract.
- Implement local adapter retention behavior.
- Delegate VAST adapter retention through workflow boundary with strict/fallback semantics.
- Add in-process scheduler in control-plane lifecycle.
- Document dry-run/apply workflow and rollback/restore runbook steps.

## Semantics

- Cutoff: `now - retentionDays`
- Eligible records: `event.at < cutoff`
- Boundary records (`event.at == cutoff`) are retained.

## Safety

- Default mode is `dry-run`.
- Invalid mode input falls back to `dry-run`.
- Overlap lock prevents concurrent retention runs.
- Optional max-delete cap limits deletions per run.

## Validation

- Unit/integration tests for preview, apply, boundary handling, cap handling, and overlap lock.
- Full verification gates:
  - `npm run test:contracts`
  - `npm run test:control-plane`
  - `npm run test:all`
