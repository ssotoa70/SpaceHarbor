# SpaceHarbor Deployment Guide

This guide walks you through deploying SpaceHarbor using the interactive deployment CLI at `scripts/deploy.py`.

## Prerequisites

Before running the script, make sure you have:

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Python | 3.10+ | `python3 --version` |
| Docker | 20.10+ | `docker version` |
| Docker Compose | v2+ (plugin) | `docker compose version` |
| Node.js / npx | 18+ (for migrations only) | `npx --version` |

No Python packages need to be installed — the script uses only the standard library.

### Port Availability

The following ports must be free on your machine:

| Port | Service |
|---|---|
| 8080 | control-plane (API) |
| 4173 | web-ui (frontend) |
| 8001 | openassetio-manager |

The script checks port availability during preflight. If ports are in use, stop the conflicting service or run `python scripts/deploy.py --teardown` first.

## Deployment Modes

The script supports three deployment modes. Choose based on your backend:

### Local (no VAST required)

Uses in-memory persistence. No external credentials needed. Best for frontend development, UI testing, or exploring the app without a VAST cluster.

```
python scripts/deploy.py --mode local
```

### Cloud (VAST SaaS)

Connects to a VAST Data cloud-hosted cluster. Requires valid VAST credentials and runs database migrations. Use this for staging or production against a cloud VAST deployment.

```
python scripts/deploy.py --mode cloud
```

### On-Prem (self-hosted VAST)

Connects to a self-hosted VAST cluster on your network. Same credential requirements as cloud mode, but endpoint URLs point to internal hosts.

```
python scripts/deploy.py --mode onprem
```

## What You Need to Have Ready

### For Local Mode

Nothing beyond the prerequisites. The wizard auto-generates an API key and skips all VAST-related steps.

### For Cloud / On-Prem Mode

Gather these from your VAST cluster administrator before running the script:

| Credential | Description | Example |
|---|---|---|
| **Trino endpoint URL** | VAST database query endpoint | `https://vastdb.example.com:443` |
| **Access Key ID** | S3-compatible access key for Trino auth | `AKIAIOSFODNN7EXAMPLE` |
| **Secret Access Key** | Corresponding secret key (entered securely, never displayed) | — |
| **Event Broker URL** (optional) | Kafka broker address for DataEngine events | `vast-broker.example.com:9092` |
| **SASL Username** (optional) | VAST local user for Kafka auth (prompted if Event Broker URL is set) | `spaceharbor-kafka` |
| **SASL Password** (optional) | Password for the SASL user (entered securely) | — |
| **SASL Mechanism** (optional) | `PLAIN` or `SCRAM-SHA-256` (default: `PLAIN`) | `PLAIN` |
| **DataEngine URL** (optional) | VAST DataEngine REST endpoint | `https://vast-engine.example.com/api` |
| **VAST API Token** (optional) | Bearer token for DataEngine authentication (entered securely) | — |

**Required:** Trino endpoint, Access Key, and Secret Key are mandatory for cloud/onprem modes. The script will not proceed without them.

**Optional:** Event Broker and DataEngine enable real-time event processing. SpaceHarbor functions without them but won't receive automated ingest notifications. SASL credentials are prompted when an Event Broker URL is provided. `NODE_ENV` is automatically set to `production` for cloud/onprem modes and `development` for local mode.

## Interactive Wizard Steps

When you run the script without flags, it walks through 8 steps:

```
[1/8] Preflight checks      Verifies Docker, ports, and docker-compose.yml
[2/8] Deployment mode        Asks: local, cloud, or onprem
[3/8] VAST credentials       Collects endpoints and keys (skipped in local mode)
[4/8] Validate connectivity  Tests each endpoint is reachable (skipped in local mode)
[5/8] Generate .env          Writes .env with all config values (chmod 600)
[6/8] Run migrations         Runs the CLI installer (src/db/installer.ts) which discovers
                             all migrations and applies them in order (skipped in local mode)
[7/8] Build Docker images    Runs docker compose build
[8/8] Start + health check   Starts containers and waits for health endpoints
```

After step 8, you'll see a summary with service URLs and your (masked) API key.

