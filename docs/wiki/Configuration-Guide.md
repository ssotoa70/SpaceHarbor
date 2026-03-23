# Configuration Guide

Fine-tune SpaceHarbor settings for your deployment environment.

## VAST Database Configuration

### Trino Endpoint Setup

SpaceHarbor uses VAST Database (Trino SQL engine) for persistent storage.

```bash
VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443
VAST_TRINO_USERNAME=spaceharbor-user
VAST_TRINO_PASSWORD=<secure-password>
```

**Verify connectivity:**

```bash
curl -u "$VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD" \
  "$VAST_TRINO_ENDPOINT/v1/info"
```

### Connection Pooling

Tune database connection limits:

```bash
# Maximum concurrent Trino connections per control-plane instance
VAST_TRINO_POOL_SIZE=20

# Connection timeout (milliseconds)
VAST_TRINO_TIMEOUT=30000
```

For production, set `VAST_TRINO_POOL_SIZE` based on:
- Concurrent API users (estimate 1-2 DB connections per user)
- Number of control-plane replicas
- Example: 100 users ÷ 2 instances = 50 users per instance ÷ 2 connections = 25 pool size

## Event Broker Configuration

### Kafka Setup

SpaceHarbor consumes workflow completion events from VAST Event Broker (Kafka).

```bash
# Kafka broker address
VAST_EVENT_BROKER_URL=vast-broker.example.com:9092

# SASL authentication (VAST local user)
VAST_EVENT_BROKER_SASL_USERNAME=spaceharbor-kafka
VAST_EVENT_BROKER_SASL_PASSWORD=<secure-password>

# Authentication mechanism
VAST_EVENT_BROKER_SASL_MECHANISM=PLAIN  # or SCRAM-SHA-256
```

**Create VAST local user for Kafka:**

```bash
# On VAST cluster (requires admin access)
vastcmd user create \
  --name spaceharbor-kafka \
  --password <secure-password> \
  --local
```

**Test Kafka connectivity:**

```bash
# Using Confluent CLI (if available)
kafka-broker-api-versions.sh \
  --bootstrap-server vast-broker.example.com:9092 \
  --command-config /tmp/kafka.properties
```

### Event Consumer Configuration

```bash
# Kafka consumer group
VAST_EVENT_BROKER_CONSUMER_GROUP=spaceharbor-events

# Number of consumer threads
VAST_EVENT_BROKER_CONSUMER_THREADS=4

# Message processing timeout (milliseconds)
VAST_EVENT_BROKER_MESSAGE_TIMEOUT=60000

# Batch size for processing events
VAST_EVENT_BROKER_BATCH_SIZE=100
```

For high-volume environments (>100 assets/hour):
- Increase `VAST_EVENT_BROKER_CONSUMER_THREADS` to 8-12
- Keep `VAST_EVENT_BROKER_BATCH_SIZE` at 50-100

## DataEngine Configuration

### Function Registration

SpaceHarbor orchestrates VAST DataEngine for media processing.

```bash
# DataEngine REST API endpoint
VAST_DATAENGINE_URL=https://vast-engine.example.com/api

# Authentication token
VAST_DATAENGINE_API_TOKEN=<secure-bearer-token>

# Function invocation timeout (seconds)
VAST_DATAENGINE_TIMEOUT=300
```

### Available Functions

Register these functions in VAST DataEngine (or they register auto-magically on startup):

- **exr-inspector** — Extract EXR metadata (frame range, color space, compression)
- **ffmpeg-transcoder** — Create proxy formats and delivery codecs
- **oiio-proxy-generator** — Generate thumbnails and preview images
- **otio-parser** — Parse OpenTimelineIO (EDL/OTIO) timelines
- **mtlx-parser** — Parse MaterialX shader definitions
- **provenance-recorder** — Log processing history and audit trail
- **storage-metrics-collector** — Monitor VAST Element Store capacity

Each function is triggered by:
- **Element event**: Automatic when file matches pattern (e.g., `*.exr`, `*.mov`)
- **HTTP API**: Explicit invocation via control-plane

**Verify function registration:**

```bash
# List registered functions (via VAST DataEngine UI or CLI)
vastcmd dataengine function list
```

## Storage Configuration

### S3-Compatible Storage

VAST Element Store can use S3, NFS, or SMB protocols.

```bash
# Element Store protocol
VAST_ELEMENT_STORE_PROTOCOL=s3  # s3 | nfs | smb

# S3 endpoint (if using S3 backend)
VAST_S3_ENDPOINT=s3.amazonaws.com
VAST_S3_ACCESS_KEY=AKIA...
VAST_S3_SECRET_KEY=<secure>
VAST_S3_BUCKET=spaceharbor-assets
VAST_S3_REGION=us-east-1
```

### Presigned URL Configuration

For secure temporary access to media files:

```bash
# Presigned URL expiration (seconds)
VAST_PRESIGNED_URL_EXPIRY=3600  # 1 hour

# Enable public proxies (disable for secure environments)
SPACEHARBOR_PUBLIC_PROXY_URLS=false
```

## Authentication and Authorization

### Local Authentication (Development)

Default for local mode:

```bash
SPACEHARBOR_AUTH_MODE=local
SPACEHARBOR_DEFAULT_EMAIL=dev@example.com
SPACEHARBOR_DEFAULT_PASSWORD=devpass123
```

