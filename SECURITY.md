# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

- **Email:** security@xebyte.com
- **Do not** open a public GitHub issue for security vulnerabilities

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Current development |

## Security Model

SpaceHarbor enforces secure-by-default behavior:

- **IAM enabled by default** — authentication required on all endpoints
- **RBAC enforced by default** — shadow mode must be explicitly enabled
- **JWT secret required** — server refuses to start without it (outside dev mode)
- **TLS enforcement** — HTTPS required in production via reverse proxy
- **SCIM token validation** — constant-time comparison
- **DLQ purge** — requires explicit `destructive:purge_dlq` permission

See the [Wiki](../../wiki/Identity-and-Access) for full identity and access documentation.