## CLI Reference

```
python scripts/deploy.py [OPTIONS]
```

| Flag | Description |
|---|---|
| `--mode local\|cloud\|onprem` | Set mode without being prompted |
| `--check` | Validate VAST connectivity only — does not deploy |
| `--teardown` | Stop containers, optionally remove .env |
| `--non-interactive` | No prompts — reads from env vars or `--config` |
| `--config FILE` | JSON config file (used with `--non-interactive`) |
| `--skip-migrations` | Skip step 6 |
| `--skip-build` | Skip step 7 (use existing images) |
| `--force` | Skip all confirmation prompts |
| `--verbose` | Print debug-level log output to the terminal |

## Non-Interactive / CI Mode

For CI/CD pipelines, set credentials as environment variables and use `--non-interactive`:

```bash
export SPACEHARBOR_DEPLOY_MODE=cloud
export VAST_TRINO_ENDPOINT=https://vastdb.example.com:443
export VAST_ACCESS_KEY=mykey
export VAST_SECRET_KEY=mysecret
export VAST_EVENT_BROKER_URL=broker.example.com:9092
export VAST_EVENT_BROKER_SASL_USERNAME=spaceharbor-kafka
export VAST_EVENT_BROKER_SASL_PASSWORD=mypassword
export VAST_EVENT_BROKER_SASL_MECHANISM=PLAIN
export VAST_DATAENGINE_URL=https://engine.example.com/api
export VAST_API_TOKEN=mytoken
export SPACEHARBOR_API_KEY=my-api-key

python scripts/deploy.py --non-interactive --force
```

Alternatively, provide a JSON config file:

```json
{
  "mode": "cloud",
  "trino_endpoint": "https://vastdb.example.com:443",
  "access_key": "mykey",
  "secret_key": "mysecret",
  "event_broker_url": "broker.example.com:9092",
  "sasl_username": "spaceharbor-kafka",
  "sasl_password": "mypassword",
  "sasl_mechanism": "PLAIN",
  "dataengine_url": "https://engine.example.com/api",
  "api_token": "mytoken",
  "api_key": "my-api-key"
}
```

```bash
python scripts/deploy.py --non-interactive --config deploy-config.json
```

If `api_key` is omitted, one is auto-generated.

## What the Script Creates

| File | Purpose | Permissions |
|---|---|---|
| `.env` | Environment variables for Docker Compose | `600` (owner read/write only) |
| `deploy.log` | Debug log with all credentials scrubbed | Normal |

The `.env` file is loaded automatically by `docker compose`. It contains your API key (shared across control-plane, media-worker, and web-ui) and VAST connection details.

## After Deployment

### Access the Application

| Service | URL |
|---|---|
| Web UI | http://localhost:4173 |
| Control Plane API | http://localhost:8080 |
| Health Check | http://localhost:8080/health |
| Readiness Check | http://localhost:8080/health/ready |
| OpenAssetIO Manager | http://localhost:8001 |

### Common Commands

```bash
# View live logs
docker compose logs -f

# View a specific service
docker compose logs -f control-plane

# Restart a single service
docker compose restart web-ui

# Stop everything
python scripts/deploy.py --teardown

# Rebuild and redeploy after code changes
python scripts/deploy.py --mode local --skip-migrations --force
```

## Troubleshooting

### Port already in use

Stop the conflicting process or run teardown first:

```bash
python scripts/deploy.py --teardown
# Then retry
python scripts/deploy.py --mode local
```

### Docker build fails

Check that Docker Desktop is running and has sufficient resources (at least 4 GB RAM recommended). Review the build output:

```bash
docker compose build --no-cache 2>&1 | tail -50
```

### Health check times out

Services have 90 seconds to become healthy. If one times out, check its logs:

```bash
docker compose logs control-plane
```

Common causes: missing environment variables, database connectivity issues, or Node.js dependency installation failures inside the container.

### Migration fails

Migrations are executed by the CLI installer at `src/db/installer.ts`, which discovers all migrations from the registry, runs pre-flight checks (Trino reachability + auth), and applies them in order. You can preview what would run without executing:

