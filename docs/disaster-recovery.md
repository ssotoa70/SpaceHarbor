# Disaster Recovery Guide

## Recovery Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RTO** (Recovery Time Objective) | 4 hours | Time from incident detection to service restoration |
| **RPO** (Recovery Point Objective) | 1 hour | Maximum acceptable data loss window |

These targets assume VAST Database snapshots are taken hourly and container orchestration can restart services within minutes.

---

## Recovery Procedures

### 1. Control-Plane Process Crash

**Symptoms:** Health check fails, API returns 5xx or connection refused.

**Recovery:**

1. Restart the container:
   ```bash
   docker compose restart control-plane
   ```
2. Verify health:
   ```bash
   curl http://localhost:8080/health
   curl http://localhost:8080/health/ready
   ```
3. Check event dedup state — the in-memory `processedEventIds` set resets on restart. Duplicate events may be reprocessed (idempotent by design).
4. Review audit log for any missed events:
   ```bash
   curl http://localhost:8080/api/v1/audit
   ```

**Post-recovery:** Confirm no jobs are stuck in `processing` state by running `POST /api/v1/queue/reap-stale`.

---

### 2. Trino Unreachable (VAST Database Down)

**Symptoms:** API calls return 500 errors, `VAST_FALLBACK` signals in audit log, metrics show elevated fallback rate.

**Recovery:**

1. **If `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=true`:** The control-plane automatically falls back to the local adapter. Operations continue in degraded mode.
2. **If `SPACEHARBOR_VAST_STRICT=true`:** Writes fail-fast with 503. Restore Trino connectivity as a priority.
3. Diagnose the Trino endpoint:
   ```bash
   curl -u "$VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD" \
     "$VAST_TRINO_ENDPOINT/v1/info"
   ```
4. Check VAST cluster status via VAST web UI or `vastcmd cluster show`.
5. Once Trino is back, restart the control-plane to reset fallback counters:
   ```bash
   docker compose restart control-plane
   ```
6. Verify job state consistency — compare job counts between `/api/v1/metrics` and a Trino query:
   ```sql
   SELECT status, COUNT(*) FROM spaceharbor.workflow_jobs GROUP BY status;
   ```

**Post-recovery:** Monitor `GET /api/v1/audit` for `VAST_FALLBACK` signals to confirm they stop appearing.

---

### 3. Event Broker Topic Recovery

**Symptoms:** No new events arriving, VastEventSubscriber logs show connection errors, DLQ growing.

**Recovery:**

1. Verify Event Broker connectivity:
   ```bash
   # Check if the broker is reachable
   nc -zv <broker-host> 9092
   ```
2. Check consumer group status (requires Kafka CLI tools):
   ```bash
   kafka-consumer-groups --bootstrap-server <broker-url> \
     --group spaceharbor-control-plane --describe
   ```
3. If consumer group lag is excessive, replay events from the earliest offset:
   ```bash
   kafka-consumer-groups --bootstrap-server <broker-url> \
     --group spaceharbor-control-plane \
     --reset-offsets --to-earliest --execute \
     --topic spaceharbor.dataengine.completed
   ```
4. Restart the control-plane to re-establish the Kafka consumer connection.
5. Monitor `GET /api/v1/metrics` for resumed event processing.

**Post-recovery:** Duplicate events will be deduplicated by the `processedEventIds` set. Events that were already processed will be safely ignored.

---

### 4. Metadata Inconsistency (Asset/Job State Mismatch)

**Symptoms:** Asset shows `processing` but no active job exists, or job is `completed` but asset is still `ingest`.

**Recovery:**

1. Query asset and job state from VAST Database:
   ```sql
   SELECT a.id, a.status, j.id AS job_id, j.status AS job_status
   FROM spaceharbor.assets a
   LEFT JOIN spaceharbor.workflow_jobs j ON j.asset_id = a.id
   WHERE a.id = '<asset-id>';
   ```
2. If asset state is stale, manually transition via API:
   ```bash
   # For a completed job whose asset didn't transition:
   curl -X PUT http://localhost:8080/api/v1/assets/<id>/status \
     -H "Content-Type: application/json" \
     -d '{"status": "approved"}'
   ```
3. Run the audit verification endpoint to check for state inconsistencies:
   ```bash
   curl -X POST http://localhost:8080/api/v1/audit
   ```

---

### 5. DLQ Replay After Recovery

After any recovery event, the DLQ may contain events that failed during the incident window.

1. Review DLQ contents:
   ```bash
   curl http://localhost:8080/api/v1/dlq
   ```
2. Replay all recoverable events:
   ```bash
   curl -X POST http://localhost:8080/api/v1/dlq/replay-all
   ```
3. Monitor for successful processing via `/api/v1/metrics`.

---

## Backup Strategy

| Component | Backup Method | Frequency | Retention |
|-----------|--------------|-----------|-----------|
| VAST Database (Trino) | VAST snapshots | Hourly | 7 days |
| Event Broker topics | Kafka topic retention | Continuous (72h default) | 72 hours |
| Application config (`.env`) | Source control / secrets manager | On change | Indefinite |
| Audit logs | `/api/v1/audit` + VAST DB | Continuous | 90 days (configurable) |

---

## Related Documentation

- [Runbook](runbook.md) — operational procedures, SLOs, escalation matrix
- [Troubleshooting](troubleshooting.md) — decision trees for common failure scenarios
- [Monitoring Setup](monitoring-setup.md) — observable endpoints, alerting thresholds
