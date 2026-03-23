# Installation Guide

Complete setup instructions for SpaceHarbor in development, staging, or production environments.

## System Requirements

### Minimum Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | 18+ | Control-plane runtime |
| npm | 9+ | Dependency management |
| Docker | 20.10+ | Container runtime |
| Docker Compose | v2+ | Multi-container orchestration |
| Python | 3.11+ | Media worker (optional) |

### Storage Requirements

- **Local SSD**: 10 GB for development (in-memory storage)
- **VAST Element Store**: Capacity depends on media volume
- **VAST Database**: 1 GB minimum for metadata

### Network Requirements

- **Ports to expose** (see [Deployment Guide](Deployment-Guide.md)):
  - 3000/3001: Control-plane API
  - 4173: Web UI
  - 8001: OpenAssetIO manager (optional)
- **VAST cluster connectivity**: Network access to:
  - Trino endpoint (VAST Database)
  - Event Broker (Kafka, port 9092)
  - DataEngine API
  - Element Store (S3/NFS/SMB)

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/spaceharbor.git
cd spaceharbor
```

### 2. Install Node.js Dependencies

```bash
# Install workspace dependencies
npm ci

# Install service-specific dependencies
cd services/control-plane && npm ci
cd ../web-ui && npm ci
cd ../media-worker && pip install -r requirements.txt  # optional
```

### 3. Configure Environment (Development)

For **local development** (in-memory, no VAST required):

```bash
# Create .env file (git-ignored)
cat > .env << EOF
NODE_ENV=development
SPACEHARBOR_MODE=local
SPACEHARBOR_PORT=3000
SPACEHARBOR_LOG_LEVEL=info
EOF
```

### 4. Start Services

**Option A: Local Development Mode**

Terminal 1 (Control-plane):
```bash
cd services/control-plane
npm run dev
# Listening on port 3000
```

Terminal 2 (Web UI):
```bash
cd services/web-ui
npm run dev
# Listening on port 4173
```

**Option B: Docker Compose (Recommended)**

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f control-plane

# Stop services
docker compose down
```

### 5. Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# List assets (should be empty)
curl http://localhost:3000/api/v1/assets

# Open Web UI
open http://localhost:4173
```

## Production Installation

### Prerequisites for VAST Integration

Gather these credentials from your VAST cluster administrator:

1. **Trino Endpoint** (VAST Database)
   - Example: `https://vastdb.example.com:8443`
   - Verify: `curl -u $USERNAME:$PASSWORD https://vastdb.example.com:8443/v1/info`

2. **S3 Access Credentials** (for Trino authentication)
   - Access Key ID: `AKIA...`
   - Secret Access Key: (stored securely)

3. **Event Broker Connection** (Kafka)
   - Broker URL: `vast-broker.example.com:9092`
   - SASL Username: (VAST local user, e.g., `spaceharbor-kafka`)
   - SASL Password: (stored securely)
   - Mechanism: `PLAIN` or `SCRAM-SHA-256`

4. **DataEngine Endpoint** (optional for function invocation)
   - Example: `https://vast-engine.example.com/api`
   - VAST API Token: (Bearer token, stored securely)

### Production Configuration

Create `.env` file with secure values:

```bash
# Node.js runtime
NODE_ENV=production
SPACEHARBOR_PORT=3000
SPACEHARBOR_LOG_LEVEL=warn

# VAST Database (Trino)
VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443
VAST_TRINO_USERNAME=spaceharbor-user
VAST_TRINO_PASSWORD=<secure-password>

# VAST Event Broker (Kafka)
VAST_EVENT_BROKER_URL=vast-broker.example.com:9092
VAST_EVENT_BROKER_SASL_USERNAME=spaceharbor-kafka
VAST_EVENT_BROKER_SASL_PASSWORD=<secure-password>
VAST_EVENT_BROKER_SASL_MECHANISM=PLAIN

# VAST DataEngine
VAST_DATAENGINE_URL=https://vast-engine.example.com/api
VAST_DATAENGINE_API_TOKEN=<secure-token>

# SpaceHarbor Security
SPACEHARBOR_JWT_SECRET=<generate-with-openssl-rand-hex-32>
SPACEHARBOR_API_KEY=sh_<generate-random-key>
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=false

# TLS/HTTPS (optional, for reverse proxy)
SPACEHARBOR_TLS_CERT_PATH=/etc/spaceharbor/tls/cert.pem
SPACEHARBOR_TLS_KEY_PATH=/etc/spaceharbor/tls/key.pem
```