```bash
cd services/control-plane
npx tsx src/db/installer.ts --trino-endpoint <url> --access-key <key> --secret-key <key> --dry-run
```

Run connectivity checks first:

```bash
python scripts/deploy.py --check
```

If a migration fails partway through, fix the issue and re-run. Migrations use `CREATE TABLE IF NOT EXISTS`, so re-running is safe.

### Validating connectivity without deploying

```bash
python scripts/deploy.py --check
```

This prompts for mode and credentials, tests each endpoint, and reports results without modifying anything.

## VAST Event Broker Authentication

VAST Event Broker does **not** support AD/LDAP for Kafka client authentication. Kafka clients (`VastEventSubscriber`, DataEngine function publishers) **must** authenticate using VAST local user credentials (username/password created via VAST CLI or web UI).

### Setup Steps

1. **Create a VAST local user** for the Kafka client:
   ```bash
   vastcmd user create --name spaceharbor-kafka
   ```
2. **Set SASL credentials** in your `.env` or environment:
   ```
   VAST_EVENT_BROKER_SASL_USERNAME=spaceharbor-kafka
   VAST_EVENT_BROKER_SASL_PASSWORD=<password>
   VAST_EVENT_BROKER_SASL_MECHANISM=PLAIN
   ```
   Supported SASL mechanisms: `PLAIN` or `SCRAM-SHA-256`.
3. **Verify connectivity** before deploying:
   ```bash
   python scripts/deploy.py --check
   ```

### Security Considerations

- VAST local user credentials are separate from AD/LDAP accounts. Rotate them on a regular schedule.
- Store SASL credentials in a secrets manager (e.g., HashiCorp Vault) for production deployments.
- The `.env` file is written with mode `600` (owner read/write only) by the deploy script.

---

## VAST Catalog Integration

VAST Catalog is a cluster-managed, read-only index of every file on the VAST filesystem. SpaceHarbor uses Catalog to provide storage truth alongside its own application database.

### Enabling VAST Catalog (Cluster Admin)

1. **Enable Catalog on the VAST cluster.** This is a cluster-level setting requiring admin privileges:
   - Open the VAST management UI or CLI
   - Navigate to cluster settings and enable the Catalog feature
   - Ensure the Catalog index is active on the relevant VAST views/paths used by SpaceHarbor
   - Verify Catalog virtual tables are accessible via Trino: `SELECT * FROM vast_catalog.default.objects LIMIT 1`

2. **Define S3 tag vocabulary.** SpaceHarbor uses the following S3 object tags for Catalog integration:

   | Tag Key | Description | Example Value |
   |---|---|---|
   | `ah-project-id` | SpaceHarbor project ID | `proj-abc123` |
   | `ah-asset-id` | SpaceHarbor asset ID | `asset-def456` |
   | `ah-version-id` | SpaceHarbor version ID | `ver-ghi789` |
   | `ah-media-type` | Media type classification | `video`, `image`, `3d`, `material`, `audio` |
   | `ah-pipeline-stage` | Current pipeline processing stage | `ingested`, `proxy-generated`, `metadata-extracted` |
   | `ah-ingest-timestamp` | ISO 8601 timestamp of ingest | `2026-03-13T08:00:00.000Z` |

   Tags are written automatically at ingest time by the control-plane and propagated to derived outputs (proxies, thumbnails) by DataEngine functions.

