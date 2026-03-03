# Design Updates from Specialist Feedback

**Date:** March 2, 2026
**Reviewers:** UI/UX Specialist (ui-ux-react-vite) + Media Pipeline Specialist (media-pipeline-specialist)
**Status:** All changes integrated into design and implementation plan

---

## Summary of Changes

This document tracks all changes made to the Phase 1+2+3 design and implementation plan based on specialist validation feedback.

---

## 1. Design Document Updates (`2026-03-02-assetharbor-phase1-2-3-design.md`)

### 1.1 Section 5.2 (exrinspector Function) — VFX Metadata Fields

**Change:** Added 7 missing VFX-critical metadata fields to `ExrInspectorFunction.outputSchema`.

**Added fields:**
- `frame_range: { first: number; last: number }` — First and last frame in sequence
- `frame_rate: number` — Frames per second (e.g., 24.0, 29.97)
- `pixel_aspect_ratio: number` — Pixel aspect ratio (typically 1.0)
- `display_window: { x_min, y_min, x_max, y_max }` — Display bounds for cropped images
- `data_window: { x_min, y_min, x_max, y_max }` — Data window bounds (separate from display_window)
- `compression_type: string` — Compression codec (PIZ, ZIP, ZIPS, DWAA)
- `file_size_bytes: number` — File size in bytes
- `checksum: string` — MD5 or xxHash for integrity verification

**Rationale:** VFX studios require these fields for shot conforming, pipeline orchestration, and asset validation. Exrinspector must extract all fields to prevent costly metadata gaps post-ingest.

**Files modified:**
- `§5.2 exrinspector Function (End-to-End Sample)` — outputSchema updated

---

### 1.2 Section 5.3 (Extended Asset Model) — VFX Metadata + Versioning + Integrity

**Change:** Expanded `Asset.metadata` interface to include:
1. **VFX-critical metadata** (from exrinspector):
   - `frame_range`, `frame_rate`, `pixel_aspect_ratio`, `display_window`, `data_window`, `compression_type`
2. **Versioning fields** (for project/shot/version organization):
   - `version_label: string` (e.g., 'v001', 'v002')
   - `parent_version_id: string` (reference to prior version)
3. **Integrity fields** (for quality assurance):
   - `file_size_bytes: number`
   - `checksum: string` (MD5 or xxHash)

**Rationale:** Asset model must support version tracking and integrity validation. Versioning enables studio workflows where shots are iteratively refined. Integrity fields prevent corrupt uploads from entering metadata database.

**Files modified:**
- `§5.3 Extended Asset Model` — Asset interface updated

---

### 1.3 Section 5.1 (Data Engine Pipeline) — Priority Order Clarification

**Change:** Added explicit priority order for Data Engine function implementation.

**Priority order (post-exrinspector):**
1. **Proxy generation** (Phase 4) — H.264/DNxHD transcoding + still frame extraction
2. **Checksum/integrity validation** (Phase 4) — Post-ingest validation
3. **media-search / similarity indexing** (Phase 4+) — Deferred, requires populated library

**Rationale:** Proxy generation is critical for review workflows; reviewers cannot approve/reject raw 4K EXR sequences without proxies. Checksum validation prevents corrupt uploads. media-search requires library maturity and is properly deferred.

**Files modified:**
- `§5.1 Modular Data Engine Pipeline Architecture` — Added priority order section

---

### 1.4 Section 3.3 (Worker Exception Handling) — Background Heartbeat Task

**Change:** Added comprehensive background heartbeat task implementation to prevent lease expiration during long-running jobs.

**New requirement:**
- Long EXR analysis (>30s) must emit heartbeats concurrently with processing
- Heartbeat every 15s (lease duration = 30s)
- Prevent another worker from reclaiming the job → duplicate processing

**Implementation added:**
```python
async def run_forever(self):
    """Main worker loop with concurrent heartbeat background task."""
    # ... exception handling loop ...
    job = await self.claim_next_job()
    if job:
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(job.id, job.lease_holder)
        )
        try:
            await self.process_job(job)
        finally:
            heartbeat_task.cancel()

async def _heartbeat_loop(self, job_id: str, lease_holder: str):
    """Emit heartbeat every 15s to keep lease alive."""
    while True:
        await asyncio.sleep(15)
        await self.control_plane.heartbeat(job_id, lease_holder)
```

**Rationale:** Without heartbeats, jobs exceeding 30s lease duration cause stale-lease eviction → duplicate processing under peak load. This is critical for VFX ingest where EXR sequences can require >30s analysis.

**Files modified:**
- `§3.3 Worker Exception Handling & Backoff` — Added background heartbeat task + test strategy
- Backoff cap increased: 60s → 300s (5 min) to support overnight renders

