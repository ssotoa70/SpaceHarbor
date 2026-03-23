# Phase 8: Identity, Roles & Entitlements — Design Outline

**Status:** Draft (design phase)
**Depends on:** Phase 4 (production VAST deployment)
**Scope:** Authentication, authorization, RBAC, project-scoped entitlements

---

## 1. Current State Assessment

### What exists today

| Layer | Mechanism | Limitation |
|-------|-----------|------------|
| **Authentication** | Static API key (`x-api-key` header) on write endpoints | Single shared key; no user identity |
| **Actor tracking** | `actorId` + `actorRole` in event payloads | Self-declared in request body, not derived from auth |
| **Created-by fields** | `created_by` VARCHAR(100) on versions, materials, material_versions | Caller-supplied string, unverified |
| **Approval audit** | `performedBy` on `VersionApproval`, `ApprovalAuditEntry` | No validation against identity provider |
| **Task assignment** | `assignee` on Task, `lead` on Shot, `owner` on Project | Free-text strings, no user registry |

### Key observation

The data model already has identity-shaped fields (`createdBy`, `performedBy`, `actorId`, `assignee`, `owner`, `lead`). Phase 8 needs to **back these with real identity**, not redesign the schema.

---

## 2. Goals

1. **Authenticate** — Know who is making each request (user identity, not just API key)
2. **Authorize** — Enforce what each user can do (role-based, project-scoped)
3. **Audit** — Every state change is attributable to a verified identity
4. **Integrate** — Work with studio SSO (LDAP/AD, SAML, OIDC) without mandating a specific provider

---

## 3. Proposed Architecture

### 3.1 Authentication Layer

```
                   ┌──────────────────────┐
                   │  Identity Provider   │
                   │  (OIDC / SAML / AD)  │
                   └──────────┬───────────┘
                              │ JWT / session token
                              ▼
┌──────────────────────────────────────────────────────┐
│  Fastify Auth Plugin                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ JWT verify   │  │ API key      │  │ Service      │ │
│  │ (users)      │  │ (automation) │  │ token (M2M)  │ │
│  └─────────────┘  └──────────────┘  └─────────────┘ │
│              ↓ Unified RequestContext                  │
│  { userId, displayName, roles, projectScopes }        │
└──────────────────────────────────────────────────────┘
                              │
                              ▼
                     Route handlers
```

**Three auth strategies** (evaluated in order):
1. **JWT bearer token** — Primary path for interactive users (web-ui, DCC plugins)
2. **API key** — Backward-compatible path for automation, CI, DataEngine callbacks
3. **Service token** — Machine-to-machine for internal services (scanner-function, media-worker)

All three resolve to a unified `RequestContext` that route handlers consume.

### 3.2 Role Model

VFX studios use well-established roles. Keep it simple:

| Role | Scope | Description |
|------|-------|-------------|
| `viewer` | Project | Read-only access to project assets, metadata, timelines |
| `artist` | Project | Create/edit versions and materials within assigned shots/tasks |
| `coordinator` | Project | Manage shots, tasks, assignments; submit for review |
| `supervisor` | Project | Approve/reject versions; override review decisions |
| `producer` | Project | Full project control; manage team membership |
| `admin` | Global | System configuration; create projects; manage users |

**Key design choices:**
- Roles are **project-scoped** (a user can be `artist` on one project and `supervisor` on another)
- `admin` is the only global role
- Roles are hierarchical: each role inherits permissions from lower roles
- The existing `actorRole` enum (`artist | coordinator | supervisor | producer`) maps directly

### 3.3 Entitlement Matrix

| Action | viewer | artist | coordinator | supervisor | producer | admin |
|--------|--------|--------|-------------|------------|----------|-------|
| List/view assets | Y | Y | Y | Y | Y | Y |
| Create version | - | Y | Y | Y | Y | Y |
| Edit own version metadata | - | Y | Y | Y | Y | Y |
| Edit others' version metadata | - | - | Y | Y | Y | Y |
| Submit for review | - | Y | Y | Y | Y | Y |
| Approve/reject version | - | - | - | Y | Y | Y |
| Override approval decision | - | - | - | Y | Y | Y |
| Manage shots/sequences | - | - | Y | Y | Y | Y |
| Assign tasks | - | - | Y | Y | Y | Y |
| Create/archive project | - | - | - | - | Y | Y |
| Manage project membership | - | - | - | - | Y | Y |
| System configuration | - | - | - | - | - | Y |
| Manage users & global roles | - | - | - | - | - | Y |

### 3.4 Data Model Additions

