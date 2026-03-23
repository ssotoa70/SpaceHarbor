# Security and Compliance

## Current Baseline

- **Env-based secret loading.** Secrets are loaded from environment variables; `.env` files are written with mode `600` (owner read/write only). Secrets are never printed in plain text -- the deploy script uses `getpass` and masks values in output.
- **Audit event trail** exposed via `GET /api/v1/audit` with structured `signal` objects for programmatic alerting. Automated retention removes entries older than the configured window (default 90 days) when mode is set to `apply`.
- **API-key gate** for all write operations (`POST`, `PUT`, `PATCH`, `DELETE`) when `SPACEHARBOR_API_KEY` is configured. Missing key returns `401 UNAUTHORIZED`; invalid key returns `403 FORBIDDEN`.
- **Read-only incident endpoints** (`GET /api/v1/incident/coordination`, `GET /api/v1/audit`, `GET /api/v1/metrics`) remain accessible without API key to preserve operator visibility during active incidents.
- **Correlation IDs** propagated through API responses (`x-correlation-id`) and workflow traces for end-to-end traceability.
- **Webhook signing** for outbound deliveries: `x-spaceharbor-signature` and `x-spaceharbor-timestamp` headers on outbox publish payloads.
- **Optimistic concurrency control** via `expectedUpdatedAt` on incident coordination writes to prevent stale-write overwrites.

## VAST Mode Security

- `SPACEHARBOR_VAST_STRICT=true` + `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=false` runs strict fail-fast mode (no local fallback).
- Fallback usage is auditable via `/api/v1/audit` with `VAST_FALLBACK` signal codes.
- Deploy script validates VAST connectivity before starting services (`python scripts/deploy.py --check`).

## Input Validation

- All Fastify route handlers use JSON Schema validation for request bodies and query parameters.
- Trino queries use parameterized escaping (`esc()`, `escNum()`) — no raw string interpolation.
- CloudEvent payloads from VAST Event Broker are validated via `isCanonicalEvent()` type guard before processing.
- File URI handling validates against known path prefixes; no arbitrary path traversal.

## Credential Management

- All secrets loaded from environment variables; never hardcoded or logged.
- Deploy script (`scripts/deploy.py`) uses `getpass` for credential input and masks values in output.
- `.env` files created with mode `600` (owner read/write only).
- Scanner function Trino client uses Basic auth (`session.auth`) — credentials from env vars.
- Kafka client (Confluent) supports SASL/SSL configuration via env vars for VAST Event Broker.

## Phase 8: Identity, Roles & Tool Entitlements (Implemented)

Full IAM/RBAC module at `services/control-plane/src/iam/` covering:

- **Authentication.** Three auth strategies in priority order: JWT bearer token (interactive users), API key (automation/legacy), service token (M2M internal services). All resolve to a unified `RequestContext`.
- **Authorization.** 40+ canonical permission keys mapped to 9 hierarchical VFX roles: `vendor_external`, `viewer`, `artist`, `ingest_operator`, `coordinator`, `supervisor`, `producer`, `tenant_admin`, `admin`.
- **Scope isolation.** Tenant/project scope resolver enforces hard tenant boundaries. Requests with ambiguous or cross-tenant scope are explicitly denied.
- **Shadow mode.** Authorization decisions are evaluated and logged without blocking users (default). Enforcement activates per feature flag (`SPACEHARBOR_IAM_ENFORCE_READ_SCOPE`, `SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE`).
- **Separation of duties.** Approval workflows enforce that the submitter and approver must be different actors. Destructive actions require dual-control confirmation.
- **Break-glass elevation.** Time-bound temporary role elevation with MFA verification, expiry, and mandatory post-event review.
- **Lock-state enforcement.** Assets in sensitive states (delivery_locked, incident_active, admin_hold) block writes unless an approved override exists.
- **SCIM sync.** User/group lifecycle sync from IdP with group-to-role mappings.
- **Rollout rings.** Progressive enablement (internal → pilot → expand → general) with KPI-based go/no-go gates (false-deny rate < 0.1%, decision coverage > 95%, access-change MTTR < 15min).

All feature flags default **OFF** via env prefix `SPACEHARBOR_IAM_*`. Design document: [`docs/phase-8-identity-roles-entitlements-design.md`](../phase-8-identity-roles-entitlements-design.md).

## Enterprise Identity: OIDC + SCIM

SpaceHarbor's enterprise identity path is **OIDC + SCIM**, not AD/LDAP:

- **OIDC (OpenID Connect)** handles user authentication via federated login with major identity providers (Azure AD, Okta, Keycloak, PingFederate)
- **SCIM (System for Cross-Domain Identity Management)** handles user and group provisioning from the identity provider

This approach is:
- **Standard** — OIDC + SCIM is the industry standard for enterprise SaaS identity integration
- **Secure** — Avoids direct LDAP credential handling and TLS complexity
- **Interoperable** — Works with 90% of enterprise identity providers out-of-the-box

For organizations with LDAP-only environments, we recommend deploying an identity provider bridge:
- **Azure AD Connect** (on-premise AD → Azure AD)
- **Okta AD/LDAP agent** (on-premise LDAP → Okta)
- **Keycloak LDAP federation** (on-premise LDAP → Keycloak as OIDC provider)

See [ADR-007: Defer AD/LDAP — Use OIDC + SCIM](../adr/007-defer-ldap-use-oidc-scim.md) for the full rationale.

## Next Priorities

- **SCIM Groups endpoint** — Complete SCIM provisioning with group sync (1–2 days)
- **Secret manager integration** — HashiCorp Vault or AWS Secrets Manager for production credential rotation.
- **TLS enforcement** — Mutual TLS for control-plane to Trino and Kafka connections.
- **Retention and compliance controls** — Configurable per-project audit retention policies (currently 90-day default).

## Related Documentation

- [SECURITY.md](../../SECURITY.md) — vulnerability disclosure policy, API key rotation, credential management
- [API Contracts](../api-contracts.md) — authentication, error envelopes, and API key behavior
- [Operations Runbook](./Operations-Runbook.md) — security checks, alert thresholds, and escalation matrix
- [Deployment Guide](../deployment-guide.md) — credential handling, `.env` security, and deploy.log scrubbing
- [Phase 8 Design](../phase-8-identity-roles-entitlements-design.md) — identity, roles, and entitlements roadmap
