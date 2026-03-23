# Deployment Guide

Production deployment checklist and procedures for SpaceHarbor.

## Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] VAST cluster is accessible (Trino, Event Broker, DataEngine)
- [ ] DNS records resolve to cluster endpoints
- [ ] Firewall rules permit outbound connections to VAST services
- [ ] VAST credentials are stored securely (not in git, not in logs)
- [ ] TLS certificates are valid and installed
- [ ] Backup and disaster recovery plan is documented
- [ ] Monitoring and alerting are configured
- [ ] Team has access to runbooks and escalation paths

## Environment Variables

### Required for Production

```bash
# Node.js
NODE_ENV=production
SPACEHARBOR_PORT=3000
SPACEHARBOR_LOG_LEVEL=warn

# VAST Database (Trino)
VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443
VAST_TRINO_USERNAME=spaceharbor-user
VAST_TRINO_PASSWORD=<secure>

# VAST Event Broker (Kafka)
VAST_EVENT_BROKER_URL=vast-broker.example.com:9092
VAST_EVENT_BROKER_SASL_USERNAME=spaceharbor-kafka
VAST_EVENT_BROKER_SASL_PASSWORD=<secure>
VAST_EVENT_BROKER_SASL_MECHANISM=PLAIN

# Security
SPACEHARBOR_JWT_SECRET=<secure-32-byte-hex>
SPACEHARBOR_API_KEY=sh_<random-key>
SPACEHARBOR_IAM_ENABLED=true
SPACEHARBOR_IAM_SHADOW_MODE=false
```

### Optional Configuration

```bash
# VAST DataEngine (for serverless processing)
VAST_DATAENGINE_URL=https://vast-engine.example.com/api
VAST_DATAENGINE_API_TOKEN=<secure>

# TLS/HTTPS (if reverse proxy is not terminating TLS)
SPACEHARBOR_TLS_CERT_PATH=/etc/spaceharbor/tls/cert.pem
SPACEHARBOR_TLS_KEY_PATH=/etc/spaceharbor/tls/key.pem

# Logging and Observability
SPACEHARBOR_LOG_LEVEL=warn
SPACEHARBOR_METRICS_ENABLED=true
SPACEHARBOR_AUDIT_RETENTION_DAYS=90
```

## Deployment Options

### Option 1: Docker Compose (Small Deployments)

Suitable for teams with <50 concurrent users.

```bash
# 1. Create production .env file
cat > .env.production << EOF
NODE_ENV=production
VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443
# ... (all required variables)
EOF

# 2. Build images
docker compose build

# 3. Start services
docker compose -f docker-compose.yml up -d

# 4. Verify health
curl http://localhost:3000/health
```

### Option 2: Kubernetes (Enterprise Deployments)

Suitable for teams with >50 concurrent users or multi-region deployments.

```bash
# 1. Create namespace
kubectl create namespace spaceharbor

# 2. Create secrets for sensitive data
kubectl create secret generic spaceharbor-secrets \
  --from-literal=VAST_TRINO_PASSWORD=<value> \
  --from-literal=VAST_EVENT_BROKER_SASL_PASSWORD=<value> \
  --from-literal=SPACEHARBOR_JWT_SECRET=<value> \
  -n spaceharbor

# 3. Apply configuration
kubectl apply -f k8s/configmap.yaml -n spaceharbor
kubectl apply -f k8s/deployment.yaml -n spaceharbor

# 4. Expose via service
kubectl apply -f k8s/service.yaml -n spaceharbor
kubectl apply -f k8s/ingress.yaml -n spaceharbor  # For external access

# 5. Verify rollout
kubectl rollout status deployment/spaceharbor-control-plane -n spaceharbor
```

### Option 3: Cloud Platforms (AWS, GCP, Azure)

#### AWS ECS

```bash
# 1. Push images to ECR
aws ecr get-login-password --region us-east-1 | docker login \
  --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag spaceharbor-control-plane:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/spaceharbor-control-plane:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/spaceharbor-control-plane:latest

# 2. Create ECS task definition and service
# (Use AWS Console or Terraform)

# 3. Deploy
aws ecs update-service --cluster spaceharbor --service spaceharbor-api --force-new-deployment
```

#### Google Cloud Run

```bash
# 1. Build and push to GCR
gcloud builds submit --tag gcr.io/my-project/spaceharbor-control-plane

# 2. Deploy to Cloud Run
gcloud run deploy spaceharbor-control-plane \
  --image gcr.io/my-project/spaceharbor-control-plane \
  --platform managed \
  --region us-central1 \
  --set-env-vars NODE_ENV=production,VAST_TRINO_ENDPOINT=https://vastdb.example.com:8443 \
  --memory 2Gi \
  --cpu 2
```

## Load Balancing and Reverse Proxy

### Nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name spaceharbor.example.com;

    ssl_certificate /etc/spaceharbor/tls/cert.pem;
    ssl_certificate_key /etc/spaceharbor/tls/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Control-plane API
    location /api/ {
        proxy_pass http://control-plane:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support for SSE
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # Web UI
    location / {
        proxy_pass http://web-ui:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://control-plane:3000/health;
        access_log off;
    }
}
```

### HAProxy Example

```
global
    log stdout local0
    maxconn 4096

