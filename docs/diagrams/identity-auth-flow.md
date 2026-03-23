# Identity and Authentication Flow

Covers all implemented authentication paths: local password auth with scrypt, JWT issuance and verification, OIDC/PKCE device flow, and API key auth. RBAC evaluation is implemented but runs in shadow mode by default (no enforcement). SCIM user provisioning is partially implemented (Users endpoint; no Groups endpoint). AD/LDAP is planned but has zero implementation.

```mermaid
sequenceDiagram
    actor User
    participant WebUI as Web UI
    participant CP as Control Plane
    participant IAM as IAM Module (iam.ts)
    participant DB as VAST Database (VastDB)
    participant OIDC as External OIDC Provider

    note over CP,IAM: All auth paths require SPACEHARBOR_JWT_SECRET env var.<br/>Startup fails if secret is absent (no hardcoded fallback).

    rect rgb(240, 255, 240)
        note right of User: Path 1 — Local password auth (scrypt)
        User->>WebUI: POST /api/v1/auth/login {username, password}
        WebUI->>CP: forward request
        CP->>IAM: verifyPassword(username, password)
        IAM->>DB: lookup user + scrypt hash
        DB-->>IAM: user record
        IAM-->>CP: credential valid / throttled / locked
        CP-->>WebUI: 200 {accessToken, refreshToken}
        WebUI-->>User: session established
    end

    rect rgb(240, 248, 255)
        note right of User: Path 2 — OIDC/PKCE device flow
        User->>WebUI: initiate OIDC login
        WebUI->>CP: GET /api/v1/auth/device/code
        CP-->>WebUI: {device_code, user_code, verification_uri}
        WebUI-->>User: display user_code + verification_uri
        User->>OIDC: authenticate at verification_uri
        OIDC-->>CP: authorization callback
        CP->>IAM: exchange code for OIDC tokens
        IAM-->>CP: id_token verified
        CP->>DB: upsert user from OIDC claims
        CP-->>WebUI: POST /api/v1/auth/device/token → {accessToken}
        WebUI-->>User: session established
    end

    rect rgb(255, 248, 220)
        note right of User: Path 3 — API key auth
        User->>CP: any request with X-API-Key header
        CP->>IAM: verifyApiKey(key) — constant-time comparison
        IAM-->>CP: identity + roles (multi-key supported)
        CP-->>User: response
    end

    rect rgb(248, 240, 255)
        note right of CP: JWT verification (all paths)
        CP->>IAM: verifyJwt(token)
        IAM-->>CP: decoded claims {sub, roles, tenant}
        CP->>IAM: evaluateRbac(claims, resource, action)
        note over IAM: Shadow mode ON by default.<br/>Logs violation but does NOT deny.
        IAM-->>CP: allow (shadow) / deny (enforced)
    end

    rect rgb(255, 240, 240)
        note right of User: SCIM provisioning (partial — Users only)
        participant SCIM as SCIM Provider (IdP)
        SCIM->>CP: POST /scim/v2/Users (Bearer token, timingSafeEqual)
        CP->>DB: upsert user record
        DB-->>CP: ok
        CP-->>SCIM: 201 Created
        note over SCIM,CP: SCIM Groups endpoint not implemented.
    end

    note over CP,IAM: AD/LDAP — PLANNED, NOT IMPLEMENTED.<br/>Zero code exists. Not configurable in Settings page.
```
