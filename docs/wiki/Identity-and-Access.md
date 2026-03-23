# Identity and Access

Authentication, authorization, and user management for SpaceHarbor.

## Authentication Methods

### Local Authentication (Development)

Default for local/development mode:

```bash
Email: dev@example.com
Password: devpass123
```

Credentials are configured via:

```bash
SPACEHARBOR_AUTH_MODE=local
SPACEHARBOR_DEFAULT_EMAIL=dev@example.com
SPACEHARBOR_DEFAULT_PASSWORD=devpass123
```

### JWT Authentication (Production)

After login, SpaceHarbor issues a JWT:

```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 86400,
  "refreshToken": "refresh-token-123"
}
```

Use the token in subsequent requests:

```bash
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3000/api/v1/assets
```

JWT Configuration:

```bash
# Signing secret (generate: openssl rand -hex 32)
SPACEHARBOR_JWT_SECRET=<64-char-hex>

# Expiration times
SPACEHARBOR_JWT_EXPIRY=1440          # 24 hours (minutes)
SPACEHARBOR_JWT_REFRESH_EXPIRY=10080 # 7 days (minutes)
```

### API Keys (Service-to-Service)

For automated integrations and webhooks:

```bash
SPACEHARBOR_API_KEY=sh_your-secret-key
```

Use in requests:

```bash
curl -H "Authorization: Bearer sh_your-secret-key" \
  http://localhost:3000/api/v1/assets
```

Create additional keys for key rotation:

```bash
SPACEHARBOR_API_KEYS=sh_key1,sh_key2,sh_key3
```

## OIDC/SSO Integration

Connect to external identity providers (Okta, Azure AD, Auth0, etc.):

```bash
# OIDC Provider Configuration
SPACEHARBOR_OIDC_ENABLED=true
SPACEHARBOR_OIDC_PROVIDER=https://auth.example.com
SPACEHARBOR_OIDC_CLIENT_ID=spaceharbor-client-id
SPACEHARBOR_OIDC_CLIENT_SECRET=<secure-secret>
SPACEHARBOR_OIDC_CALLBACK_URL=https://spaceharbor.example.com/auth/callback
SPACEHARBOR_OIDC_SCOPE=openid,profile,email

# Optional: User claim mapping
SPACEHARBOR_OIDC_EMAIL_CLAIM=email
SPACEHARBOR_OIDC_NAME_CLAIM=name
SPACEHARBOR_OIDC_GROUPS_CLAIM=groups
```

### Okta Example

1. Create an OIDC application in Okta:
   - Application Name: SpaceHarbor
   - Application Type: Web
   - Redirect URI: `https://spaceharbor.example.com/auth/callback`

2. Configure SpaceHarbor:

```bash
SPACEHARBOR_OIDC_PROVIDER=https://dev-12345.okta.com
SPACEHARBOR_OIDC_CLIENT_ID=0oa1234567890
SPACEHARBOR_OIDC_CLIENT_SECRET=<client-secret>
```

### Azure AD Example

1. Register SpaceHarbor as a multi-tenant application:
   - Redirect URI: `https://spaceharbor.example.com/auth/callback`
   - API Permissions: OpenID Connect scopes

2. Configure SpaceHarbor:

```bash
SPACEHARBOR_OIDC_PROVIDER=https://login.microsoftonline.com/common
SPACEHARBOR_OIDC_CLIENT_ID=<application-id>
SPACEHARBOR_OIDC_CLIENT_SECRET=<client-secret>
```

## SCIM User Provisioning

Automatically sync users and groups from your IdP:

```bash
# Enable SCIM endpoint
SPACEHARBOR_SCIM_ENABLED=true
SPACEHARBOR_SCIM_TOKEN=Bearer scim-auth-token-123
```

SCIM endpoints:

```bash
# User management
GET /api/v1/scim/Users
POST /api/v1/scim/Users
PATCH /api/v1/scim/Users/:id
DELETE /api/v1/scim/Users/:id

# Group management
GET /api/v1/scim/Groups
POST /api/v1/scim/Groups
PATCH /api/v1/scim/Groups/:id
DELETE /api/v1/scim/Groups/:id
```

Configure your IdP to push users:

**Okta:**
1. Admin → Applications → SpaceHarbor → Provisioning
2. To App → Edit → Enable
3. SCIM 2.0 Base URL: `https://spaceharbor.example.com/api/v1/scim`
4. Authentication: Bearer Token `$SPACEHARBOR_SCIM_TOKEN`

**Azure AD:**
1. Enterprise Application → Provisioning
2. Provisioning Mode: Automatic
3. SCIM Tenant URL: `https://spaceharbor.example.com/api/v1/scim`
4. Secret Token: `$SPACEHARBOR_SCIM_TOKEN`

## Role-Based Access Control (RBAC)

Define roles and permissions:

```bash
# Enable IAM system
SPACEHARBOR_IAM_ENABLED=true

# Enforcement mode (false = shadow/logging only)
SPACEHARBOR_IAM_SHADOW_MODE=false

# Rollout ring (canary | beta | stable)
SPACEHARBOR_IAM_ROLLOUT_RING=stable
```

### Built-In Roles

| Role | Permissions | Use Case |
|------|-------------|----------|
| **Owner** | All (ingest, approve, delete, manage users) | Administrators |
| **Approver** | Approve/reject, comment, view all assets | Supervisors, QC leads |
| **Artist** | Ingest, view own assets | Content creators |
| **Viewer** | View only, no editing | Executives, stakeholders |

