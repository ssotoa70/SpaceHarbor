# Production Readiness — Hard Conditions Register

**Purpose:** Master tracking document for all conditions that must be met before
SpaceHarbor can be deployed against a production VAST cluster.

**Owner:** VAST Platform Engineer (validation), Scrum Master (tracking)
**Last updated:** 2026-03-12
**Status:** Pre-production

---

## Hard Conditions Summary

| # | Condition | Severity | Track | Status |
|---|-----------|----------|-------|--------|
| C1 | Implement VastWorkflowClient (Trino SQL for all workflow ops) | CRITICAL | Track 1 — Section C | ✅ Complete |
| C2 | Fix mtlx/otio parsers to use shared CloudEvent publisher | HIGH | Track 1 — Section B | ✅ Complete |
| C3 | Add Trino nextUri polling backoff (50-100ms) | HIGH | Track 1 — Section D.1 | ✅ Complete |
| C4 | Implement bounded processedEventIds (LRU/TTL eviction) | HIGH | Track 1 — Section E | ✅ Complete |
| **C5** | **Validate DataEngine container env var mapping on real VAST cluster** | MEDIUM | **This document** | 🚫 Blocked — needs VAST cluster |
| C6 | Document VAST Event Broker local-user auth requirement | MEDIUM | Track 3 — Section E.1 | ✅ Complete |
| C7 | Clean kafkajs from dependency tree | MEDIUM | Track 1 — Section D.2 | ✅ Complete |
| S1 | Fix SQL injection in Python trino_client.py (CVSS 9.8) | CRITICAL | Track 1 — Section A.1 | ✅ Complete |
| S2 | Fix DEV_MODE defaulting to true in openassetio-manager | HIGH | Track 1 — Section A.2 | ✅ Complete |
| S3 | Fix silent Kafka event drops in cloudevent_publisher | HIGH | Track 1 — Section A.3 | ✅ Complete |
| S4 | Add request timeouts to all Python HTTP calls | HIGH | Track 1 — Section A.4 | ✅ Complete |

**Legend:** ✅ Complete · 🔄 In Progress · ⬜ Not started · 🚫 Blocked

---

## C5 — DataEngine Container Env Var Mapping Validation

**Severity:** MEDIUM
**Requires:** Real VAST cluster access (Phase 4 prerequisite)
**Blocking:** Phase 4 integration testing sprint start
**Owner:** VAST Platform Engineer

### Background

The secondary DataEngine functions (`oiio-proxy-generator`, `mtlx-parser`, `otio-parser`)
use a `main()` entrypoint with environment variables (`VAST_SOURCE_PATH`, `VAST_ASSET_ID`)
instead of the `handler(ctx, event)` signature. This is valid for VAST DataEngine container
mode, but the environment variable names used are **custom conventions** — not standard
DataEngine-provided variables.

When VAST DataEngine invokes a container, the element trigger event payload is delivered
via a defined mechanism (environment variables, stdin, or HTTP POST to the container).
Until validated against a real cluster, it is unknown whether `VAST_SOURCE_PATH` and
`VAST_ASSET_ID` match what VAST DataEngine actually injects.

### Validation Plan

**Prerequisites:**
- [ ] VAST cluster access provisioned (SERGIO-180)
- [x] Track 1 Section A security fixes applied (credentials must be secure before
      pointing at a real VAST cluster) — ✅ completed 2026-03-12
- [x] VastWorkflowClient implemented (C1) — ✅ completed 2026-03-12

**Validation Steps:**

1. **Deploy the scanner-function to VAST DataEngine:**
   - [ ] Build the scanner-function Docker image:
         `docker build -t spaceharbor-scanner-function services/scanner-function/`
   - [ ] Register the container image in the VAST DataEngine function registry
   - [ ] Configure an ElementCreated trigger on a test S3 view:
         ```json
         {
           "trigger_type": "ElementCreated",
           "source_view": "s3://spaceharbor-test-bucket",
           "function": "spaceharbor-scanner-function"
         }
         ```
   - [ ] Upload a test `.exr` file to the S3 view
   - [ ] Verify the scanner-function handler `(ctx, event)` is called with a valid
         `event["Records"][0]["s3"]` payload
   - [ ] Verify the path_parser and hierarchy_resolver execute without errors
   - [ ] Verify the Trino write succeeds and an asset record appears in VastDB

2. **Deploy oiio-proxy-generator to VAST DataEngine:**
   - [ ] Build: `docker build -t spaceharbor-oiio-proxy services/dataengine-functions/oiio-proxy-generator/`
   - [ ] Register in VAST DataEngine
   - [ ] Determine what environment variables VAST DataEngine injects for container-mode
         functions (consult VAST documentation or test with a simple `env`-printing container)
   - [ ] If VAST injects different env var names than `VAST_SOURCE_PATH` / `VAST_ASSET_ID`:
     - [ ] Update `services/dataengine-functions/oiio-proxy-generator/src/function.py`
           to read the correct variable names
     - [ ] Apply the same fix to `mtlx-parser` and `otio-parser`
   - [ ] Re-run all 36 oiio-proxy-generator tests after any env var name changes
   - [ ] Trigger a test ingest and verify proxy is generated and written to the correct
         VAST Element Store path

3. **Deploy mtlx-parser to VAST DataEngine:**
   - [ ] Same process as oiio-proxy-generator
   - [ ] Verify a `.mtlx` file ingest triggers the function and writes metadata to VastDB
   - [ ] Verify the CloudEvent completion event is published in the correct format
         (after Track 1 Section B fix)