**Important:** Never commit `.env` to version control. Use secrets management:
- **Docker**: Use `--env-file` or orchestrator secrets
- **Kubernetes**: Use ConfigMaps and Secrets
- **AWS**: Use Systems Manager Parameter Store or Secrets Manager

### Database Initialization

Run migrations to set up VAST Database schema:

```bash
cd services/control-plane
npm run db:install

# Or manually with Trino CLI
trino --server https://vastdb.example.com:8443 \
  --user spaceharbor-user \
  --password < migrations/001-schema.sql
```

### Docker Production Build

```bash
# Build images
docker compose build

# Or using Dockerfile directly
docker build -t spaceharbor-control-plane services/control-plane/
docker build -t spaceharbor-web-ui services/web-ui/

# Run with production compose
docker compose -f docker-compose.prod.yml up -d
```

### Kubernetes Deployment (Optional)

See your organization's Kubernetes deployment guidelines. Typical steps:

1. Push images to container registry:
   ```bash
   docker tag spaceharbor-control-plane myregistry/spaceharbor-control-plane:v1.0.0
   docker push myregistry/spaceharbor-control-plane:v1.0.0
   ```

2. Deploy manifests:
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/configmap.yaml
   kubectl apply -f k8s/secret.yaml
   kubectl apply -f k8s/deployment.yaml
   kubectl apply -f k8s/service.yaml
   ```

3. Verify rollout:
   ```bash
   kubectl rollout status deployment/spaceharbor-control-plane -n spaceharbor
   ```

## Health Checks

### Endpoints

```bash
# Control-plane health
curl http://localhost:3000/health

# API connectivity (requires auth in production)
curl http://localhost:3000/api/v1/assets

# Event Broker connectivity
# Check via control-plane logs for Kafka connection status
docker compose logs control-plane | grep -i kafka

# VAST Database connectivity
# Check via control-plane logs for Trino query success
docker compose logs control-plane | grep -i trino
```

### Logs

```bash
# View all service logs
docker compose logs -f

# Follow specific service
docker compose logs -f control-plane

# Filter for errors
docker compose logs control-plane | grep -i error
```

## Troubleshooting Installation

### Services Won't Start

1. **Check ports are available:**
   ```bash
   lsof -i :3000  # Control-plane
   lsof -i :4173  # Web UI
   ```

2. **Check Docker daemon:**
   ```bash
   docker ps     # Should list running containers
   ```

3. **Review logs:**
   ```bash
   docker compose logs --tail 50
   ```

### VAST Connection Issues

If you see connection errors to Trino, Event Broker, or DataEngine:

1. **Verify endpoints are reachable:**
   ```bash
   curl -u $USER:$PASS https://vastdb.example.com:8443/v1/info
   nc -zv vast-broker.example.com 9092
   ```

2. **Check credentials in .env:**
   - Ensure `VAST_TRINO_PASSWORD` is URL-encoded if it contains special characters
   - Verify SASL mechanism matches broker configuration

3. **Check firewall rules:**
   - Ensure egress to VAST endpoints is permitted
   - Check VPN/network access if VAST is on-premises

### Database Migration Failures

If `npm run db:install` fails:

```bash
# Verify Trino connectivity first
curl -u $VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD \
  "$VAST_TRINO_ENDPOINT/v1/info"

# Check available schemas
curl -u $VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD \
  "$VAST_TRINO_ENDPOINT/v1/schema"

# Run migrations manually
npm run db:install -- --verbose
```

## Next Steps

1. **[Deployment Guide](Deployment-Guide.md)** — Production deployment checklist
2. **[Configuration Guide](Configuration-Guide.md)** — Fine-tune settings
3. **[Identity and Access](Identity-and-Access.md)** — Set up authentication and RBAC
4. **[Monitoring and Observability](Monitoring.md)** — Configure alerts and dashboards
