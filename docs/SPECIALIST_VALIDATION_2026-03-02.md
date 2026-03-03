# AssetHarbor Specialist Validation Report

**Date:** March 2, 2026
**Reviewers:** UI/UX Specialist (ui-ux-react-vite) + Media Pipeline Specialist (media-pipeline-specialist)
**Design Reviewed:** Phase 1+2+3 Design + Implementation Plan
**Status:** ✅ Design Approved with Recommendations

---

## 1. UI/UX Specialist Validation (Approved)

### Component Architecture Recommendation

**Proposed structure (component hierarchy):**
```
src/
  components/
    layout/
      AppShell.tsx          # grid: sidebar | topbar | main [| panel]
      Sidebar.tsx           # nav items, cluster status card
      Topbar.tsx            # breadcrumb, search, upload CTA, avatar
    assets/
      AssetQueue.tsx        # table/grid with status badges + filter chips
      AssetCard.tsx         # grid-view tile (thumbnail, codec badge, status)
      StatusBadge.tsx       # pure display, maps AssetStatus enum to color
    approval/
      ApprovalPanel.tsx     # slide-in: thumbnail, metadata, comments, approve/reject
    ingest/
      IngestModal.tsx       # upload form in a modal (not inline)
    audit/
      AuditFeed.tsx         # timestamped event list
    shared/
      StatsBar.tsx          # 4 counters (total, pending, processing, ready)
  hooks/
    useAssets.ts            # fetch + polling
    useApproval.ts          # approve/reject mutations
  api.ts                    # (extend with new endpoints)
```

**Pattern:** `AppShell` owns `isPanelOpen` + `selectedAsset` state; no Redux/Zustand needed at MVP scale.

### Priority UI Elements (Stop When Time Runs Out)

**In priority order:**

1. **AssetQueue + StatusBadge** (CRITICAL)
   - Core data surface; without this the app is unusable
   - Filter chips for `qc_pending` / `qc_in_review` / `ready` statuses
   - Depends on Task 6 (status enum reconciliation)

2. **ApprovalPanel (slide-in)** (CRITICAL)
   - Maps to Tier 1 approval endpoints (`POST /approve`, `POST /reject`)
   - Requires: thumbnail, metadata grid (resolution, codec, color_space), comments, action buttons
   - Functional > visual polish for MVP

3. **IngestModal** (CRITICAL)
   - Replace inline form with modal (triggered by topbar "Upload" CTA)
   - Fields: `name`, `project_id`, `sourceUri`, optional `shot_id`
   - Keeps queue view uncluttered

4. **AuditFeed** (HIGH)
   - Consume `GET /api/v1/audit`, render timestamped list
   - Low effort, high diagnostic value

5. **AppShell Layout** (HIGH)
   - Migrate to sidebar/topbar/main grid from v3 mockup
   - Extract CSS custom properties (`--void`, `--deep`, `--c4`, etc.) directly into `theme.css`

### Design System Requirements (from v3 Mockup)

**Typography:**
- `Syne` (display/headings, `--fd`)
- `DM Sans` (body, `--fb`)
- `DM Mono` (labels/badges, `--fm`)

**Color Palette (ready to use from v3):**
- Navy depth: `--void: #020b18` → `--elev: #0d2d4d`
- Cyan accent: `--c3` → `--c6`
- Semantic: `--ok: #10b981`, `--warn: #f59e0b`, `--err: #ef4444`

**Spacing (wire as CSS vars, not magic numbers):**
- Sidebar: `232px`
- Topbar: `52px`
- Detail panel: `320px`

**Status color mapping:**
- `qc_pending` → `--warn`
- `qc_in_review` → `--pur`
- `qc_approved` / `ready` → `--ok`
- `qc_rejected` → `--err`

**Action:** Create `services/web-ui/src/styles/tokens.css` with all design tokens; import in `main.tsx`.

### Deferrable Polish (Tier 2/3, NOT MVP)

- Grid/card view toggle
- Animated glowing status dots + pulsing indicators
- Global search with full-text filtering
- Metrics dashboard / stats bar with live counters
- Responsive/mobile layout (VFX studios use workstations)

### Required API Additions

Current `api.ts` needs:

```typescript
export const approveAsset = (id: string, comments: string) =>
  fetch(`/api/v1/assets/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comments }),
    headers: { 'Content-Type': 'application/json' }
  });