4. **Deploy otio-parser to VAST DataEngine:**
   - [ ] Same process as mtlx-parser
   - [ ] Verify a `.otio` file ingest triggers the function

5. **End-to-End Flow Validation:**
   - [ ] Upload a `.exr` file to the VAST S3 view
   - [ ] Verify: element trigger fires → scanner-function runs → asset record created in
         VastDB → oiio-proxy-generator triggers → proxy created → CloudEvent published →
         VastEventSubscriber consumes event → job status updated → asset appears in
         web-ui as `completed`
   - [ ] Verify total latency (file upload to web-ui `completed` status) is < 60 seconds
         for a single-frame EXR
   - [ ] Document actual latency in Phase 4 test results

**Acceptance Criteria:**

- [ ] All three container functions receive their element event payload correctly
- [ ] No env var mapping changes required (or all changes applied and tested)
- [ ] End-to-end ingest flow completes without errors on a real VAST cluster
- [ ] Latency documented for baseline performance benchmarking

---

## Additional Phase 4 Pre-Production Checks

These items are not VAST PE hard conditions but are required before production deployment:

### P1 — VAST Event Broker SASL Auth Validation

- [ ] Confirm Kafka client connects successfully using VAST local user credentials
      (not AD/LDAP — see C6)
- [ ] Verify consumer group creation succeeds
- [ ] Verify that publishing and consuming events works end-to-end with real Event Broker
- [ ] Test consumer reconnection after a broker restart

### P2 — CAS Operations Against Real Trino

Once VastWorkflowClient (C1) is implemented, validate CAS semantics on a real VAST cluster:

- [ ] Run the CAS load test (`test/cas-load.test.ts`) targeting VAST DataBase
- [ ] Verify concurrent job claims — only one worker wins
- [ ] Verify no double-processing occurs under concurrent load
- [ ] Verify the conditional UPDATE pattern (`WHERE id=? AND status=?`) is atomic in Trino

### P3 — Startup Validation Gate Verification

- [ ] Start control-plane with `SPACEHARBOR_PERSISTENCE_BACKEND=vast` and
      Trino intentionally unreachable → verify process refuses to start with clear error
- [ ] Start control-plane with `NODE_ENV=production` and
      `SPACEHARBOR_PERSISTENCE_BACKEND=local` → verify prominent warning is logged
- [ ] Start control-plane with all VAST endpoints correctly configured → verify
      startup completes without warnings

### P4 — VastPersistenceAdapter Fallback Behavior

- [ ] Simulate Trino failure mid-operation with `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=true`:
  - [ ] Verify fallback activates and operations continue using LocalPersistenceAdapter
  - [ ] Verify `VAST_FALLBACK` audit event is emitted for each fallback operation
  - [ ] Verify `GET /api/v1/audit` shows fallback signals with `signal.type=fallback`
  - [ ] Verify `GET /api/v1/metrics` shows fallback counters incrementing
- [ ] Simulate Trino failure with `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=false`:
  - [ ] Verify 500 error is returned with the unified error envelope
  - [ ] Verify no silent data loss

### P5 — Performance Baseline

- [ ] Run 10 concurrent asset ingests against VAST DataBase and measure:
  - P50 / P95 / P99 latency for asset creation
  - P50 / P95 / P99 latency for job claim
  - Trino nextUri round-trip count per query (verify backoff is effective)
- [ ] Establish baseline numbers and commit to `docs/performance-baseline.md`

---

## Pre-Production Deployment Checklist

Use this checklist before the first production deployment against a real VAST cluster.

**Track 1 (Backend) must be complete:**
- [x] C1 — VastWorkflowClient implemented ✅
- [x] C2 — CloudEvent format fixed ✅
- [x] C3 — Trino nextUri backoff ✅
- [x] C4 — Bounded processedEventIds ✅
- [x] C7 — kafkajs removed ✅
- [x] S1 — SQL injection fixed ✅
- [x] S2 — Dev mode default fixed ✅
- [x] S3 — Silent Kafka drops fixed ✅
- [x] S4 — Request timeouts added ✅

**Track 3 (Governance) must be complete:**
- [x] C6 — VAST EB local-user auth documented ✅
- [ ] CI green (including nightly smoke) ✅ / ⬜
- [ ] Security scanning enabled (CodeQL, Dependabot) ✅ / ⬜

**Phase 4 validation must be complete:**
- [ ] C5 — DataEngine container env var mapping validated ✅ / ⬜
- [ ] P1 — VAST Event Broker SASL auth validated ✅ / ⬜
- [ ] P2 — CAS under load validated ✅ / ⬜
- [ ] P3 — Startup validation gate verified ✅ / ⬜
- [ ] P4 — Fallback behavior verified ✅ / ⬜
- [ ] P5 — Performance baseline documented ✅ / ⬜

**Release gates:**
- [ ] CHANGELOG.md updated ✅ / ⬜
- [ ] v0.2.0+ tag pushed and GitHub Release created ✅ / ⬜
- [ ] Disaster recovery guide reviewed and approved ✅ / ⬜
- [ ] Runbook reviewed by on-call engineer ✅ / ⬜

---

*This document is the authoritative production readiness gate for SpaceHarbor.*
*Update status checkboxes as each condition is met.*
*Next review: when Phase 4 cluster access is provisioned.*