### Custom Permissions

Define fine-grained permissions:

```bash
# Asset permissions
asset:read          # View assets
asset:create        # Ingest new assets
asset:update        # Update metadata
asset:delete        # Delete assets

# Approval permissions
approval:submit      # Submit for review
approval:approve     # Approve assets
approval:reject      # Reject assets
approval:comment     # Add review notes

# Admin permissions
admin:manage_users   # Add/remove users
admin:manage_roles   # Define roles
admin:audit_read     # View audit logs
admin:export         # Export data
```

### Assigning Roles

Via the API:

```bash
POST /api/v1/users/:userId/roles
Content-Type: application/json

{
  "roleId": "approver"
}
```

Via SCIM (automatic):
- User's group membership in IdP → SpaceHarbor roles

## Device Authorization

For desktop plugin integration (Maya, Nuke, Houdini):

```bash
POST /api/v1/auth/device/request
Content-Type: application/json

{
  "clientId": "maya-plugin",
  "deviceName": "artist-machine-01"
}
```

Response:
```json
{
  "deviceCode": "device-code-123",
  "userCode": "ABC-DEF",
  "expiresIn": 600,
  "verificationUri": "https://spaceharbor.example.com/activate"
}
```

Artist visits verification URI, enters user code, approves access. Plugin polls for approval:

```bash
POST /api/v1/auth/device/poll
Content-Type: application/json

{
  "deviceCode": "device-code-123"
}
```

Once approved:
```json
{
  "accessToken": "token-123",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

## API Key Management

Generate API keys for service-to-service integrations:

```bash
POST /api/v1/api-keys
Content-Type: application/json

{
  "name": "webhook-delivery",
  "description": "External event webhook",
  "expiresIn": 2592000
}
```

Response:
```json
{
  "id": "key-uuid",
  "key": "sh_live_xxxxxxxxxxxxxxxxxxxx",
  "name": "webhook-delivery",
  "createdAt": "2026-03-23T10:00:00.000Z",
  "expiresAt": "2026-04-22T10:00:00.000Z"
}
```

List and revoke keys:

```bash
GET /api/v1/api-keys
DELETE /api/v1/api-keys/:keyId
```

## Multi-Factor Authentication (MFA)

Enable TOTP-based MFA:

```bash
POST /api/v1/users/me/mfa/setup
```

Response:
```json
{
  "secret": "JBSWY3DPEBLW64TMMQ======",
  "qrCode": "data:image/png;base64,..."
}
```

User scans QR code with authenticator app, then verifies:

```bash
POST /api/v1/users/me/mfa/verify
Content-Type: application/json

{
  "code": "123456"
}
```

## Audit and Compliance

All authentication events are logged:

```bash
GET /api/v1/audit?action=login&days=30
```

Response includes:
- Successful logins
- Failed login attempts
- Token issuance and revocation
- RBAC permission changes
- MFA setup/disable events

## Password Management

### Password Reset

```bash
POST /api/v1/auth/password-reset
Content-Type: application/json

{
  "email": "user@example.com"
}
```

User receives email with reset link. Clicking the link:

```bash
POST /api/v1/auth/password-reset/:token
Content-Type: application/json

{
  "newPassword": "new-secure-password"
}
```

### Password Policy

Configure requirements:

```bash
SPACEHARBOR_PASSWORD_MIN_LENGTH=12
SPACEHARBOR_PASSWORD_REQUIRE_UPPERCASE=true
SPACEHARBOR_PASSWORD_REQUIRE_NUMBERS=true
SPACEHARBOR_PASSWORD_REQUIRE_SPECIAL_CHARS=true
SPACEHARBOR_PASSWORD_EXPIRY_DAYS=90
```

## Session Management

### Session Timeout

```bash
# Idle session timeout (minutes)
SPACEHARBOR_SESSION_IDLE_TIMEOUT=30

# Max session duration (hours)
SPACEHARBOR_SESSION_MAX_DURATION=8
```

### Concurrent Sessions

Limit simultaneous logins per user:

```bash
# Max concurrent sessions per user
SPACEHARBOR_MAX_CONCURRENT_SESSIONS=3
```

Exceeding the limit revokes the oldest session.

## Security Best Practices

1. **Secrets Storage**
   - Never commit `.env` to git
   - Use environment variable injection or secrets manager
   - Rotate JWT secret every 90 days

2. **HTTPS Only**
   - Enable TLS 1.2+ for all endpoints
   - Use valid certificates (not self-signed in production)

3. **Rate Limiting**
   - Enable login rate limiting (5 failures = 15 min lockout)
   - Enable API rate limiting per key

4. **Audit Logging**
   - Enable audit logging for all auth events
   - Retain audit logs for 90+ days
   - Regular review of suspicious activities

5. **RBAC Enforcement**
   - Disable shadow mode in production
   - Review role assignments monthly
   - Use least-privilege principle

## Deferred: LDAP Integration

LDAP is deferred to a future release. Use OIDC as the recommended integration method for on-premises identity systems.

See [ADR-007](../docs/adr/007-defer-ldap-use-oidc-scim.md) for rationale.

## See Also

- [Architecture Overview](Architecture.md) — Authentication design
- [Configuration Guide](Configuration-Guide.md) — Auth settings
- [Troubleshooting](Troubleshooting.md) — Auth issues
