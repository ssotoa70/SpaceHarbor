# ADR-008: VAST_TRINO_* Environment Variable Deprecation

**Status:** Accepted
**Date:** 2026-03-24
**Decision makers:** SpaceHarbor maintainers

## Context

SpaceHarbor originally used `VAST_TRINO_*` environment variable names (e.g., `VAST_TRINO_ENDPOINT`, `VAST_TRINO_USERNAME`, `VAST_TRINO_PASSWORD`) to configure the VAST Database SQL connection. The `TRINO_HOST` and `TRINO_PORT` names were also used by the OpenAssetIO manager service.

These names are misleading — they imply SpaceHarbor connects to Trino directly, when in fact it connects to VAST Database, which exposes a Trino-compatible SQL endpoint. The canonical VAST documentation refers to this as "VAST Database" and the credentials as "S3 access key pairs."

## Decision

Migrate all environment variable references to canonical `VAST_DB_*` names:

| Legacy Name | Canonical Name | Status |
|-------------|---------------|--------|
| `VAST_TRINO_ENDPOINT` | `VAST_DB_ENDPOINT` | Deprecated — fallback active |
| `VAST_TRINO_USERNAME` | `VAST_DB_USERNAME` | Deprecated — fallback active |
| `VAST_TRINO_PASSWORD` | `VAST_DB_PASSWORD` | Deprecated — fallback active |
| `TRINO_HOST` | `VAST_DB_HOST` | Deprecated — fallback active |
| `TRINO_PORT` | `VAST_DB_PORT` | Deprecated — fallback active |
| `TRINO_INTEGRATION` | `VAST_DB_INTEGRATION` | Deprecated — removed from active use |

## Deprecation Timeline

| Phase | Target | Action |
|-------|--------|--------|
| Phase 1 (v0.2.0) | 2026-03-24 | Code migrated: canonical names read first, legacy fallback with warning. **DONE** |
| Phase 2 (v0.3.0) | TBD | Remove fallback logic. Legacy names no longer accepted. |
| Phase 3 (v0.3.0) | TBD | Remove all `VAST_TRINO_*` references from codebase. |

## Fallback Behavior (Phase 1 — current)

All code follows this pattern:

```typescript
// TypeScript
const endpoint = process.env.VAST_DB_ENDPOINT ?? process.env.VAST_TRINO_ENDPOINT;
if (process.env.VAST_TRINO_ENDPOINT && !process.env.VAST_DB_ENDPOINT) {
  console.warn("DEPRECATED: VAST_TRINO_ENDPOINT will be removed. Use VAST_DB_ENDPOINT.");
}
```

```python
# Python
endpoint = os.environ.get("VAST_DB_ENDPOINT") or os.environ.get("VAST_TRINO_ENDPOINT")
```

## Whitelisted Files (legacy references allowed)

These files contain backward-compat fallback logic and are whitelisted in the CI terminology check:

- `services/control-plane/src/db/installer.ts`
- `services/control-plane/src/db/migrations/*.ts` (14 files)
- `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- `services/scanner-function/function.py`
- `services/openassetio-manager/src/routes/manager.py`
- `scripts/deploy.py`
- `services/control-plane/docker-compose.test.yml`

## CI Enforcement

The `scripts/ci/check-docs-consistency.js` script (Check 3) prevents regression:

- Scans all user-facing files for forbidden terminology
- Fails on new `VAST_TRINO_*` definitions in `.env.example`
- Whitelists only the files listed above for legacy fallback code

## Consequences

- Operators using `VAST_TRINO_*` variables see deprecation warnings in logs
- New deployments use `VAST_DB_*` exclusively (per `.env.example`)
- Phase 2 removal will be a breaking change — announced in release notes