export const rejectAsset = (id: string, comments: string) =>
  fetch(`/api/v1/assets/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comments }),
    headers: { 'Content-Type': 'application/json' }
  });

export const fetchPendingReview = () =>
  fetch('/api/v1/assets/pending-review').then(r => r.json());

export const fetchAudit = (assetId?: string) =>
  fetch(assetId ? `/api/v1/audit?asset_id=${assetId}` : '/api/v1/audit')
    .then(r => r.json());
```

**Critical gap:** Current `AssetRow` type does not include `approval` sub-object or extended `metadata` fields from new domain model (§5.3). Update before wiring `ApprovalPanel`.

### Verdict

✅ **Design approved.** Component architecture is MVP-appropriate. Start with AssetQueue + ApprovalPanel + IngestModal. AppShell layout migration is low-risk and can happen Day 1-2.

---

## 2. Media Pipeline Specialist Validation (Approved with Critical Gaps)

### exrinspector as MVP Sample

✅ **Appropriate choice.** EXR metadata extraction is correct entry point:
- High-frequency (every ingest)
- Read-only, non-destructive
- Produces structured output enriching asset record
- Mock/real bifurcation via `VAST_DATA_ENGINE_URL` is right pattern

⚠️ **Critical gap:** `outputSchema` missing sequence-level fields mandatory for VFX:
- `frame_range: { first: number; last: number }`
- `frame_rate: number`
- `pixel_aspect_ratio: number`
- `display_window: { x_min, y_min, x_max, y_max }`
- `data_window: { x_min, y_min, x_max, y_max }` (separate from display_window)
- `file_size_bytes: number`
- `md5_checksum` or `xxHash: string`

**Action:** Add these to `ExrInspectorFunction.outputSchema` before Phase 3 implementation (Task 12).

### Priority Order for Data Engine Functions

**Correct order after exrinspector:**

1. **Proxy generation** (transcode to H.264/DNxHD + still frame extraction)
   - CRITICAL for review workflow
   - Reviewers cannot approve/reject raw 4K EXR without proxy
   - Closes gap: approval workflow currently uses mock thumbnail URLs

2. **Checksum/integrity validation**
   - Run post-ingest, before exrinspector
   - Prevents corrupt uploads from metadata database

3. **media-search / similarity indexing** (DEFER to Phase 4+)
   - Requires populated asset library
   - Embedding latency inappropriate for sync ingest path

### Essential VFX Metadata Fields Missing from Asset Model

Add to `Asset.metadata` interface (§5.3):

```typescript
metadata: {
  // Existing fields (codec, resolution, duration, channels, color_space, bit_depth)

  // NEW VFX-CRITICAL FIELDS:
  frame_range?: { first: number; last: number };
  frame_rate?: number;
  pixel_aspect_ratio?: number;
  display_window?: { x_min: number; y_min: number; x_max: number; y_max: number };
  data_window?: { x_min: number; y_min: number; x_max: number; y_max: number };
  compression_type?: string;  // e.g., PIZ, ZIP, ZIPS, DWAA

  // VERSIONING (required for "organize by project/shot/version" workflow):
  version_label?: string;
  parent_version_id?: string;

  // INTEGRITY:
  file_size_bytes?: number;
  md5_checksum?: string;  // or xxHash
};
```

**Action:** Update `models.ts` Asset interface before Phase 3 (Task 13).

### Worker Reliability & Performance

#### 1. Background Heartbeat Task (CRITICAL)

Current: `run_forever()` claims a job and processes it sequentially.
Risk: Long EXR analysis (>30s) expires lease; another worker reclaims job → duplicate processing.

**Fix:** Background `asyncio.Task` emitting heartbeats concurrently with `process_job()`.

```python
async def run_forever(self):
    while True:
        job = await self.claim_next_job()
        if job:
            # Start background heartbeat task
            heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(job.id, job.lease_holder)
            )
            try:
                await self.process_job(job)
            finally:
                heartbeat_task.cancel()

async def _heartbeat_loop(self, job_id: str, lease_holder: str):
    while True:
        await asyncio.sleep(15)  # heartbeat every 15s, lease = 30s
        await self.control_plane.heartbeat(job_id, lease_holder)
```

**Action:** Add to worker implementation (Phase 1 Task 3 or Phase 3 Task 12).

#### 2. Kafka Producer Pooling (PERFORMANCE)

Current design (§4.3): Creates new `Producer` instance on every `publish()`.
Risk: Bottleneck + excessive broker connections under high ingest throughput.

**Fix:** Hold single producer instance, reuse across calls.

```typescript
export class KafkaEventBroker implements EventBroker {
  private kafka: Kafka;
  private producer: Producer;

  async connect(): Promise<void> {
    await this.producer.connect();  // Once at startup
  }

  async publish(event: WorkflowEvent): Promise<void> {
    await this.producer.send({
      topic: 'workflow-events',
      messages: [{ ... }],
    });
    // producer stays connected
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();  // Once at shutdown
  }
}
```

**Note:** Implementation plan (Task 10) correctly implements pooling; ensure design doc example does not become reference.

#### 3. Backoff Tuning (OPERATIONAL)

Current: `60s` cap too low for overnight renders.
Recommend: `300s` (5 min) steady-state cap, faster backoff for transient network errors.

```python
backoff_ms = 1000
max_backoff_ms = 300000  # 5 minutes (not 60s)

# Distinguish transient (network) from persistent (processing) failures
if isinstance(e, (ConnectionError, TimeoutError)):
    # Transient: slower exponential backoff
    backoff_ms = min(backoff_ms * 1.5, max_backoff_ms)
else:
    # Persistent: faster backoff to surface error
    backoff_ms = min(backoff_ms * 2.0, 30000)  # cap at 30s
```

### Job Queue & CAS Semantics

#### 1. VastDbAdapter Race Condition Risk

LocalAdapter CAS (per-job mutex) is sound.
Risk: Trino is OLAP, not OLTP. Row-level locking semantics differ from traditional databases.

**Validation required:** Explicit concurrent load test in Week 3 VAST integration tests. Do not assume LocalAdapter test passing validates Trino behavior.

```typescript
describe('VastDbAdapter (concurrent stress)', () => {
  test('updateJobStatus CAS under 10 concurrent workers', async () => {
    // 10 workers simultaneously try to claim same job
    // Verify exactly 1 succeeds (rowsModified == 1)
    // Verify 9 fail (rowsModified == 0)
  });
});
```

**Action:** Add to Phase 2 integration tests (Task 10 + Week 3 checkpoint).

#### 2. Missing DLQ Automation (OPERATIONAL)

Current: `moveJobToDlq` defined at interface level.
Gap: Worker has no path calling it. Failed jobs stay in `claimed`/`failed`, reaped by `reapStaleLeasees`, but never promoted to DLQ.

**Fix:** Add `attempt_count` to Job model, automatic DLQ promotion:

```typescript
interface Job {
  id: string;
  status: JobStatus;
  attempt_count: number;  // NEW
  max_attempts: number;    // NEW, default 3
  // ...
}

// In worker exception handler
if (error && job.attempt_count >= job.max_attempts) {
  await persistence.moveJobToDlq(job.id, error.message);
}
```

**Action:** Add to Job model (Task 13) + worker implementation (Task 12).

### Verdict

✅ **Design approved.** exrinspector sample is correct. Critical gaps require fixes before MVP:
1. Add VFX metadata fields to exrinspector outputSchema + Asset model
2. Add background heartbeat task to worker
3. Add DLQ automation + retry counter to Job model
4. Validate Trino CAS semantics under concurrent load (Week 3)

---

## 3. Approved Scope Changes

Based on specialist feedback, approve these changes before Phase 1+2+3 execution:

### Design Document Updates (Minor)

- §5.2 (exrinspector): Add VFX metadata fields to outputSchema
- §5.3 (Asset model): Add versioning + integrity fields to metadata

### Implementation Plan Updates (Task Revisions)

- **Task 13:** Extended asset model → include VFX metadata fields + versioning
- **Task 12:** exrinspector → include all VFX metadata outputs
- **Task 3 (Worker):** Add background heartbeat task implementation
- **Task 10 (Kafka):** Clarify producer pooling (already correct in plan, just needs emphasis)
- **Add new task:** DLQ automation + retry counter (fit between Task 12-13)

### Linear Tasks Additions

- Add dedicated "VFX metadata support" task to ensure fields are persisted + queryable
- Add "Worker heartbeat background task" task
- Add "Concurrent load test for VastDbAdapter CAS" task (Week 3 checkpoint)

---

## 4. Unblocking Decisions

**All approvals ready. No design blockers.**

Proceed with:
1. Update design doc + implementation plan (minor additions above)
2. Create Linear tasks (15 core + 3 new from feedback)
3. Execute subagent-driven or parallel-session implementation

**Recommended:** Subagent-driven for early-stage agility + specialist feedback integration.

---

## Sign-Off

- ✅ **UI/UX Specialist (ui-ux-react-vite):** Approved
- ✅ **Media Pipeline Specialist (media-pipeline-specialist):** Approved with recommended enhancements
- ✅ **Design is production-ready** with feedback integrated
