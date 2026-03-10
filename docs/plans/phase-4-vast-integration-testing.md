# Phase 4: VAST Integration Testing & Production Hardening

**Duration:** 2-3 weeks (June 13-30, 2026)
**Goal:** Validate everything against a real VAST Data cluster. Fix compatibility issues, run performance tests, and prepare for production deployment.
**Depends on:** Phases 1-3 complete

---

## Prerequisites

- Access to a VAST Data cluster (contact VAST account team or use VAST Cloud GCP)
- Cluster must have: VAST Database (Trino), Event Broker (Kafka), DataEngine runtime
- S3-compatible endpoint for object storage
- Network access from dev machines to cluster

---

## Task Breakdown

### Task 4.1: Cluster Provisioning & Schema Install (~100 lines)

**Agent:** vast-platform-engineer + devops-engineer
**Commit checkpoint:** After config changes only

**Prompt:**
```
Using a real VAST Data cluster, perform the first-ever production schema installation.

1. Gather cluster connection details:
   - Trino endpoint URL (usually https://<vip>:8443)
   - S3 access key and secret key for a service account
   - Event Broker bootstrap servers
   - DataEngine API endpoint

2. Run the CLI installer from Phase 1:
   npx tsx src/db/installer.ts \
     --trino-endpoint <url> \
     --access-key <key> --secret-key <key> \
     --dry-run  # first pass: review SQL

   Then without --dry-run to apply.

3. Validate:
   - Connect to Trino and run: SHOW TABLES IN vast."assetharbor/production"
   - Verify all 18 tables exist
   - Verify schema_version shows version 5
   - Run a test INSERT + SELECT on each table to verify data types
   - Verify sort keys are set: SHOW CREATE TABLE for shots, versions, materials

4. Document any issues:
   - SQL syntax differences from OSS Trino
   - Auth issues
   - Schema naming edge cases
   - Sort key behavior

5. Update .env.production.example with real cluster config template.

Create: services/control-plane/.env.production.example with all required vars.
```

**Validation:** All 18 tables created. INSERT/SELECT works on each. Sort keys confirmed.

---

### Task 4.2: Event Broker Validation (~150 lines)

**Agent:** vast-platform-engineer
**Commit checkpoint:** After this task

**Prompt:**
```
Test the Confluent Kafka client against the real VAST Event Broker.

1. Configure connection:
   VAST_EVENT_BROKER_URL=<broker_bootstrap_servers>
   VAST_EVENT_BROKER_TOPIC=assetharbor.events
   VAST_EVENT_BROKER_GROUP=assetharbor-control-plane

2. Test consumer connection:
   - Start VastEventSubscriber with real broker URL
   - Verify it connects and subscribes to the topic
   - Check for any TLS/auth issues

3. Test message production:
   - Publish a test CloudEvent to the topic (use kafkacat or the Confluent CLI)
   - Verify VastEventSubscriber receives and processes it
   - Check event deserialization (CloudEvent JSON format)

4. Test VAST Event Broker limitations:
   - Verify no cooperative rebalancing issues (VAST doesn't support it)
   - Test with multiple consumer instances in same group
   - Verify message size limit (~1MB)
   - Check consumer group count (VAST limits to 256 per view)

5. Document findings:
   - Any client configuration changes needed
   - Kafka protocol version compatibility
   - Consumer group behavior differences from standard Kafka

Update services/control-plane/src/events/vast-event-subscriber.ts if any
configuration changes are needed (e.g., specific protocol versions, TLS settings).

Write integration test: services/control-plane/test/integration/event-broker.test.ts
- Skip unless VAST_EVENT_BROKER_URL is set
- Produce a message → verify consumed within 5 seconds
```

**Validation:** Messages flow through VAST Event Broker to control-plane consumer.

---

### Task 4.3: DataEngine Function Deployment (~200 lines)

**Agent:** vast-platform-engineer + devops-engineer
**Commit checkpoint:** After this task

