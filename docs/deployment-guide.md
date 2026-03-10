# AssetHarbor Deployment Guide

This guide walks you through deploying AssetHarbor using the interactive deployment CLI at `scripts/deploy.py`.

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
| **DataEngine URL** (optional) | VAST DataEngine REST endpoint | `https://vast-engine.example.com/api` |
| **VAST API Token** (optional) | Bearer token for DataEngine authentication (entered securely) | — |

**Required:** Trino endpoint, Access Key, and Secret Key are mandatory for cloud/onprem modes. The script will not proceed without them.

**Optional:** Event Broker and DataEngine enable real-time event processing. AssetHarbor functions without them but won't receive automated ingest notifications.

## Interactive Wizard Steps

When you run the script without flags, it walks through 8 steps:

```
[1/8] Preflight checks      Verifies Docker, ports, and docker-compose.yml
[2/8] Deployment mode        Asks: local, cloud, or onprem
[3/8] VAST credentials       Collects endpoints and keys (skipped in local mode)
[4/8] Validate connectivity  Tests each endpoint is reachable (skipped in local mode)
[5/8] Generate .env          Writes .env with all config values (chmod 600)
[6/8] Run migrations         Creates database tables via Trino (skipped in local mode)
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
export ASSETHARBOR_DEPLOY_MODE=cloud
export VAST_TRINO_ENDPOINT=https://vastdb.example.com:443
export VAST_ACCESS_KEY=mykey
export VAST_SECRET_KEY=mysecret
export VAST_EVENT_BROKER_URL=broker.example.com:9092
export VAST_DATAENGINE_URL=https://engine.example.com/api
export VAST_API_TOKEN=mytoken
export ASSETHARBOR_API_KEY=my-api-key

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

Migrations require a reachable Trino endpoint with valid credentials. Run connectivity checks first:

```bash
python scripts/deploy.py --check
```

If a migration fails partway through, fix the issue and re-run. Migrations use `CREATE TABLE IF NOT EXISTS`, so re-running is safe.

### Validating connectivity without deploying

```bash
python scripts/deploy.py --check
```

This prompts for mode and credentials, tests each endpoint, and reports results without modifying anything.

## Security Notes

- **Secrets are never printed in plain text.** The script uses `getpass` for secret input and masks values in output (shows first 3 and last 3 characters only).
- **`.env` is written with mode 600** — only the file owner can read it.
- **`deploy.log` scrubs all credentials** using a logging filter that replaces known secret values with `***REDACTED***`.
- **Ctrl+C is handled gracefully** — the script exits cleanly and reminds you to run teardown if containers were started.
