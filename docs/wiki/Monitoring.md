# Monitoring and Observability

Health checks, metrics, and alerting configuration.

## Health Check Endpoints

### Application Health

```bash
GET /health
```

Response (200 OK):
```json
{
  "status": "ok",
  "service": "control-plane"
}
```

Use this for load balancer health checks and uptime monitoring.

### Detailed Metrics

```bash
GET /api/v1/metrics
```

Response:
```json
{
  "service": "control-plane",
  "timestamp": "2026-03-23T10:00:00.000Z",
  "uptime_seconds": 86400,
  "assets": {
    "total": 1250,
    "byStatus": {
      "ingest": 45,
      "processing": 23,
      "approved": 1180,
      "archived": 2
    }
  },
  "jobs": {
    "pending": 8,
    "processing": 3,
    "completed": 1210,
    "failed": 5
  },
  "queue": {
    "pending": 8,
    "leased": 3,
    "dlq": 5
  },
  "processingTime": {
    "avg_seconds": 45,
    "p50_seconds": 30,
    "p95_seconds": 120,
    "p99_seconds": 300
  },
  "api": {
    "requests_total": 45230,
    "requests_per_second": 5.2,
    "error_rate": 0.02,
    "latency_p95_ms": 250,
    "latency_p99_ms": 500
  },
  "database": {
    "connections_active": 8,
    "connections_max": 20,
    "query_latency_p95_ms": 100,
    "query_latency_p99_ms": 250
  },
  "events": {
    "published": 8420,
    "published_per_second": 0.1,
    "consumed": 8410,
    "lag_events": 10,
    "lag_seconds": 2
  }
}
```

## Key Metrics

Monitor these critical indicators:

| Metric | Threshold | Action |
|--------|-----------|--------|
| API Response Time (p95) | > 1000 ms | Check VAST connectivity, increase replicas |
| Error Rate | > 1% | Review logs, check DLQ, audit connectivity |
| Job Failure Rate | > 5% | Review DataEngine logs, check function health |
| DLQ Size | Growing | Diagnose failed jobs, replay after fix |
| Event Lag | > 60 seconds | Increase Kafka consumer threads |
| Database Connections | > 80% of max | Increase pool size or replicas |
| Memory Usage | > 75% | Increase container memory limit |
| Disk Usage (Element Store) | > 80% | Archive old assets, add storage |

## Logging Configuration

### Log Levels

```bash
# Levels: trace | debug | info | warn | error | fatal
SPACEHARBOR_LOG_LEVEL=info  # Production default
```

Log output includes:
- Timestamp (ISO 8601)
- Level (INFO, WARN, ERROR)
- Service name
- Request ID (for tracing)
- Message
- Context (optional)

### Structured Logging

Logs are output as JSON for easy parsing:

```json
{
  "timestamp": "2026-03-23T10:00:00.000Z",
  "level": "info",
  "service": "control-plane",
  "requestId": "corr-123",
  "message": "Asset ingested",
  "assetId": "asset-uuid",
  "duration_ms": 250
}
```

### Log Aggregation

Recommended log aggregation tools:

**ELK Stack (Elasticsearch, Logstash, Kibana):**
```bash
# Forward logs to Logstash
docker logs control-plane | \
  jq . | \
  nc logstash.example.com 5000
```

**Loki (Grafana):**
```bash
# Loki configuration
SPACEHARBOR_LOG_FORMAT=json
# Use Promtail to scrape logs
```

**CloudWatch (AWS):**
```bash
# Log group: /spaceharbor/control-plane
# Log stream: <instance-id>
# Use CloudWatch agent
```

**Splunk:**
```bash
# Forward via syslog or HTTP Event Collector
docker logs control-plane | \
  curl -X POST https://splunk.example.com:8088/services/collector \
    -H "Authorization: Splunk $SPLUNK_TOKEN" \
    -d @-
```

## Distributed Tracing

Enable request tracing across services:

```bash
# OpenTelemetry configuration (optional)
SPACEHARBOR_TRACING_ENABLED=true
SPACEHARBOR_TRACING_SAMPLE_RATE=0.1  # 10% of requests
SPACEHARBOR_JAEGER_ENDPOINT=http://jaeger.example.com:14268/api/traces
```

Trace context includes:
- Request ID
- Parent span ID
- Service boundaries
- Latency per service

## Alerting

### Essential Alerts

Configure alerts for these conditions:

#### 1. API Response Time Degradation

```
IF api.latency_p95_ms > 1000 ms FOR 5 minutes
THEN alert("Control-plane API slow")
```

**Action:** Check VAST connectivity, increase replicas

#### 2. Error Rate Spike

