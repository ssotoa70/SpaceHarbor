# Monitoring and Alerting Setup Guide

## Observable Endpoints

SpaceHarbor exposes the following endpoints for monitoring:

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `GET /health` | GET | No | Liveness probe — returns `200` when the process is running |
| `GET /health/ready` | GET | No | Readiness probe — returns `200` when dependencies are connected |
| `GET /api/v1/metrics` | GET | No | Queue counters, job counts by status, DLQ total, fallback state |
| `GET /api/v1/audit` | GET | No | Recent audit events with structured `signal` fields |

### Metrics Endpoint Response Shape

`GET /api/v1/metrics` returns JSON:

```json
{
  "queue": {
    "pending": 3,
    "processing": 1,
    "completed": 142,
    "failed": 2
  },
  "dlq": {
    "total": 1,
    "oldestAge": "2026-03-10T14:00:00Z"
  },
  "degradedMode": {
    "active": false,
    "fallbackEvents": 0,
    "lastFallbackAt": null
  },
  "assets": {
    "total": 156,
    "byStatus": {
      "ingest": 4,
      "processing": 1,
      "approved": 140,
      "archived": 11
    }
  }
}
```

> **Note:** `/api/v1/metrics` returns JSON, **not** Prometheus exposition format. Use a JSON exporter or custom scraper to bridge to Prometheus (see below).

---

## Prometheus Integration

### Option A: JSON Exporter (Recommended)

Use [json_exporter](https://github.com/prometheus-community/json_exporter) to scrape the JSON metrics endpoint.

**json_exporter config (`config.yml`):**

```yaml
modules:
  spaceharbor:
    metrics:
      - name: spaceharbor_queue_pending
        path: "{ .queue.pending }"
        help: "Number of pending jobs in the queue"
      - name: spaceharbor_queue_processing
        path: "{ .queue.processing }"
        help: "Number of jobs currently processing"
      - name: spaceharbor_queue_completed
        path: "{ .queue.completed }"
        help: "Total completed jobs"
      - name: spaceharbor_queue_failed
        path: "{ .queue.failed }"
        help: "Total failed jobs"
      - name: spaceharbor_dlq_total
        path: "{ .dlq.total }"
        help: "Dead letter queue size"
      - name: spaceharbor_degraded_mode_active
        path: "{ .degradedMode.active }"
        help: "Whether VAST fallback mode is active (0 or 1)"
      - name: spaceharbor_degraded_mode_fallback_events
        path: "{ .degradedMode.fallbackEvents }"
        help: "Count of fallback events since last restart"
      - name: spaceharbor_assets_total
        path: "{ .assets.total }"
        help: "Total number of assets"
```

**Prometheus scrape config (`prometheus.yml`):**

```yaml
scrape_configs:
  - job_name: spaceharbor
    metrics_path: /probe
    params:
      module: [spaceharbor]
      target: ["http://control-plane:8080/api/v1/metrics"]
    static_configs:
      - targets: ["json-exporter:7979"]
    relabel_configs:
      - source_labels: [__param_target]
        target_label: instance

  - job_name: spaceharbor-health
    metrics_path: /health
    static_configs:
      - targets: ["control-plane:8080"]
```

### Option B: Direct Scrape (Health Only)

If you only need liveness monitoring:

```yaml
scrape_configs:
  - job_name: spaceharbor-liveness
    static_configs:
      - targets: ["control-plane:8080"]
    metrics_path: /health
    scrape_interval: 15s
```

---

## Alert Thresholds

Based on the SLO definitions in the [Runbook](runbook.md):

| Signal | Warning | Critical | Source |
|--------|---------|----------|--------|
| DLQ total | > 10 | > 50 | `GET /api/v1/metrics` → `.dlq.total` |
| Pending jobs (sustained) | > 100 for 5 min | > 150 for 5 min | `GET /api/v1/metrics` → `.queue.pending` |
| Fallback rate | > 5% of requests | > 20% of requests | `GET /api/v1/metrics` → `.degradedMode` |
| Fallback events (burst) | +5 in 10 min | +20 in 10 min | `GET /api/v1/metrics` → `.degradedMode.fallbackEvents` |
| DLQ growth (burst) | +3 in 15 min | +10 in 15 min | `GET /api/v1/metrics` → `.dlq.total` delta |
| Health check failure | 1 failure | 3 consecutive | `GET /health` |

### Prometheus Alerting Rules Example

```yaml
groups:
  - name: spaceharbor
    rules:
      - alert: SpaceHarborDLQWarning
        expr: spaceharbor_dlq_total > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "DLQ has {{ $value }} entries"

      - alert: SpaceHarborDLQCritical
        expr: spaceharbor_dlq_total > 50
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "DLQ critical: {{ $value }} entries"

      - alert: SpaceHarborPendingQueueHigh
        expr: spaceharbor_queue_pending > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $value }} pending jobs for > 5 minutes"

      - alert: SpaceHarborFallbackActive
        expr: spaceharbor_degraded_mode_active == 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "VAST fallback mode is active"

      - alert: SpaceHarborDown
        expr: up{job="spaceharbor-health"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "SpaceHarbor control-plane is unreachable"
```

---

## Grafana Dashboard Setup

### Step 1: Add Prometheus Data Source

1. Open Grafana (default: `http://localhost:3000`)
2. Go to **Configuration > Data Sources > Add data source**
3. Select **Prometheus**
4. Set URL to your Prometheus instance (e.g., `http://prometheus:9090`)
5. Click **Save & Test**

### Step 2: Import Dashboard

Create a dashboard with the following panels:

| Panel | Type | Query | Description |
|-------|------|-------|-------------|
| Queue Overview | Stat | `spaceharbor_queue_pending` | Current pending count |
| DLQ Size | Gauge | `spaceharbor_dlq_total` | DLQ entries (red > 50) |
| Fallback Mode | Stat | `spaceharbor_degraded_mode_active` | 0 = healthy, 1 = degraded |
| Job Throughput | Time series | `rate(spaceharbor_queue_completed[5m])` | Jobs completed per second |
| Queue Trend | Time series | `spaceharbor_queue_pending` | Pending jobs over time |
| DLQ Trend | Time series | `spaceharbor_dlq_total` | DLQ size over time |
| Fallback Events | Time series | `spaceharbor_degraded_mode_fallback_events` | Cumulative fallback events |
| Asset Distribution | Pie chart | `spaceharbor_assets_total` by status | Asset count by status |

### Step 3: Configure Notification Channels

1. Go to **Alerting > Notification channels**
2. Add Slack webhook or email channel
3. Link to the alert rules defined above

---

## Related Documentation

- [Runbook](runbook.md) — SLO definitions, escalation matrix, operational procedures
- [Disaster Recovery](disaster-recovery.md) — recovery procedures for major incidents
- [Troubleshooting](troubleshooting.md) — decision trees for common failure scenarios