```sql
-- User registry (synced from IdP or managed locally)
CREATE TABLE users (
  id          VARCHAR(36) PRIMARY KEY,
  external_id VARCHAR(255) UNIQUE,     -- IdP subject claim
  email       VARCHAR(255) UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  avatar_url  VARCHAR(1024),
  status      VARCHAR(20) DEFAULT 'active',  -- active | disabled | pending
  created_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL
);

-- Project membership with role
CREATE TABLE project_memberships (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
  project_id  VARCHAR(36) NOT NULL REFERENCES projects(id),
  role        VARCHAR(20) NOT NULL,  -- viewer|artist|coordinator|supervisor|producer
  granted_by  VARCHAR(36) REFERENCES users(id),
  granted_at  TIMESTAMP NOT NULL,
  UNIQUE (user_id, project_id)
);

-- Global admin flag (separate from project roles)
CREATE TABLE global_roles (
  user_id  VARCHAR(36) PRIMARY KEY REFERENCES users(id),
  role     VARCHAR(20) NOT NULL,  -- admin
  granted_by VARCHAR(36) REFERENCES users(id),
  granted_at TIMESTAMP NOT NULL
);

-- API keys (enhanced: tied to user or service account)
CREATE TABLE api_keys (
  id          VARCHAR(36) PRIMARY KEY,
  key_hash    VARCHAR(128) NOT NULL UNIQUE,  -- bcrypt/argon2 hash, never store plaintext
  owner_id    VARCHAR(36) NOT NULL REFERENCES users(id),
  label       VARCHAR(255),
  scopes      VARCHAR(1024),  -- comma-separated: "read", "write", "admin"
  expires_at  TIMESTAMP,
  created_at  TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP
);
```

### 3.5 Migration Strategy

Phase 8 must be backward-compatible. Migration path:

1. **Add tables** — `users`, `project_memberships`, `global_roles`, `api_keys`
2. **Add optional `user_id` FK** — to `versions.created_by`, `approvals.performed_by`, etc. (nullable initially)
3. **Dual-mode auth** — Accept both old API key and new JWT; old API key resolves to a "legacy-api" service user
4. **Backfill** — Script to create user records from existing `created_by`/`performedBy` strings
5. **Enforce** — After migration window, require JWT for interactive users; API key for automation only

---

## 4. Implementation Considerations

### IdP Integration Options

| Option | Complexity | Studio fit |
|--------|-----------|------------|
| **OIDC (Okta, Auth0, Keycloak)** | Medium | Modern studios, cloud-native |
| **SAML 2.0** | High | Enterprise studios with existing SAML IdP |
| **LDAP/Active Directory** | Medium | Traditional studios, on-prem |
| **Local user management** | Low | Dev, small teams, demos |

Recommendation: Support OIDC as primary, with local auth as fallback for development. SAML/LDAP via adapter pattern (same `RequestContext` interface).

### Fastify Integration Points

- `@fastify/jwt` for JWT verification
- Custom `preHandler` hook replacing current API key check in `app.ts:44-70`
- `request.user` decoration with `RequestContext` type
- Route-level guards: `{ preHandler: [requireRole('supervisor', 'projectId')] }`

### Web-UI Changes

- Login page (OIDC redirect flow)
- Token storage (httpOnly cookie or secure localStorage)
- User menu with profile, role display
- Project switcher showing only projects the user has access to
- Permission-gated UI elements (e.g., approve button only for supervisors+)

---

## 5. Open Questions

1. **Multi-project roles vs global roles?** Current design is project-scoped. Should we also support organization-level roles (e.g., "all projects viewer")?
2. **Service accounts** — Should DataEngine callbacks and scanner-function use dedicated service accounts or a shared system account?
3. **Delegation** — Can a supervisor delegate approval authority temporarily?
4. **Guest access** — External clients who need review-only access to specific shots?
5. **Offline token refresh** — DCC plugins (Maya/Nuke) may run for hours; how to handle token expiry gracefully?

---

## 6. Dependencies & Prerequisites

- **Phase 4 complete** — Production VAST cluster available for `users` and `project_memberships` tables
- **IdP decision** — Which identity provider to integrate first
- **Web-UI auth library** — Select OIDC client library for React (e.g., `oidc-client-ts`)
- **DB migration** — Schema version 6 with new tables

---

## 7. Estimated Scope

| Task | Est. effort |
|------|-------------|
| User + membership tables + migration | Small |
| RequestContext type + auth plugin | Medium |
| JWT verification + OIDC integration | Medium |
| Role-based route guards | Medium |
| API key enhancement (user-bound) | Small |
| Web-UI login flow | Medium |
| Web-UI permission gating | Medium |
| Backfill script for existing data | Small |
| Integration tests | Medium |

---

*Draft created 2026-03-10. Requires stakeholder review before implementation.*