defaults
    mode http
    log global
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

frontend spaceharbor_frontend
    bind *:443 ssl crt /etc/spaceharbor/tls/cert.pem
    bind *:80
    redirect scheme https code 301 if !{ ssl_fc }

    acl api_path path_beg /api/
    use_backend control_plane if api_path
    default_backend web_ui

backend control_plane
    server control-plane-1 control-plane:3000 check
    server control-plane-2 control-plane:3000 check

backend web_ui
    server web-ui-1 web-ui:4173 check
```

## Database Initialization

Initialize the VAST Database schema before first deployment:

```bash
cd services/control-plane
npm run db:install

# Verify migrations applied
# (Check control-plane logs for "migrations completed")
```

## Health Checks

### Application Health

```bash
# Check control-plane is responding
curl https://spaceharbor.example.com/health

# Check API is accessible
curl https://spaceharbor.example.com/api/v1/assets \
  -H "Authorization: Bearer <api-key>"
```

### VAST Connectivity

Control-plane logs will indicate connection status:

```bash
docker compose logs control-plane | grep -E "trino|kafka|dataengine"
```

If connections are failing, see [Troubleshooting](Troubleshooting.md).

## Scaling Considerations

### Horizontal Scaling

SpaceHarbor control-plane is stateless and can be replicated:

```bash
# Docker Compose: Scale control-plane
docker compose up -d --scale control-plane=3

# Kubernetes: Scale deployment
kubectl scale deployment spaceharbor-control-plane --replicas=3 -n spaceharbor
```

All instances share the same VAST Database and Event Broker.

### Performance Tuning

**Connection Pooling** (VAST Trino):
```
VAST_TRINO_POOL_SIZE=20  # Trino connections per instance
```

**Event Broker** (Kafka):
```
VAST_EVENT_BROKER_CONSUMER_THREADS=4  # Parallel event consumption
```

**Memory and CPU**:
- Control-plane: 512 MB - 2 GB (depends on concurrent asset volume)
- Web-UI: 128 MB - 512 MB (CDN recommended for static assets)
- DataEngine: Scales with VAST cluster, not tuned per SpaceHarbor

## Monitoring and Logging

### Essential Metrics

Monitor these key indicators:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Control-plane latency | > 1s | Check VAST connectivity |
| Job failure rate | > 5% | Review DLQ, check DataEngine logs |
| Event processing lag | > 30s | Increase Kafka consumer threads |
| API error rate | > 1% | Check auth, permissions, schema |

### Log Aggregation

Recommended setup:

```bash
# Send logs to centralized system (ELK, Loki, CloudWatch, etc.)
docker compose up -d
docker compose logs -f control-plane | \
  jq . | \
  curl -X POST http://logs.example.com/api/logs -d @-
```

### Alerts

Configure alerts for:
- API response time > 5s
- Error rate > 2%
- Job DLQ size increasing
- VAST connectivity failures
- Disk usage on VAST Element Store > 80%

See [Monitoring and Observability](Monitoring.md) for detailed setup.

## Backup and Disaster Recovery

### State Backup

SpaceHarbor state lives in VAST Database (managed by VAST). Ensure your VAST cluster has:

- [ ] Regular snapshots enabled
- [ ] Backup to separate storage (S3, NFS, etc.)
- [ ] Restore tested and documented
- [ ] Recovery time objective (RTO) < 4 hours
- [ ] Recovery point objective (RPO) < 1 hour

### Configuration Backup

Backup these files:

```bash
# Environment configuration
.env.production

# TLS certificates
/etc/spaceharbor/tls/cert.pem
/etc/spaceharbor/tls/key.pem

# Deployment manifests
k8s/*.yaml
docker-compose.yml
```

### Disaster Recovery Procedure

See [Disaster Recovery Guide](../docs/disaster-recovery.md) for detailed procedures.

## Post-Deployment

1. **Run Health Checks**
   ```bash
   curl https://spaceharbor.example.com/health
   ```

2. **Test Asset Ingest**
   - Ingest a small test asset
   - Verify metadata extraction completes
   - Confirm asset appears in Web UI

3. **Verify Monitoring**
   - Check logs are being collected
   - Confirm alerts are firing for test conditions
   - Review dashboard visibility

4. **Document Configuration**
   - Record Trino/Event Broker endpoints
   - Document SASL credentials location
   - Note deployment contact/escalation path

5. **Team Training**
   - Share access credentials
   - Review asset ingest workflow
   - Identify on-call contact

## Rollback

If deployment encounters issues:

```bash
# Docker Compose: Stop and remove
docker compose down

# Restart previous version
git checkout <previous-tag>
docker compose build
docker compose up -d

# Kubernetes: Rollback deployment
kubectl rollout undo deployment/spaceharbor-control-plane -n spaceharbor
kubectl rollout status deployment/spaceharbor-control-plane -n spaceharbor
```

## See Also

- [Configuration Guide](Configuration-Guide.md) — Fine-tune settings
- [Monitoring and Observability](Monitoring.md) — Alerts and dashboards
- [Troubleshooting](Troubleshooting.md) — Common issues
- [Disaster Recovery Guide](../docs/disaster-recovery.md) — Recovery procedures
