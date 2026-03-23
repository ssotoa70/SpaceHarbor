# ADR-007: Defer AD/LDAP — Use OIDC + SCIM for Enterprise Identity

**Date:** 2026-03-22
**Status:** Accepted
**Context:** Gap Analysis and Phased Execution Plan
**Deciders:** Architecture, Security, Product

## Problem Statement

The original SpaceHarbor design docs describe AD/LDAP integration as a supported enterprise identity mechanism. After the 2026-03-22 codebase audit, zero LDAP/AD code exists anywhere in the repository — no LDAP client library, no bind/search logic, no group sync, no role mapping. This is pure documentation vapor.

Implementing a full LDAP connector would require:
- LDAP client library dependency (ldapjs or similar)
- TLS/SASL authentication handling
- User search and group enumeration logic
- Directory schema mapping to SpaceHarbor roles
- Testing against mock and real LDAP servers
- Production credential rotation and security hardening

Estimated effort: 2–3 weeks of focused development for a single auth pathway used by a subset of deployments.

Meanwhile, OIDC and SCIM are already substantially implemented in the codebase:
- **OIDC authentication** is implemented in `iam/oidc-provider.ts` with token verification, token refresh, and provider discovery
- **SCIM user provisioning** is implemented in `iam/scim.ts` with the Users endpoint and idempotent CRUD operations
- **SCIM Groups endpoint** is a planned follow-up (low effort, modular add-on)

## Context: Enterprise Identity Requirements

Most modern enterprise identity providers (Azure AD, Okta, PingFederate, JumpCloud, Keycloak) support both OIDC and SCIM:
- **OIDC** handles user authentication (login via SSO)
- **SCIM** handles user and group lifecycle provisioning (user creation, attribute sync, group membership)

This combination covers the majority of enterprise directory integration use cases without requiring a direct LDAP connector.

### When LDAP May Be Needed

Direct LDAP integration is necessary only in narrow scenarios:
- Enterprise has an on-premise LDAP server with no OIDC bridge
- Legacy directory (e.g., 389 Directory Server, Apache Directory)
- Custom LDAP schema that doesn't map to OIDC/SCIM standards
- Organizational constraint against OIDC due to compliance policy

These scenarios are the exception, not the rule.

## Decision

**Drop AD/LDAP from active development scope.** The supported enterprise identity path is OIDC + SCIM.

### What This Means

1. **OIDC + SCIM is the standard enterprise integration path.** All documentation, deployment guides, and admin workflows reference OIDC and SCIM.

2. **AD/LDAP is deferred to post-GA.** If a specific customer (internal or external) requires direct LDAP bind, it becomes a billable feature request. Development can be planned as a plugin module (`iam/ldap-connector.ts`) without disturbing the core IAM system.

3. **AD/LDAP bridge is an alternative.** For customers with LDAP-only environments, we recommend deploying an IdP bridge:
   - **Azure AD Connect** (for on-premise AD → Azure AD)
   - **Okta AD/LDAP agent** (bridges Okta to on-premise LDAP)
   - **Keycloak LDAP federation** (Keycloak acts as OIDC provider over LDAP)

   These products handle LDAP complexity; SpaceHarbor stays vendor-agnostic.

4. **Single-tenant, API-key deployments are unaffected.** Organizations that don't need directory integration can continue using local auth or API keys.

## Consequences

### Positive
- Reduces scope by 2–3 weeks of critical-path development
- Eliminates a complex security dependency (LDAP binding, TLS handshakes, certificate validation)
- Aligns with OIDC/SCIM industry standard for SaaS identity integration
- Enables faster GA without losing enterprise support (90% of enterprises support OIDC)
- Existing OIDC + SCIM code paths are testable and auditable

### Negative
- Deployments with LDAP-only environments must use an IdP bridge (additional infrastructure)
- Adds a paragraph to deployment docs explaining the bridge requirement
- May disappoint customers expecting native LDAP support (mitigated by clear product positioning)

## Compliance & Security

This decision does **not** reduce security:
- OIDC with SCIM is the identity standard for FedRAMP, SOC2, and ISO 27001 compliance
- Avoids direct LDAP credential handling (lower attack surface)
- Defers LDAP complexity to vendors who specialize in it (AD Connect, Okta, Keycloak)

## Implementation

### Phase 0 (Immediate)
- Remove AD/LDAP claims from all documentation
- Update `Security-and-Compliance.md` to clarify OIDC + SCIM as the supported path
- Add ADR reference to product roadmap

### Phase 5 (Post-GA, if needed)
- If customer requests LDAP: design `iam/ldap-connector.ts` module
- Add LDAP configuration to Settings page
- Integrate LDAP directory client library (ldapjs)
- Test against mock and production LDAP servers

### Deployment Guide Updates
- Document OIDC configuration with common providers (Azure AD, Okta, Keycloak)
- Document SCIM setup for user provisioning
- Add section on "LDAP-only environments" with bridge recommendations

## References

- ADR-001: VAST-Native Element Handles
- ADR-003: Dual-Mode Persistence (design pattern for swappable authentication)
- Design: `docs/phase-8-identity-roles-entitlements-design.md` (IAM roadmap, shadow mode, RBAC enforcement)
- Security: `docs/Security-and-Compliance.md` (current capabilities)
- Deployment: `docs/deployment-guide.md` (OIDC/SCIM/LDAP configuration reference)

## Questions & Discussion

1. **Q: What if a customer requests LDAP?**
   A: Create a feature request, scope effort, and plan as billable post-GA work or external contribution.

2. **Q: Should we support both paths (OIDC + LDAP)?**
   A: OIDC is the standardized path. Direct LDAP adds maintenance burden for minimal ROI. Bridge tools are the appropriate abstraction layer.

3. **Q: Does SCIM Groups need to be completed before GA?**
   A: Groups endpoint is a follow-up (1–2 days). Not blocking; deployments can use OIDC claims-based role mapping in the interim.

---

**Approved:** 2026-03-22 by Architecture + Security + Product