**Prompt:**
```
Deploy the DataEngine functions to the real VAST cluster and test element trigger wiring.

1. Build and push container images for each function:
   - services/dataengine-functions/oiio-proxy-generator/ → assetharbor/oiio-proxy:latest
   - services/dataengine-functions/mtlx-parser/ → assetharbor/mtlx-parser:latest
   - services/dataengine-functions/otio-parser/ → assetharbor/otio-parser:latest
   - services/scanner-function/ → assetharbor/scanner:latest

2. Register functions with VAST DataEngine:
   - ScannerFunction: ElementCreated trigger on /projects/** prefix
     - Suffix filter: .exr, .mov, .dpx
   - OiioProxyGenerator: triggered by ScannerFunction completion (or chained trigger)
   - MtlxParser: ElementCreated trigger on /materials/** prefix, suffix .mtlx
   - OtioParser: ElementCreated trigger on /timelines/** prefix, suffix .otio,.edl,.xml

3. Test end-to-end pipeline:
   a. Upload a test EXR file to VAST S3: /projects/test-project/shots/sh010/v001/render.0001.exr
   b. Verify ScannerFunction fires → creates asset in control-plane
   c. Verify EXR inspector extracts real metadata
   d. Verify OIIO proxy generates thumbnail + H.264
   e. Verify completion event published to Event Broker
   f. Verify control-plane receives event and updates asset metadata
   g. Verify UI shows the asset with thumbnail

4. Test MaterialX pipeline:
   a. Upload test.mtlx to VAST S3: /materials/test-project/hero_shader.mtlx
   b. Verify MtlxParser fires → extracts looks and textures
   c. Verify material created in control-plane

5. Test OTIO pipeline:
   a. Upload test.otio to VAST S3: /timelines/test-project/final_cut.otio
   b. Verify OtioParser fires → creates timeline with clips

Document: deployment steps, trigger configuration, any issues encountered.
Create: services/dataengine-functions/deploy.sh — deployment script for all functions.
```

**Validation:** Full pipeline works: file upload → trigger → function → event → control-plane → UI.

---

### Task 4.4: Persistence End-to-End (~200 lines)

**Agent:** db-sql-specialist + general-purpose
**Commit checkpoint:** After this task

**Prompt:**
```
Test VastPersistenceAdapter against the real VAST Database (Trino).

1. Set environment:
   ASSETHARBOR_PERSISTENCE_BACKEND=vast
   VAST_DATABASE_URL=https://<trino>:8443
   VAST_ACCESS_KEY=<key>
   VAST_SECRET_KEY=<key>

2. Run the full test suite with VAST backend:
   - Create project → verify in Trino: SELECT * FROM projects WHERE id = ?
   - Create sequence → verify FK check works (project exists)
   - Create shot → verify sort key behavior
   - Create version → verify companion table JOINs (review_status, frame_handles)
   - Create material → verify full MaterialX lifecycle
   - Test approval workflow end-to-end

3. Specific VAST validations:
   - Sort key constraint: attempt UPDATE on sorted column → expect rejection
     (shots.project_id is sorted — cannot be updated)
   - NULL handling: verify nullable columns store/retrieve NULL correctly
   - Timestamp precision: verify TIMESTAMP(6) works as expected
   - VARCHAR limits: test long strings near VARCHAR(1024) limit
   - ROW types: verify display_window and data_window ROW types serialize correctly

4. Performance baseline:
   - INSERT 1000 shots → measure time
   - SELECT with filter on sorted column → measure time
   - SELECT with filter on non-sorted column → measure time
   - JOIN across companion tables → measure time
   - Document: query latencies at various data sizes

5. Fix any issues found:
   - SQL syntax adjustments for VAST Trino dialect
   - Type mapping corrections
   - Null handling fixes
   - Performance optimizations (add sort key hints in WHERE clauses)

Write: services/control-plane/test/integration/vast-persistence.test.ts
- Full CRUD lifecycle test against real Trino
- Skip unless VAST_DATABASE_URL is set
```

**Validation:** All CRUD operations work against real VAST. Performance baseline documented.

---

### Task 4.5: Security & Auth Hardening (~200 lines)

**Agent:** devsecops-auditor + general-purpose
**Commit checkpoint:** After this task