---

### 1.5 Section 3.7 (Phase 1 Success Criteria) — Concurrent Load Testing

**Change:** Added explicit concurrent load testing requirement.

**New criteria:**
- ✅ Concurrent load testing (ingest high-frequency assets, verify no duplicates)

**Rationale:** Specialist identified risk with Trino CAS semantics under high concurrency. LocalAdapter tests pass, but Trino (OLAP, not OLTP) may have different row-level locking behavior. Week 3 integration tests must validate.

**Files modified:**
- `§3.7 Phase 1 Success Criteria` — Added concurrent load test

---

### 1.6 New Section 5.3.1 (DLQ Automation & Retry Counter)

**Change:** Added comprehensive DLQ automation specification between §5.3 and §5.4.

**New requirement:**
- Failed jobs tracked with `attempt_count`
- Automatic promotion to DLQ after `max_attempts` (default 3)
- Prevents infinite requeue loops

**Job model fields added:**
- `attempt_count: number` (incremented on failure)
- `max_attempts: number` (default 3)
- `last_error: string` (error message from most recent attempt)

**Worker logic:**
```python
job.attempt_count += 1
if job.attempt_count >= job.max_attempts:
    await persistence.moveJobToDlq(job.id, reason=f"Max attempts exceeded")
else:
    await persistence.updateJobStatus(job.id, 'claimed', 'pending')  # Requeue
```

**Rationale:** Failed jobs without max-attempt enforcement cause indefinite requeuing, consuming resources and preventing manual intervention. DLQ with retry counter enables observability and manual remediation.

**Files modified:**
- New `§5.3.1 DLQ Automation & Retry Counter`

---

## 2. Implementation Plan Updates (`2026-03-02-assetharbor-implementation.md`)

### 2.1 Task 10 (Kafka Event Broker) — Producer Pooling Emphasis

**Change:** Added critical note emphasizing producer pooling requirement.

**Note added:**
```
CRITICAL NOTE (Specialist Feedback): Kafka producer pooling is essential for
performance under high ingest throughput. This implementation plan correctly
pools producer (single instance, reused across publish calls). Ensure
`connect()` / `disconnect()` manage lifecycle; `publish()` reuses connected producer.
```

**Rationale:** Design doc example creates new producer per publish (bottleneck). Implementation plan correctly pools. Emphasis prevents reference errors.

**Files modified:**
- `Task 10: Implement Kafka Event Broker Client` — Added producer pooling note

---

### 2.2 Task 12 (exrinspector) — Clarified VFX Metadata Outputs

**Change:** Clarified Task 12 requirements to explicitly list all 8 VFX metadata fields.

**Clarification added:**
```
Task 12 must output ALL VFX metadata fields:
- frame_range: { first, last }
- frame_rate: number
- pixel_aspect_ratio: number
- display_window: { x_min, y_min, x_max, y_max }
- data_window: { x_min, y_min, x_max, y_max }
- compression_type: string
- file_size_bytes: number
- checksum: string
```

**Rationale:** Implementation clarity prevents incomplete metadata extraction.

**Files modified:**
- `Task 12: Implement exrinspector Function (End-to-End Sample)` — Added clarification

---

### 2.3 Task 13 (Extended Asset Model) — Clarified VFX Fields + Versioning + Integrity

**Change:** Clarified Task 13 requirements to include all VFX fields + versioning + integrity.

**Clarification added:**
```typescript
metadata: {
  // Technical (from exrinspector)
  codec, resolution, duration_ms, channels, color_space, bit_depth, frame_count,

  // VFX-CRITICAL (from exrinspector)
  frame_range, frame_rate, pixel_aspect_ratio,
  display_window, data_window, compression_type,

  // Versioning
  version_label: string;
  parent_version_id: string;

  // Integrity
  file_size_bytes: number;
  checksum: string;

  // Custom
  tags, labels, custom_fields
}
```

**Rationale:** Implementation clarity ensures all specialist-required fields are persisted and queryable.

**Files modified:**
- `Task 13: Extend Asset Model with Metadata` — Added clarification

---

### 2.4 Task 13.1 (NEW): Implement Background Heartbeat Task in Worker

**Change:** Added new task to implement background heartbeat concurrent with job processing.

**Task details:**
- Add `_heartbeat_loop()` async task
- Start heartbeat concurrently with `process_job()`
- Heartbeat every 15s (lease duration = 30s)
- Cancel heartbeat when job completes
- Reference: Design doc §3.3

**Rationale:** Long-running jobs (EXR analysis >30s) must prevent lease expiration → duplicate processing.

