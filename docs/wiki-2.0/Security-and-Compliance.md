# Security and Compliance

## Current baseline

- Env-based secret loading.
- Audit event trail exposed via `/api/v1/audit`.
- Optional API-key gate for all `POST /api/v1/*` operations.
- Correlation IDs propagated through API responses and workflow traces.

## Next priorities

- Secret manager integration.
- RBAC hardening.
- Retention and compliance controls.