3. **Configure user-defined Catalog columns.** Map the S3 tag vocabulary to first-class Catalog columns so tags are queryable via Trino. Refer to your VAST cluster documentation for the exact CLI commands to add user-defined Catalog columns mapping each `ah-*` tag key to a queryable column.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VAST_CATALOG_TABLE` | Trino table for Catalog objects | `vast_catalog.default.objects` |
| `VAST_CATALOG_TAGS_TABLE` | Trino table for Catalog object tags | `vast_catalog.default.object_tags` |
| `VAST_CATALOG_SNAPSHOTS_TABLE` | Trino table for Catalog snapshots (time-travel) | `vast_catalog.default.snapshots` |

### API Endpoints

Once Catalog is enabled, the following endpoints become available:

| Endpoint | Description |
|---|---|
| `GET /api/v1/catalog/unregistered?pathPrefix=...` | Find files on VAST not registered in SpaceHarbor |
| `GET /api/v1/catalog/orphans` | Detect files tagged with SpaceHarbor IDs but missing from the DB |
| `GET /api/v1/catalog/storage-summary/:projectId` | Per-project storage breakdown by media type |
| `GET /api/v1/catalog/resolve/:elementHandle` | Resolve element handle to current storage path |

All Catalog endpoints return `503` with `CATALOG_UNAVAILABLE` if `VAST_DATABASE_URL` is not configured.

---

## IAM Rollout Guide

SpaceHarbor uses a 4-ring progressive rollout for Identity & Access Management (IAM). Each ring adds enforcement scope and requires validation before proceeding.

### Prerequisites

Before starting rollout:
- All Phase 1 (Security Foundation) and Phase 2 (Implementation) tasks are complete
- At least one authentication method is configured (JWT secret, JWKS URI, or API keys)
- Users exist in the system (via bootstrap, SCIM, or JIT provisioning)

### Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `SPACEHARBOR_IAM_ENABLED` | Enable IAM subsystem | `false` |
| `SPACEHARBOR_IAM_SHADOW_MODE` | Log authorization decisions without enforcing | `false` |
| `SPACEHARBOR_IAM_ENFORCE_READ_SCOPE` | Enforce permissions on read/browse endpoints | `false` |
| `SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE` | Enforce permissions on write/mutate endpoints | `false` |
| `SPACEHARBOR_IAM_ENFORCE_APPROVAL_SOD` | Enforce separation of duties on approvals | `false` |
| `SPACEHARBOR_IAM_ROLLOUT_RING` | Current rollout ring: `internal`, `pilot`, `expand`, `general` | `internal` |
| `SPACEHARBOR_IAM_ALLOWLISTED_TENANTS` | Comma-separated tenant IDs for pilot enforcement | `` |
| `SPACEHARBOR_IAM_ENABLE_SCIM_SYNC` | Enable SCIM inbound user sync | `false` |
| `SPACEHARBOR_JWT_SECRET` | Shared secret for HS256 JWT signing (local auth) | — |
| `SPACEHARBOR_OIDC_ISSUER` | OIDC issuer URL for JWT validation | — |
| `SPACEHARBOR_OIDC_AUDIENCE` | Expected JWT audience claim | — |
| `SPACEHARBOR_OIDC_JWKS_URI` | JWKS endpoint for RS256/ES256 JWT verification | — |
| `SPACEHARBOR_ADMIN_EMAIL` | Bootstrap super_admin email (first-run only) | — |
| `SPACEHARBOR_ADMIN_PASSWORD` | Bootstrap super_admin password (auto-generated if omitted) | — |
| `SPACEHARBOR_SCIM_TOKEN` | Bearer token for SCIM inbound endpoint auth | — |
| `SPACEHARBOR_AUDIT_RETENTION_DAYS` | Days to retain auth decision audit logs | `90` |

### Ring 1 — Shadow Mode (Internal, 7 days)

**Goal:** Evaluate IAM without impacting users. All authorization decisions are logged but never enforced.

```bash
# .env additions for Ring 1
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=true
SPACEHARBOR_IAM_ROLLOUT_RING=internal
```

**Validation checklist:**
- [ ] Shadow deny rate < 0.1% over 7 days
- [ ] No unexpected denials in `GET /api/v1/audit/auth-decisions?decision=deny`
- [ ] `GET /api/v1/metrics/iam` shows auth strategy breakdown matching expected traffic
- [ ] All service accounts (API keys, service tokens) resolve correctly
- [ ] SCIM sync (if configured) creates/updates users without errors

**KPI gate:** Proceed to Ring 2 when shadow-deny rate is < 0.1% for 7 consecutive days.

### Ring 2 — Write Enforcement (Pilot, 7 days)

**Goal:** Enforce permissions on write operations for a single pilot tenant while read operations remain open.

```bash
# .env additions for Ring 2
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=false
SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE=true
SPACEHARBOR_IAM_ROLLOUT_RING=pilot
SPACEHARBOR_IAM_ALLOWLISTED_TENANTS=tenant-pilot-id
```

**Validation checklist:**
- [ ] Pilot tenant write operations (ingest, approve, metadata edit) require correct role
- [ ] Non-pilot tenants are unaffected (still shadow mode)
- [ ] No false blocks reported by pilot users over 7 days
- [ ] API key and service token authentication continues working
- [ ] Audit log shows enforced deny decisions only for unauthorized attempts

**KPI gate:** Proceed to Ring 3 when pilot users report zero false blocks for 7 days.

### Ring 3 — Full Enforcement (Expand, 30 days)

**Goal:** Enforce all permissions (read + write) and separation of duties for all tenants.

```bash
# .env additions for Ring 3
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=false
SPACEHARBOR_IAM_ENFORCE_READ_SCOPE=true
SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE=true
SPACEHARBOR_IAM_ENFORCE_APPROVAL_SOD=true
SPACEHARBOR_IAM_ROLLOUT_RING=expand
SPACEHARBOR_IAM_ALLOWLISTED_TENANTS=
```

**Validation checklist:**
- [ ] All endpoints enforce correct permissions for all tenants
- [ ] Separation of duties: submitter cannot approve their own work
- [ ] Break-glass workflow tested: emergency override creates session, reviewed post-incident
- [ ] No false denials over 30 days across all tenants
- [ ] DCC plugins (Maya, Nuke) authenticate via API keys or device code flow

**KPI gate:** Proceed to Ring 4 when 30 days pass with zero false denials and compliance team sign-off.

### Ring 4 — General Availability

**Goal:** Production-grade IAM fully active. Shadow mode disabled, SCIM sync enabled.

```bash
# .env additions for Ring 4
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=false
SPACEHARBOR_IAM_ENFORCE_READ_SCOPE=true
SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE=true
SPACEHARBOR_IAM_ENFORCE_APPROVAL_SOD=true
SPACEHARBOR_IAM_ROLLOUT_RING=general
SPACEHARBOR_IAM_ENABLE_SCIM_SYNC=true
```

**Validation checklist:**
- [ ] All KPI gates from Rings 1-3 passed
- [ ] SCIM sync active: IdP user lifecycle events flow to SpaceHarbor
- [ ] Audit log retention policy running (default: 90 days)
- [ ] IAM health check reports healthy in `/health` endpoint
- [ ] Compliance team sign-off obtained

### Rollback Procedure

If issues are detected at any ring, rollback by reverting environment variables:

```bash
# Emergency rollback: disable enforcement, re-enable shadow mode
SPACEHARBOR_IAM_SHADOW_MODE=true
SPACEHARBOR_IAM_ENFORCE_READ_SCOPE=false
SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE=false
SPACEHARBOR_IAM_ENFORCE_APPROVAL_SOD=false
```

Restart the control-plane service after changing env vars. Shadow mode ensures zero user impact while you investigate.

### First-Run Bootstrap

For deployments without an IdP (local auth mode), bootstrap the first super_admin:

```bash
# Option A: Environment variable (automatic on first startup)
SPACEHARBOR_ADMIN_EMAIL=admin@studio.local
SPACEHARBOR_ADMIN_PASSWORD=YourSecurePassword123!
# If password is omitted, a random 24-char password is generated and logged once to stdout

# Option B: API endpoint (interactive setup)
curl -X POST http://localhost:8080/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@studio.local","displayName":"Super Admin","password":"YourSecurePassword123!"}'
```

The bootstrap endpoint self-destructs after the first successful call (returns 410 Gone).

---

## Security Notes

- **Secrets are never printed in plain text.** The script uses `getpass` for secret input and masks values in output (shows first 3 and last 3 characters only).
- **`.env` is written with mode 600** — only the file owner can read it.
- **`deploy.log` scrubs all credentials** using a logging filter that replaces known secret values with `***REDACTED***`.
- **Ctrl+C is handled gracefully** — the script exits cleanly and reminds you to run teardown if containers were started.