**Prompt:**
```
Harden security for production deployment on VAST:

1. Authentication:
   - Verify API key enforcement on all /api/v1 write endpoints
   - Ensure Trino connections use encrypted credentials (not plaintext in env)
   - Verify Kafka connections work with TLS (VAST Event Broker may require it)
   - Ensure no credentials in logs (scrub VAST_ACCESS_KEY, VAST_SECRET_KEY from debug output)

2. Input validation:
   - Audit all route handlers for SQL injection risk in Trino queries
     (verify parameterized queries are used, not string interpolation)
   - Check for path traversal in file URI handling
   - Validate CloudEvent payloads before processing
   - Check for SSRF in DataEngine function URLs

3. Network security:
   - Verify docker-compose.yml doesn't expose internal ports unnecessarily
   - Ensure control-plane ↔ Trino communication is TLS
   - Ensure control-plane ↔ Kafka communication is TLS

4. Dependency audit:
   - npm audit on control-plane
   - pip audit on DataEngine functions
   - Check for known vulnerabilities in @confluentinc/kafka-javascript

5. Create: services/control-plane/SECURITY.md
   - Document auth model
   - Document credential management
   - Document network requirements
   - Document known limitations

Fix any vulnerabilities found. Document remaining risks.
```

**Validation:** No SQL injection. Credentials not in logs. TLS verified. npm/pip audit clean.

---

### Task 4.6: E2E Demo Pipeline (~150 lines)

**Agent:** general-purpose
**Commit checkpoint:** After this task (final Phase 4 commit)

**Prompt:**
```
Create a comprehensive end-to-end demo script that exercises the full AssetHarbor pipeline.

File: services/control-plane/scripts/e2e-demo.sh

The script should:
1. Check prerequisites (VAST cluster reachable, schema installed, functions deployed)
2. Create a test project via API
3. Create a sequence + 3 shots via API
4. Upload 3 EXR files to VAST S3 (one per shot)
5. Wait for ScannerFunction → EXR Inspector → Proxy Generation pipeline
6. Verify: assets created, metadata populated, thumbnails generated
7. Upload a .mtlx file → verify material created with looks + textures
8. Upload a .otio timeline → verify clips created and conformed to shots
9. Submit assets for review → approve them via API
10. Verify final state: all assets approved, all metadata populated
11. Print summary: pass/fail for each step with timing

File: services/control-plane/scripts/e2e-demo-cleanup.sh
- Delete test data (project, sequences, shots, versions, materials, timelines)
- Designed to be run after the demo

Make the scripts idempotent — safe to re-run.
Add to package.json: "demo:e2e": "bash scripts/e2e-demo.sh"
```

**Validation:** `npm run demo:e2e` runs the full pipeline and reports pass/fail for each step.

---

## Commit Strategy

| Commit | Task | Est. Lines | Message |
|--------|------|-----------|---------|
| 1 | 4.1 | ~100 | `feat(P4): production env config + schema installation docs` |
| 2 | 4.2 | ~150 | `test(P4): Event Broker integration validation` |
| 3 | 4.3 | ~200 | `feat(P4): DataEngine function deployment scripts + trigger config` |
| 4 | 4.4 | ~200 | `test(P4): VastPersistenceAdapter integration tests against real Trino` |
| 5 | 4.5 | ~200 | `sec(P4): security hardening and audit` |
| 6 | 4.6 | ~150 | `test(P4): end-to-end demo pipeline script` |

---

## Validation Checklist

- [ ] Schema installer runs successfully against real VAST cluster
- [ ] All 18 tables created with correct types and sort keys
- [ ] Kafka consumer connects to real VAST Event Broker
- [ ] DataEngine functions deploy and trigger on file upload
- [ ] Full pipeline: file → trigger → process → event → control-plane → UI
- [ ] All CRUD operations work against real Trino
- [ ] Performance baseline documented
- [ ] Security audit clean (no injection, no credential leaks, TLS verified)
- [ ] E2E demo script passes all steps
- [ ] Each commit under 1200 lines

---

## Definition of Done (Entire Project)

When Phase 4 is complete, AssetHarbor is a **production-ready MAM on VAST Data** with:
- Durable persistence via VAST Database (Trino)
- Real-time event pipeline via VAST Event Broker (Kafka)
- Automated media processing via VAST DataEngine (serverless functions)
- Full ASWF tool chain (OIIO, OCIO, OpenEXR, MaterialX, OTIO, OpenAssetIO, OpenRV)
- Professional dark-themed UI with media galleries, hierarchy navigation, timeline visualization
- Review and approval workflows with video playback
- Real-time SSE updates
- Security hardened for production deployment
