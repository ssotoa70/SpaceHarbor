# Troubleshooting Guide

Decision trees for the top 5 failure scenarios in SpaceHarbor.

---

## 1. Job Stuck in `processing`

**Symptom:** A job remains in `processing` state beyond the expected duration. Asset is not progressing.

```
Job stuck in "processing"?
  │
  ├─ Is the worker alive?
  │    ├─ NO → Worker crashed. Lease will expire.
  │    │        → Run: POST /api/v1/queue/reap-stale
  │    │        → This requeues jobs with expired leases.
  │    │
  │    └─ YES → Is heartbeat being sent?
  │              ├─ NO → Worker is hung. Kill and restart it.
  │              │        → docker compose restart media-worker
  │              │        → Run: POST /api/v1/queue/reap-stale
  │              │
  │              └─ YES → Processing is slow, not stuck.
  │                       → Check: GET /api/v1/jobs/<id>
  │                       → Review worker logs for progress.
```

**Quick fix:**

```bash
# Reap all jobs with expired leases
curl -X POST http://localhost:8080/api/v1/queue/reap-stale

# Check pending jobs
curl http://localhost:8080/api/v1/jobs/pending
```

---

## 2. DLQ Growing Unexpectedly

**Symptom:** `GET /api/v1/metrics` shows increasing `dlq.total` count.

```
DLQ growing?
  │
  ├─ Are all entries the same error?
  │    ├─ YES → Systematic issue.
  │    │        → Check: GET /api/v1/dlq (inspect error patterns)
  │    │        → Common causes:
  │    │          • Event contract mismatch (missing required fields)
  │    │          • VAST endpoint unreachable
  │    │          • Schema migration needed
  │    │
  │    └─ NO → Multiple failure types.
  │            → Investigate each category separately.
  │            → Check: GET /api/v1/audit for signal patterns.
  │
  ├─ Did a deployment just happen?
  │    ├─ YES → Likely a code or config regression.
  │    │        → Roll back to previous version.
  │    │        → After fix: POST /api/v1/dlq/replay-all
  │    │
  │    └─ NO → External dependency issue.
  │            → Check Trino, Event Broker, DataEngine connectivity.
```

**Quick fix:**

```bash
# Inspect DLQ contents
curl http://localhost:8080/api/v1/dlq

# Replay after root cause is fixed
curl -X POST http://localhost:8080/api/v1/dlq/replay-all
```

---

## 3. VAST Fallback Signals in Audit Log

**Symptom:** Audit log shows `signal.code=VAST_FALLBACK` entries. Metrics show elevated fallback rate.

```
VAST_FALLBACK signals appearing?
  │
  ├─ Is Trino reachable?
  │    ├─ NO → Network or VAST cluster issue.
  │    │        → Check: curl $VAST_TRINO_ENDPOINT/v1/info
  │    │        → Check: vastcmd cluster show
  │    │        → Verify DNS resolution and firewall rules.
  │    │
  │    └─ YES → Authentication issue?
  │              ├─ Check: VAST_TRINO_USERNAME / VAST_TRINO_PASSWORD in .env
  │              ├─ Try manual query:
  │              │    curl -u "$VAST_TRINO_USERNAME:$VAST_TRINO_PASSWORD" \
  │              │      "$VAST_TRINO_ENDPOINT/v1/statement" \
  │              │      -d "SELECT 1"
  │              │
  │              └─ Is SPACEHARBOR_VAST_STRICT=true?
  │                   ├─ YES → Writes are failing-fast (503).
  │                   │        → Fix connectivity, then restart.
  │                   │
  │                   └─ NO → Fallback mode is active.
  │                           → Service continues in degraded mode.
  │                           → Fix connectivity, then restart to reset counters.
```

**Quick fix:**

```bash
# Check current fallback state
curl http://localhost:8080/api/v1/metrics | jq '.degradedMode'

# Check audit for fallback signals
curl http://localhost:8080/api/v1/audit | jq '[.[] | select(.signal.code == "VAST_FALLBACK")]'
```

---

## 4. Web UI Not Updating in Real Time

**Symptom:** Asset status changes in API but the web UI shows stale data. SSE connection may be broken.

```
UI not updating?
  │
  ├─ Is the SSE connection active?
  │    → Open browser DevTools → Network tab → filter "EventStream"
  │    ├─ NO connection visible → SSE endpoint unreachable.
  │    │    → Check: curl http://localhost:8080/events/stream
  │    │    → Check: control-plane health
  │    │    → Verify no proxy/reverse-proxy is buffering SSE responses.
  │    │
  │    └─ Connection exists but no events →
  │         ├─ Are changes actually happening?
  │         │    → Check: GET /api/v1/assets (verify API has updates)
  │         │
  │         └─ SSE endpoint not emitting events.
  │              → Restart control-plane.
  │              → Check ConnectionIndicator component in UI header.
  │
  ├─ Is the control-plane healthy?
  │    → Check: curl http://localhost:8080/health
  │    ├─ NO → Restart: docker compose restart control-plane
  │    └─ YES → Check browser console for JavaScript errors.
```

**Quick fix:**

```bash
# Test SSE endpoint directly
curl -N http://localhost:8080/events/stream

# Verify control-plane health
curl http://localhost:8080/health
```

---

## 5. Scanner Function Not Triggering on New Files

**Symptom:** New files are written to the VAST view but the scanner function does not fire.

```
Scanner not triggering?
  │
  ├─ What protocol is the view using?
  │    ├─ NFS → Element triggers do NOT fire on NFS writes.
  │    │        → NFS views require polling-based ingestion.
  │    │        → Switch to S3 protocol for automatic triggers.
  │    │
  │    └─ S3 → Element trigger should fire.
  │            → Is the element trigger configured?
  │              ├─ NO → Configure via VAST CLI or web UI.
  │              │        → See: services/scanner-function/trigger-config.md
  │              │
  │              └─ YES → Check DataEngine job logs.
  │                       ├─ Is the function deployed?
  │                       │    → Verify via VAST DataEngine UI
  │                       │
  │                       └─ Is the function failing?
  │                            → Check function logs in DataEngine
  │                            → Common issues:
  │                              • Missing env vars (KAFKA_BROKER, CONTROL_PLANE_URL)
  │                              • Python dependency issues
  │                              • Permissions on the S3 bucket/view
```

**Quick fix:**

```bash
# Check if scanner function is registered in DataEngine
# (requires VAST CLI access)
vastcmd dataengine function list

# Verify trigger configuration
vastcmd dataengine trigger list --view <view-name>

# Check scanner function logs
vastcmd dataengine function logs --name spaceharbor-scanner
```

---

## Related Documentation

- [Runbook](runbook.md) — operational procedures, SLOs, escalation matrix
- [Disaster Recovery](disaster-recovery.md) — recovery procedures for major incidents
- [Monitoring Setup](monitoring-setup.md) — observable endpoints and alerting