```
IF api.error_rate > 0.01 FOR 2 minutes
THEN alert("Control-plane error rate high")
```

**Action:** Review logs, check DLQ

#### 3. DLQ Growing

```
IF dlq_size increasing BY > 5 jobs/minute FOR 5 minutes
THEN alert("DLQ backlog increasing")
```

**Action:** Diagnose failed jobs, resolve root cause

#### 4. VAST Connectivity Lost

```
IF database.connections_active == 0 FOR 1 minute
THEN alert("Lost connection to VAST Trino")
```

**Action:** Verify network, check VAST cluster

#### 5. Kafka Event Lag

```
IF events.lag_seconds > 60
THEN alert("Event processing lag detected")
```

**Action:** Increase consumer threads

#### 6. Memory/CPU Exhaustion

```
IF memory_usage > 0.9 OR cpu_usage > 0.9 FOR 5 minutes
THEN alert("Resource exhaustion")
```

**Action:** Increase container limits or add replicas

### Prometheus Example

```yaml
groups:
  - name: spaceharbor
    interval: 30s
    rules:
      - alert: SpaceHarborAPILatencyHigh
        expr: spaceharbor_api_latency_p95_ms > 1000
        for: 5m
        annotations:
          summary: "Control-plane API latency high"

      - alert: SpaceHarborErrorRateHigh
        expr: spaceharbor_api_error_rate > 0.01
        for: 2m
        annotations:
          summary: "Control-plane error rate > 1%"

      - alert: SpaceHarborDLQGrowing
        expr: rate(spaceharbor_dlq_jobs_total[5m]) > 1
        for: 5m
        annotations:
          summary: "DLQ growing at > 1 job/minute"
```

## Grafana Dashboards

### Dashboard: System Health

**Panels:**
- API response time (p50, p95, p99)
- Error rate and error codes
- Requests per second
- Database connection pool usage
- Memory and CPU usage

### Dashboard: Asset Processing

**Panels:**
- Assets by status (pending, processing, approved)
- Job success/failure rate
- Average processing time per stage
- DLQ size and growth rate
- DataEngine function performance

### Dashboard: Event Pipeline

**Panels:**
- Events published per second
- Events consumed per second
- Event processing lag
- Kafka consumer group lag
- Event types distribution

### Dashboard: VAST Integration

**Panels:**
- Trino query latency
- Kafka broker health
- DataEngine function success rate
- Element Store usage
- Fallback mode activation

## Uptime Monitoring

### Uptime Check

```bash
# External uptime monitoring
curl -X GET https://spaceharbor.example.com/health \
  --connect-timeout 5 \
  --max-time 10
```

Configure uptime monitoring service (Pingdom, UptimeRobot, etc.):
- Endpoint: `https://spaceharbor.example.com/health`
- Interval: 5 minutes
- Timeout: 10 seconds
- Alert on failure: Notify ops team

## Performance Profiling

### Enable Profiling (Development Only)

```bash
SPACEHARBOR_PROFILING_ENABLED=true
SPACEHARBOR_PROFILE_SAMPLE_RATE=0.1  # 10% overhead
```

Generates CPU and memory profiles:
- `/metrics/cpu.prof` — CPU profile
- `/metrics/mem.prof` — Memory profile
- `/metrics/heap.prof` — Heap profile

Analyze with Node.js tools:

```bash
node --prof-process isolate-*.log > processed.txt
```

## Custom Metrics

Expose custom metrics via metrics endpoint:

```bash
GET /api/v1/metrics/custom?metric=asset_ingest_duration
```

Emit custom metrics in application code:

```typescript
import { metrics } from './observability';

metrics.histogram('asset.ingest.duration', duration_ms, {
  tags: { status: 'success', format: 'exr' }
});
```

## Production Runbook

### Daily Checks

- [ ] API health: `curl /health`
- [ ] Error rate: `curl /api/v1/metrics | jq '.api.error_rate'`
- [ ] DLQ size: `curl /api/v1/dlq | jq '.total'`
- [ ] VAST connectivity: Check logs for `VAST_FALLBACK` signals

### Weekly Reviews

- [ ] Review alert history
- [ ] Check disk usage trends
- [ ] Review slow query logs
- [ ] Validate backup/restore procedures

### Monthly Reviews

- [ ] Capacity planning (storage, compute)
- [ ] Performance trend analysis
- [ ] Security audit (access logs, auth changes)
- [ ] Update runbooks and documentation

## See Also

- [Deployment Guide](Deployment-Guide.md) — Initial setup
- [Configuration Guide](Configuration-Guide.md) — Settings
- [Troubleshooting](Troubleshooting.md) — Common issues