### JWT Configuration

```bash
# JWT signing secret (generate with: openssl rand -hex 32)
SPACEHARBOR_JWT_SECRET=<64-character-hex>

# Token expiration (minutes)
SPACEHARBOR_JWT_EXPIRY=1440  # 24 hours
SPACEHARBOR_JWT_REFRESH_EXPIRY=10080  # 7 days
```

### API Key Authentication

```bash
# Required for service-to-service calls
SPACEHARBOR_API_KEY=sh_<random-key>

# Multiple keys (comma-separated, for key rotation)
SPACEHARBOR_API_KEYS=sh_key1,sh_key2
```

### OIDC/SSO Integration

```bash
# OIDC provider
SPACEHARBOR_OIDC_PROVIDER=https://auth.example.com
SPACEHARBOR_OIDC_CLIENT_ID=spaceharbor-client
SPACEHARBOR_OIDC_CLIENT_SECRET=<secure>
SPACEHARBOR_OIDC_CALLBACK_URL=https://spaceharbor.example.com/auth/callback
```

### SCIM Provisioning

```bash
# SCIM endpoint (for user/group sync from IdP)
SPACEHARBOR_SCIM_ENABLED=true
SPACEHARBOR_SCIM_TOKEN=<Bearer-token>
```

### IAM System Configuration

```bash
# Enable/disable IAM system
SPACEHARBOR_IAM_ENABLED=true

# Shadow mode: log policy decisions without enforcing
SPACEHARBOR_IAM_SHADOW_MODE=false

# Feature rollout ring (canary | beta | stable)
SPACEHARBOR_IAM_ROLLOUT_RING=stable
```

## Logging Configuration

### Log Level

```bash
# Levels: trace | debug | info | warn | error | fatal
SPACEHARBOR_LOG_LEVEL=info

# Pretty-print logs (disable for JSON in production)
SPACEHARBOR_LOG_FORMAT=json  # json | pretty
```

### Log Destinations

```bash
# File output (optional)
SPACEHARBOR_LOG_FILE=/var/log/spaceharbor/control-plane.log

# Max log file size before rotation (MB)
SPACEHARBOR_LOG_FILE_MAX_SIZE=100

# Retention (days)
SPACEHARBOR_LOG_RETENTION_DAYS=30
```

## Workflow Configuration

### Job Processing

```bash
# Maximum job retry attempts
SPACEHARBOR_MAX_JOB_RETRIES=3

# Retry backoff strategy (milliseconds)
SPACEHARBOR_RETRY_INITIAL_DELAY=1000
SPACEHARBOR_RETRY_MAX_DELAY=60000
SPACEHARBOR_RETRY_BACKOFF_MULTIPLIER=2

# Job lease duration (seconds, before reaping)
SPACEHARBOR_JOB_LEASE_DURATION=300  # 5 minutes
```

### Approval Workflow

```bash
# Require approval before archival
SPACEHARBOR_REQUIRE_APPROVAL=true

# Auto-approve after days (0 = disabled)
SPACEHARBOR_AUTO_APPROVE_AFTER_DAYS=0

# Approval timeout (days before auto-archive)
SPACEHARBOR_APPROVAL_TIMEOUT_DAYS=30
```

### Audit Retention

```bash
# Audit log retention (days)
SPACEHARBOR_AUDIT_RETENTION_DAYS=90

# Compliance event logging
SPACEHARBOR_AUDIT_ENABLED=true
SPACEHARBOR_AUDIT_LOG_LEVEL=info
```

## Performance Tuning

### Rate Limiting

```bash
# API requests per second per IP
SPACEHARBOR_RATE_LIMIT_RPS=100

# Concurrent asset ingest
SPACEHARBOR_MAX_CONCURRENT_INGESTS=10
```

### Caching

```bash
# Enable query result caching
SPACEHARBOR_QUERY_CACHE_ENABLED=true

# Cache TTL (seconds)
SPACEHARBOR_QUERY_CACHE_TTL=300  # 5 minutes

# Cache size (MB)
SPACEHARBOR_QUERY_CACHE_SIZE=100
```

## Development Configuration

### Mock Data

```bash
# Load sample assets on startup (dev only)
SPACEHARBOR_SEED_SAMPLE_DATA=true

# Sample asset count
SPACEHARBOR_SAMPLE_ASSET_COUNT=10
```

### Debug Mode

```bash
# Enable detailed request/response logging
SPACEHARBOR_DEBUG=false

# SQL query logging (VAST Database)
SPACEHARBOR_SQL_DEBUG=false

# Kafka event logging
SPACEHARBOR_KAFKA_DEBUG=false
```

## Validation

After configuration changes, verify:

```bash
# Health check
curl https://spaceharbor.example.com/health

# API test
curl https://spaceharbor.example.com/api/v1/assets \
  -H "Authorization: Bearer $API_KEY"

# Check logs for configuration errors
docker compose logs control-plane | grep -i "config\|error"
```

## See Also

- [Installation Guide](Installation-Guide.md) — Initial setup
- [Deployment Guide](Deployment-Guide.md) — Production rollout
- [Identity and Access](Identity-and-Access.md) — Advanced authentication
- [Monitoring and Observability](Monitoring.md) — Health and alerting