**Files modified:**
- `Task 13.1 (NEW): Implement Background Heartbeat Task in Worker`

---

### 2.5 Task 13.2 (NEW): Implement DLQ Automation + Retry Counter

**Change:** Added new task to implement DLQ automation and retry counter.

**Task details:**
- Add `attempt_count`, `max_attempts`, `last_error` to Job model
- Worker increments attempt_count on failure
- Automatic DLQ promotion when attempt_count >= max_attempts
- Requeue for retry if below max
- Reference: Design doc §5.3.1

**Rationale:** Failed jobs must automatically promote to DLQ after max attempts (prevents infinite requeue).

**Files modified:**
- `Task 13.2 (NEW): Implement DLQ Automation + Retry Counter`

---

## 3. Specialist Feedback Integration Summary

### UI/UX Specialist (Approved)

**Status:** ✅ No changes required
**Verdict:** Component architecture is MVP-appropriate. AssetQueue + ApprovalPanel + IngestModal prioritized correctly.

**Note:** Current implementation plan already aligns with specialist recommendations:
- AppShell with sidebar/topbar/main layout
- StatusBadge component mapping AssetStatus enum to colors
- ApprovalPanel slide-in design
- Approval endpoints already designed (§5.4)

---

### Media Pipeline Specialist (Approved with Critical Enhancements)

**Status:** ✅ All recommendations integrated

**Summary of specialist feedback addressed:**
1. ✅ Added 7 missing VFX metadata fields to exrinspector (§5.2)
2. ✅ Added versioning + integrity fields to Asset model (§5.3)
3. ✅ Clarified Data Engine priority order (§5.1)
4. ✅ Implemented background heartbeat task (§3.3, Task 13.1)
5. ✅ Implemented DLQ automation + retry counter (§5.3.1, Task 13.2)
6. ✅ Emphasized Kafka producer pooling (Task 10)
7. ✅ Increased backoff cap: 60s → 300s for long renders (§3.3)
8. ✅ Added concurrent load testing requirement (§3.7)

---

## 4. Task Count Changes

**Original Plan:** 15 core tasks (Tasks 1-15)

**Updated Plan:** 17 total tasks
- Tasks 1-10: Unchanged (Team A Phase 1 + Team B Phase 2)
- Task 11: Unchanged (Team C Data Engine pipeline architecture)
- Task 12: Clarified (exrinspector with all VFX metadata)
- Task 13: Clarified (extended asset model with VFX + versioning + integrity)
- **Task 13.1 (NEW):** Background heartbeat task in worker
- **Task 13.2 (NEW):** DLQ automation + retry counter
- Task 14: Unchanged (approval workflow)
- Task 15: Unchanged (DCC integration)

**Impact:** +2 new tasks fit within Phase 3 scope (Weeks 2-4). Both are critical for reliability.

---

## 5. Files Modified

### Design Document
- `/Users/sergio.soto/Development/ai-apps/code/AssetHarbor/docs/plans/2026-03-02-assetharbor-phase1-2-3-design.md`
  - §3.3 (Worker) — Added background heartbeat task
  - §3.7 (Phase 1 Success) — Added concurrent load testing
  - §5.1 (Data Engine) — Added priority order
  - §5.2 (exrinspector) — Added 7 VFX metadata fields
  - §5.3 (Asset Model) — Added VFX, versioning, integrity fields
  - §5.3.1 (NEW) (DLQ Automation) — New section with retry counter

### Implementation Plan
- `/Users/sergio.soto/Development/ai-apps/code/AssetHarbor/docs/plans/2026-03-02-assetharbor-implementation.md`
  - Task 10 — Added producer pooling note
  - Task 12 — Clarified VFX metadata outputs
  - Task 13 — Clarified VFX fields + versioning + integrity
  - Task 13.1 (NEW) — Background heartbeat task
  - Task 13.2 (NEW) — DLQ automation + retry counter

### Summary (This Document)
- `/Users/sergio.soto/Development/ai-apps/code/AssetHarbor/docs/DESIGN_UPDATES_FROM_SPECIALIST_FEEDBACK.md` (NEW)

---

## 6. Next Steps

1. **Review & Approval:** User confirms design updates align with vision
2. **Execution:** Proceed with Phase 1+2+3 implementation using updated design + plan
3. **Checkpoints:** Weekly integration checkpoints (Fri Mar 7, Mar 14, Mar 21, Mar 28)
4. **Testing:** Specialist-recommended tests integrated into checkpoint validations

---

## Sign-Off

✅ **All specialist feedback integrated**
✅ **Design and implementation plan updated**
✅ **Production-ready for execution**

**Changes are ready for implementation starting Week 1 (March 1-7, 2026).**
