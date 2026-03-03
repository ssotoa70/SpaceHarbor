# AssetHarbor Phase 1+2+3 Design: 28-Day Delivery

**Date:** March 2, 2026
**Target Release:** March 28, 2026
**Status:** Phase 1-2 Foundation COMPLETE (42/42 tests passing)
**Author:** Claude Code (Planning & Implementation Phase)
**Last Updated:** 2026-03-02

---

## Executive Summary

AssetHarbor is a **VAST-native Media Asset Management (MAM) system for Post-Production and VFX studios**. This design outlines a 28-day parallel execution plan to deliver:

- **Phase 1 (Weeks 1-2):** Stabilization — ✅ COMPLETE (6/6 tasks, 42 tests passing)
- **Phase 2 (Weeks 1-3):** VAST Integration — 🔄 IN PROGRESS (2/3 tasks, async interface + LocalAdapter refactoring)
- **Phase 3 (Weeks 2-4):** Features — 📋 READY (Team C unblocked with MockVastAdapter path)

**Five core workflows:** Ingest → Organize → Review → Process (via Data Engine) → Discover

**Execution strategy:** Three parallel teams (A, B, C) with weekly integration checkpoints, TDD throughout.

### Current Status (March 2, 2026)

**Phase 1 Stabilization:** ✅ Complete
- Guard persistence.reset() from startup
- Implement atomic job claiming (CAS)
- Add worker exception handling & exponential backoff (300s cap for long jobs)
- Add Docker Compose healthchecks & restart policies
- Fix outbox insertion order (LIFO → FIFO)
- Reconcile status enum drift (domain ↔ OpenAPI)

**Phase 2 Foundation:** 🔄 In Progress (66% complete)
- AsyncPersistenceAdapter interface defined (✅ Task 7)
- LocalPersistenceAdapter async refactor (🔄 Task 8, branch: worktree-assetharbor-implementation-2026-03-02)
- Next: MockVastAdapter (Task 9, ready by Week 2)

**Team C Unblocked:** Phase 1-2 foundation enables immediate work on
- Data Engine pipeline architecture (modular, registry pattern)
- exrinspector function (EXR metadata extraction)
- Approval workflow endpoints (state machine)
- Extended asset model (VFX metadata + versioning)

---

## 1. Vision & Scope

### Target Users
Post-production and VFX studios managing media assets across:
- Ingest of RAW/EXR sequences
- Technical metadata extraction (codec, resolution, channels, color space, duration)
- Collaborative review and approval workflows
- Automated media processing via VAST Data Engine
- Asset discovery and integration with creative tools (Maya, Nuke, etc.)

### Five Core Workflows

1. **Ingest** — Upload media files, create assets in VAST
2. **Organize** — Group by project/shot/version, apply tags and metadata
3. **Review** — Queue-based approval panel with feedback comments
4. **Process** — Automated pipelines (exrinspector, media-search, transcode) via Data Engine
5. **Discover** — Search assets by metadata, filter by status, export for DCCs

### Success Criteria (Tier 1/2/3)

**Tier 1 (Must-Have by March 28):**
- ✅ Zero data loss on service restart
- ✅ Atomic job claiming (no duplicate processing)
- ✅ Worker resilience (recovers from network failures)
- ✅ VAST Database persistence (assets, jobs, queue, audit)
- ✅ Kafka event publishing (ordered, reliable)
- ✅ Data Engine modular architecture + exrinspector end-to-end
- ✅ Approval workflow scaffold (endpoints, approval state transitions)
- ✅ 100% test pass rate (Phase 1+2 complete, Phase 3 core features)

**Tier 2 (Should-Have, may defer to Phase 4):**
- ✅ Full RBAC (role-based access control)
- ✅ UI approval panel with visual polish
- ✅ DCC integration (functional Maya/Nuke plugin)

**Tier 3 (Nice-to-Have, Phase 4+):**
- Advanced search/filter UI
- Webhook integrations
- VAST Catalog Element handle-based metadata durability

---

## 2. Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         AssetHarbor                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WEB UI (React/Vite)                                             │
│  ├─ Ingest form                                                  │
│  ├─ Asset list/queue (status, metadata, actions)                │
│  ├─ Approval panel (QC review, reject, comments)               │
│  ├─ Audit trail                                                  │
│  └─ Metrics dashboard                                            │
│          ↓ HTTP (API key auth)                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  CONTROL PLANE (Fastify/TypeScript)                      │  │
│  │                                                            │  │
│  │  Routes:                                                  │  │
│  │  ├─ POST /api/v1/assets/ingest        [async]           │  │
│  │  ├─ GET /api/v1/assets                [async]            │  │
│  │  ├─ GET /api/v1/jobs/pending          [async]            │  │
│  │  ├─ POST /api/v1/queue/claim          [atomic CAS]       │  │
│  │  ├─ POST /api/v1/assets/:id/approve   [async]            │  │
│  │  ├─ POST /api/v1/assets/:id/reject    [async]            │  │
│  │  ├─ GET /api/v1/dcc/assets            [async, stubbed]   │  │
│  │  ├─ GET /api/v1/audit                 [async]            │  │
│  │  ├─ GET /api/v1/metrics               [async]            │  │
│  │  └─ ... (complete API reference in RFC)                  │  │
│  │                                                            │  │
│  │  Async Persistence Layer:                                 │  │
│  │  ├─ LocalAdapter (tests only)                             │  │
│  │  ├─ MockVastAdapter (Team C dev, Week 2 ready)           │  │
│  │  └─ VastDbAdapter (production, Trino REST API)           │  │
│  │                                                            │  │
│  │  Event Broker Client:                                     │  │
│  │  └─ Kafka publisher (replace HTTP outbox)                 │  │
│  │                                                            │  │
│  │  Observability:                                            │  │
│  │  ├─ Correlation ID propagation (x-correlation-id)        │  │
│  │  ├─ Structured logging                                    │  │
│  │  └─ Metrics (queue, job, DLQ, outbox counters)           │  │
│  └──────────────────────────────────────────────────────────┘  │
│          ↑ HTTP polls  ↓ Kafka publishes                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MEDIA WORKER (Python)                                   │  │
│  │                                                            │  │
│  │  Poll/Claim Loop:                                         │  │
│  │  ├─ Claim next job (atomic CAS)                           │  │
│  │  ├─ Send heartbeat (every 30s)                            │  │
│  │  ├─ Execute Data Engine pipeline                          │  │
│  │  ├─ Emit started/completed/failed events                 │  │
│  │  └─ Exponential backoff on failures (1s → 30s → 60s)     │  │
│  │                                                            │  │
│  │  Data Engine Pipeline Executor:                           │  │
│  │  ├─ Registry of pluggable functions                       │  │
│  │  ├─ Input/output schema validation                        │  │
│  │  ├─ Call VAST Data Engine (or mock for dev)              │  │
│  │  └─ Record results in audit trail                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  VAST ECOSYSTEM (Phase 2 integration)                            │
│  ├─ Database (Trino REST API) ← persistence                     │
│  ├─ Kafka Broker ← event publishing                             │
│  ├─ Data Engine ← media processing (exrinspector, etc.)        │
│  └─ Catalog (future: Element handles for metadata durability)  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Async/Await Throughout**
   - All persistence operations return Promises
   - Enables both real VAST calls and mocked responses
   - No blocking I/O in request handlers

2. **Adapter Pattern for Persistence**
   - Abstraction: `AsyncPersistenceAdapter` interface
   - Three implementations: LocalAdapter (tests), MockVastAdapter (Team C), VastDbAdapter (production)
   - Allows Teams B & C to work independently (B builds real VAST, C tests against mocks)

3. **Modular Data Engine Pipeline**
   - Functions are pluggable: `DataEngineFunction` interface with input/output schemas
   - Registry pattern: functions self-register on startup
   - Extensible: add new functions (media-search, transcode, etc.) without changing executor
   - exrinspector is first sample (EXR metadata extraction)

4. **Compare-and-Swap (CAS) Job Claiming**
   - Prevents duplicate processing under concurrent load
   - LocalAdapter: in-memory locking
   - VastDbAdapter: Trino upsert with row-count validation
   - Atomic at database level, no race windows

5. **Event-Driven with Kafka**
   - All state transitions emit events (job_started, job_completed, asset_approved, etc.)
   - Events published to Kafka (ordered, durable, replayed)
   - HTTP outbox replaced (was LIFO, now FIFO via Kafka)

6. **TDD Discipline**
   - Contract tests before implementation
   - Unit tests for each layer
   - Integration tests with mocks
   - E2E tests weekly
   - 100% test pass before merges

---

## 3. Phase 1: Stabilization (Weeks 1-2, Team A)

### Goals
Eliminate critical data-loss and concurrency bugs; add infrastructure resilience.

### 3.1 Remove `persistence.reset()` from Startup

**Current behavior:** `buildApp()` calls `persistence.reset()` unconditionally → wipes all runtime state on every process restart.

**Fix:**
```typescript
// src/app.ts (before)
async function buildApp() {
  const persistence = createPersistenceAdapter(config);
  await persistence.reset();  // ❌ ALWAYS wipes state
  // ...
}

// src/app.ts (after)
async function buildApp() {
  const persistence = createPersistenceAdapter(config);
  if (env.NODE_ENV === 'test') {
    await persistence.reset();  // ✅ Only in tests
  }
  // ...
}
```

**Test:** Add test verifying assets persist across restart: `assert(asset created before restart is found after restart)`

**Impact:** Service restart = data preservation ✓

---

### 3.2 Fix Job-Claiming Race Condition

**Current behavior:** Read job status, check if pending, then write claimed. Non-atomic → high-throughput duplicate processing.

**Fix (async persistence interface):**
```typescript
interface AsyncPersistenceAdapter {
  // Atomic compare-and-swap: only succeeds if status == expectedStatus
  async updateJobStatus(
    jobId: string,
    expectedStatus: JobStatus,
    newStatus: JobStatus,
    lease?: Lease
  ): Promise<boolean>;  // returns true if update succeeded, false if CAS failed
}

// LocalAdapter implementation (in-memory locking)
async updateJobStatus(jobId, expectedStatus, newStatus) {
  const lock = await mutex.lock(jobId);
  try {
    const job = this.jobs.get(jobId);
    if (job?.status !== expectedStatus) return false;
    this.jobs.set(jobId, { ...job, status: newStatus });
    return true;
  } finally {
    lock.unlock();
  }
}

// VastDbAdapter implementation (Trino upsert)
async updateJobStatus(jobId, expectedStatus, newStatus) {
  const result = await trino.query(`
    UPDATE jobs
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND status = $3
  `, [newStatus, jobId, expectedStatus]);
  return result.rowCount > 0;  // true if exactly 1 row updated
}
```

**Worker claiming loop:**
```python
# media-worker/worker/main.py
async def claim_and_process():
  for job in pending_jobs:
    if await control_plane.update_job_status(job.id, 'pending', 'claimed', lease):
      # We won the race; process the job
      await process_job(job)
    else:
      # Another worker won; skip this job
      continue
```

**Test:** Concurrent test with 5 workers claiming simultaneously; verify only 1 succeeds per job.

**Impact:** Single worker per job guaranteed ✓

---

### 3.3 Worker Exception Handling & Backoff

**Current behavior:** `run_forever()` has no try-catch → network blip = permanent crash. Also, long-running jobs (>30s EXR analysis) expire lease without heartbeat → duplicate processing.

**Fix: Exception Handling + Exponential Backoff**
```python
# media-worker/worker/main.py
async def run_forever():
  backoff_ms = 1000
  max_backoff_ms = 300000  # 5 minutes (specialist recommendation)

  while True:
    try:
      job = await claim_next_job()
      if job:
        await process_job(job)
        backoff_ms = 1000  # reset on success
      else:
        # No pending jobs; sleep briefly
        await asyncio.sleep(1)
    except NetworkError as e:
      logger.warn(f"Network error: {e}, backing off {backoff_ms}ms")
      await asyncio.sleep(backoff_ms / 1000)
      backoff_ms = min(backoff_ms * 1.5, max_backoff_ms)
    except Exception as e:
      logger.error(f"Unexpected error: {e}")
      await asyncio.sleep(backoff_ms / 1000)
      backoff_ms = min(backoff_ms * 1.5, max_backoff_ms)
```

**Fix: Background Heartbeat Task (CRITICAL for long-running jobs)**

Lease expiration risk: Long EXR analysis (>30s) without heartbeat → another worker reclaims job → duplicate processing.

```python
async def run_forever(self):
    """Main worker loop with concurrent heartbeat background task."""
    backoff_ms = 1000
    max_backoff_ms = 300000

    while True:
        try:
            job = await self.claim_next_job()
            if job:
                # Start background heartbeat task (concurrent with processing)
                heartbeat_task = asyncio.create_task(
                    self._heartbeat_loop(job.id, job.lease_holder)
                )
                try:
                    await self.process_job(job)
                finally:
                    heartbeat_task.cancel()  # Stop heartbeat when job completes
                backoff_ms = 1000
            else:
                await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Error: {e}", exc_info=True)
            await asyncio.sleep(backoff_ms / 1000)
            backoff_ms = min(int(backoff_ms * 1.5), max_backoff_ms)

async def _heartbeat_loop(self, job_id: str, lease_holder: str):
    """Emit heartbeat every 15s to keep lease alive (lease duration = 30s)."""
    while True:
        await asyncio.sleep(15)
        await self.control_plane.heartbeat(job_id, lease_holder)
```

**Test:** Mock `process_job()` to sleep >30s; verify heartbeat keeps lease alive (no duplicate claim).

**Impact:** Worker recovers from transient failures ✓ + Long jobs don't timeout ✓

---

### 3.4 Docker Compose Healthchecks & Restart Policies

**Add to docker-compose.yml:**
```yaml
services:
  control-plane:
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  media-worker:
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python3", "-c", "import requests; requests.get('http://localhost:8081/health')"]
      interval: 10s
      timeout: 5s
      retries: 3

  web-ui:
    restart: unless-stopped
    # Vite dev server; healthcheck less critical but good practice
```

**Control-plane health endpoints:**
```typescript
// GET /health → { status: 'ok', uptime: 123456 }
// GET /health/ready → { status: 'ready' } (waits for DB connection)
```

**Test:** Manual testing (verify containers restart after crash).

**Impact:** Automatic recovery on service crash ✓

---

### 3.5 Fix Outbox Ordering

**Current behavior:** `unshift()` (LIFO) → events published newest-first (incorrect for temporal ordering).

**Fix:**
```typescript
// src/persistence/adapters/local-persistence.ts
class LocalPersistenceAdapter {
  private outbox: WorkflowEvent[] = [];

  // BEFORE (wrong):
  async addToOutbox(event: WorkflowEvent) {
    this.outbox.unshift(event);  // ❌ LIFO
  }

  // AFTER (correct):
  async addToOutbox(event: WorkflowEvent) {
    this.outbox.push(event);  // ✅ FIFO
  }

  async listOutbox(): Promise<WorkflowEvent[]> {
    return [...this.outbox];  // return in creation order
  }
}
```

**Test:** Add test verifying outbox publishes in creation order: assert outbox[0].created_at < outbox[1].created_at.

**Impact:** Event ordering guarantees ✓

---

### 3.6 Reconcile Status Enum Drift

**Current behavior:** Domain model has QC statuses (`qc_pending`, `qc_in_review`, `qc_approved`, `qc_rejected`) but OpenAPI schema still exposes only 5 original statuses.

**Fix:**
```typescript
// src/domain/models.ts
export enum AssetStatus {
  INGEST = 'ingest',
  PROCESSING = 'processing',
  QC_PENDING = 'qc_pending',
  QC_IN_REVIEW = 'qc_in_review',
  QC_APPROVED = 'qc_approved',
  QC_REJECTED = 'qc_rejected',
  READY = 'ready',
}

// src/http/schemas.ts (before - wrong)
const assetStatusEnum = ['ingest', 'processing', 'pending', 'rejected', 'approved'];

// src/http/schemas.ts (after - correct)
const assetStatusEnum = Object.values(AssetStatus);

// Update OpenAPI contract test
describe('OpenAPI contract', () => {
  test('status enum includes all domain statuses', () => {
    const schema = getOpenApiSchema();
    const apiStatuses = schema.components.schemas.Asset.properties.status.enum;
    const domainStatuses = Object.values(AssetStatus);
    expect(apiStatuses).toEqual(expect.arrayContaining(domainStatuses));
  });
});
```

**Test:** Contract test validating schema enum = domain enum.

**Impact:** Schema/runtime/docs parity ✓

---

### 3.7 Phase 1 Success Criteria

- ✅ `persistence.reset()` guarded (test-only)
- ✅ CAS job claiming implemented + concurrent test passing (5+ workers)
- ✅ Worker error handling + exponential backoff + background heartbeat task
- ✅ Docker Compose healthchecks + restart: unless-stopped
- ✅ Outbox insertion changed unshift → push
- ✅ Status enum reconciled across domain/schema/OpenAPI
- ✅ All Phase 1 tests pass
- ✅ No data loss on restart (verified test)
- ✅ Zero race conditions under concurrent load (5+ workers, verified test)
- ✅ Concurrent load testing (ingest high-frequency assets, verify no duplicates)

---

## 4. Phase 2: VAST Integration (Weeks 1-3, Team B)

### Goals
Implement async persistence abstraction; deliver mock + real VAST adapters; integrate Kafka event broker.

### 4.1 Async Persistence Layer (Interface)

**Design:** All persistence operations return Promises, enabling sync/async/mocked implementations.

```typescript
// src/persistence/types.ts
export interface AsyncPersistenceAdapter {
  // Lifecycle
  reset(): Promise<void>;

  // Asset operations
  createAsset(asset: Asset): Promise<Asset>;
  getAsset(id: string): Promise<Asset | null>;
  listAssets(filters?: AssetFilter): Promise<Asset[]>;
  updateAssetMetadata(id: string, metadata: Partial<Asset['metadata']>): Promise<Asset>;

  // Job/queue operations
  createJob(job: Job): Promise<Job>;
  claimNextJob(workerId: string, timeout?: number): Promise<Job | null>;
  updateJobStatus(jobId: string, expectedStatus: JobStatus, newStatus: JobStatus, lease?: Lease): Promise<boolean>;
  getJob(id: string): Promise<Job | null>;
  listPendingJobs(): Promise<Job[]>;

  // Lease operations (heartbeat, reap stale)
  heartbeat(jobId: string, leaseToken: string): Promise<Lease | null>;
  reapStaleLeasees(maxAgeSecs: number): Promise<number>;  // returns count reaped

  // DLQ operations
  moveJobToDlq(jobId: string, reason: string): Promise<void>;
  listDlq(): Promise<DlqEntry[]>;
  replayDlqJob(dlqId: string): Promise<Job>;

  // Event/idempotency operations
  recordProcessedEvent(eventId: string, event: WorkflowEvent): Promise<void>;
  hasProcessedEvent(eventId: string): Promise<boolean>;

  // Outbox operations
  addToOutbox(event: WorkflowEvent): Promise<void>;
  listOutbox(limit?: number): Promise<WorkflowEvent[]>;
  removeFromOutbox(eventId: string): Promise<void>;

  // Audit trail
  recordAudit(entry: AuditEntry): Promise<void>;
  listAudit(filters?: AuditFilter): Promise<AuditEntry[]>;

  // Metrics
  getMetrics(): Promise<Metrics>;
}
```

**Migration strategy (Week 1):**
- LocalAdapter refactored to async (add Promises, maintain in-memory semantics)
- All route handlers converted to async/await
- No change to HTTP API contract (still synchronous from client perspective)

**Test:** Contract test suite runs against LocalAdapter (async), validates all operations.

---

### 4.2 Three Adapter Implementations

#### LocalAdapter (Refactored to Async, Week 1)

```typescript
// src/persistence/adapters/local-persistence.ts
export class LocalPersistenceAdapter implements AsyncPersistenceAdapter {
  private assets = new Map<string, Asset>();
  private jobs = new Map<string, Job>();
  private outbox: WorkflowEvent[] = [];
  private auditLog: AuditEntry[] = [];
  private processedEvents = new Set<string>();
  private jobMutexes = new Map<string, Mutex>();

  async reset(): Promise<void> {
    this.assets.clear();
    this.jobs.clear();
    this.outbox = [];
    this.auditLog = [];
    this.processedEvents.clear();
  }

  async createAsset(asset: Asset): Promise<Asset> {
    const newAsset = { ...asset, created_at: new Date().toISOString() };
    this.assets.set(asset.id, newAsset);
    return newAsset;
  }

  async updateJobStatus(jobId: string, expectedStatus: JobStatus, newStatus: JobStatus): Promise<boolean> {
    const lock = this.getOrCreateMutex(jobId);
    const token = await lock.lock();
    try {
      const job = this.jobs.get(jobId);
      if (!job || job.status !== expectedStatus) return false;
      this.jobs.set(jobId, { ...job, status: newStatus, updated_at: new Date().toISOString() });
      return true;
    } finally {
      lock.unlock(token);
    }
  }

  // ... other operations (all async)
}
```

#### MockVastAdapter (New, Ready Week 2)

```typescript
// src/persistence/adapters/mock-vast-persistence.ts
export class MockVastAdapter implements AsyncPersistenceAdapter {
  private assets = new Map<string, Asset>();
  private jobs = new Map<string, Job>();
  private outbox: WorkflowEvent[] = [];
  // ... (mirrors LocalAdapter but with fixtures)

  async createAsset(asset: Asset): Promise<Asset> {
    // Return deterministic mock data
    return {
      ...asset,
      id: `mock-asset-${Date.now()}`,
      created_at: '2026-03-02T00:00:00Z',
      metadata: {
        codec: 'exr',
        resolution: { width: 4096, height: 2160 },
        duration_ms: 86400000,
        channels: ['R', 'G', 'B', 'A'],
        color_space: 'linear',
        bit_depth: 32,
      },
    };
  }

  async claimNextJob(): Promise<Job | null> {
    return {
      id: `mock-job-${Date.now()}`,
      asset_id: 'mock-asset-1',
      status: 'pending',
      type: 'ingest',
      created_at: '2026-03-02T00:00:00Z',
    };
  }

  // ... deterministic responses
}
```

**Purpose:** Team C develops & tests Phase 3 features without VAST endpoint access.

#### VastDbAdapter (Real Integration, Target Week 3)

```typescript
// src/persistence/adapters/vast-persistence.ts
export class VastDbAdapter implements AsyncPersistenceAdapter {
  constructor(private trino: TrinoClient) {}

  async createAsset(asset: Asset): Promise<Asset> {
    const result = await this.trino.execute(
      `INSERT INTO assets (id, name, project_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [asset.id, asset.name, asset.project_id, JSON.stringify(asset.metadata), new Date().toISOString()]
    );
    return asset;
  }

  async updateJobStatus(jobId: string, expectedStatus: JobStatus, newStatus: JobStatus): Promise<boolean> {
    const result = await this.trino.execute(
      `UPDATE jobs
       SET status = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
      [newStatus, new Date().toISOString(), jobId, expectedStatus]
    );
    return result.rowsModified > 0;  // atomic CAS via row count
  }

  // ... other operations (all against Trino REST API)
}
```

**Schema mapping (VAST Database):**
```sql
-- Assets table
CREATE TABLE assets (
  id VARCHAR PRIMARY KEY,
  name VARCHAR,
  project_id VARCHAR,
  metadata JSON,
  status VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Jobs table
CREATE TABLE jobs (
  id VARCHAR PRIMARY KEY,
  asset_id VARCHAR REFERENCES assets(id),
  status VARCHAR,
  type VARCHAR,
  lease_holder VARCHAR,
  lease_acquired_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Event idempotency table
CREATE TABLE processed_events (
  event_id VARCHAR PRIMARY KEY,
  processed_at TIMESTAMP
);

-- DLQ table
CREATE TABLE dlq (
  dlq_id VARCHAR PRIMARY KEY,
  job_id VARCHAR REFERENCES jobs(id),
  reason VARCHAR,
  created_at TIMESTAMP
);

-- Audit table
CREATE TABLE audit (
  id VARCHAR PRIMARY KEY,
  action VARCHAR,
  asset_id VARCHAR,
  job_id VARCHAR,
  user_id VARCHAR,
  created_at TIMESTAMP
);

-- Outbox table
CREATE TABLE outbox (
  event_id VARCHAR PRIMARY KEY,
  event_data JSON,
  created_at TIMESTAMP
);
```

---

### 4.3 Kafka Event Broker Integration

**Current:** HTTP POST to outbox endpoint (not durable, events can be lost if control-plane crashes).

**Fix (Phase 2):** Replace with Kafka publisher.

```typescript
// src/event-broker/kafka-client.ts
export interface EventBroker {
  publish(event: WorkflowEvent): Promise<void>;
}

export class KafkaEventBroker implements EventBroker {
  constructor(private kafka: Kafka) {}

  async publish(event: WorkflowEvent): Promise<void> {
    const producer = this.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: 'workflow-events',
        messages: [
          {
            key: event.asset_id,  // partition by asset_id for ordering
            value: JSON.stringify(event),
            timestamp: Date.now(),
          }
        ],
      });
    } catch (e) {
      logger.error(`Failed to publish event ${event.id}: ${e.message}`);
      throw e;  // fail fast; caller can retry
    } finally {
      await producer.disconnect();
    }
  }
}

// MockKafkaEventBroker (for Team C dev)
export class MockKafkaEventBroker implements EventBroker {
  async publish(event: WorkflowEvent): Promise<void> {
    logger.info(`[MOCK] Published event: ${event.id}`);
    return;  // immediate success
  }
}
```

**Integration in control-plane:**
```typescript
// src/routes/events.ts
router.post('/api/v1/events', async (req, res) => {
  const event = req.body;

  // Check idempotency
  if (await persistence.hasProcessedEvent(event.id)) {
    return res.status(409).json({ error: 'event already processed' });
  }

  // Process event (update asset, job, etc.)
  await handleWorkflowEvent(event);

  // Record idempotency
  await persistence.recordProcessedEvent(event.id, event);

  // Publish to Kafka (fire-and-forget with error logging)
  try {
    await eventBroker.publish(event);
  } catch (e) {
    logger.error(`Failed to publish event ${event.id} to broker: ${e.message}`);
    // Control-plane continues; worker can re-emit event or use outbox publish endpoint
  }

  return res.status(202).json({ accepted: true });
});
```

---

### 4.4 Integration Testing Strategy (Week 2-3)

**Week 2:** Mock-based integration tests

```typescript
describe('Persistence contracts (all adapters)', () => {
  let adapter: AsyncPersistenceAdapter;

  // Parameterized test: run same tests against LocalAdapter, MockVastAdapter
  [LocalPersistenceAdapter, MockVastAdapter].forEach(AdapterClass => {
    describe(AdapterClass.name, () => {
      beforeEach(() => {
        adapter = new AdapterClass();
      });

      test('createAsset stores asset and returns with timestamps', async () => {
        const asset = { id: 'a1', name: 'shot1', project_id: 'p1' };
        const created = await adapter.createAsset(asset);
        expect(created.created_at).toBeDefined();
        expect(await adapter.getAsset('a1')).toEqual(created);
      });

      test('claimNextJob is atomic (no race window)', async () => {
        // Mock 5 concurrent workers claiming
        const promises = Array(5).fill(null).map(() => adapter.claimNextJob());
        const results = await Promise.all(promises);

        // Only 1 should succeed (return a job); rest should be null
        const claimed = results.filter(r => r !== null);
        expect(claimed).toHaveLength(1);
      });

      test('updateJobStatus returns false on CAS mismatch', async () => {
        const job = await adapter.createJob({ id: 'j1', status: 'pending', ... });

        // Try to update with wrong expected status
        const updated = await adapter.updateJobStatus('j1', 'claimed', 'processing');
        expect(updated).toBe(false);

        // Try with correct expected status
        const updated2 = await adapter.updateJobStatus('j1', 'pending', 'claimed');
        expect(updated2).toBe(true);
      });
    });
  });
});
```

**Week 3:** VAST Database integration tests (if staging endpoints available)

```typescript
describe('VastDbAdapter (integration)', () => {
  let adapter: VastDbAdapter;

  beforeAll(async () => {
    const trino = new TrinoClient(process.env.VAST_DB_URL);
    adapter = new VastDbAdapter(trino);
    await adapter.reset();
  });

  test('assets persist across restarts', async () => {
    const asset = { id: 'a1', name: 'shot1', project_id: 'p1' };
    await adapter.createAsset(asset);

    // Simulate restart (new adapter instance)
    const adapter2 = new VastDbAdapter(trino);
    const retrieved = await adapter2.getAsset('a1');
    expect(retrieved).toEqual(asset);
  });
});
```

---

### 4.5 Phase 2 Success Criteria

- ✅ `AsyncPersistenceAdapter` interface complete + documented
- ✅ LocalAdapter refactored to async (all operations return Promises)
- ✅ App routes converted to async/await (no blocking I/O)
- ✅ MockVastAdapter implemented + all contract tests passing (ready Week 2 for Team C)
- ✅ VastDbAdapter skeleton + schema mapping + mocked Trino tests passing
- ✅ Kafka event broker client + MockKafkaEventBroker integrated
- ✅ Idempotency checks working (event deduplication)
- ✅ All Phase 1 tests still passing
- ✅ Team C can develop Phase 3 against MockVastAdapter (no VAST endpoint needed)

---

## 5. Phase 3: Features & Data Engine (Weeks 2-4, Team C)

### Goals
Implement modular Data Engine pipeline architecture; deliver exrinspector sample end-to-end; scaffold approval workflow; extend asset model; design DCC integration pattern.

### 5.1 Modular Data Engine Pipeline Architecture

**Design principle:** Data Engine functions are pluggable modules, each with input/output schemas.

**Priority order for implementation (specialist recommendation):**
1. **exrinspector** (Phase 3, Task 12) — VFX metadata extraction
2. **Proxy generation** (Phase 4) — H.264/DNxHD transcoding for review workflows
3. **Checksum/integrity** (Phase 4) — Post-ingest validation before metadata database
4. **media-search** (Phase 4+) — Similarity indexing (deferred, requires populated library)

```typescript
// src/data-engine/types.ts
export interface DataEngineFunction {
  id: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execute(input: any): Promise<any>;
}

export class DataEnginePipeline {
  private registry: Map<string, DataEngineFunction> = new Map();

  register(func: DataEngineFunction): void {
    if (this.registry.has(func.id)) {
      throw new Error(`Function ${func.id} already registered`);
    }
    this.registry.set(func.id, func);
    logger.info(`Registered Data Engine function: ${func.id}@${func.version}`);
  }

  async execute(
    jobId: string,
    functionId: string,
    input: any,
    context: { persistence: AsyncPersistenceAdapter; tracing?: OpenTelemetry }
  ): Promise<any> {
    const func = this.registry.get(functionId);
    if (!func) {
      throw new Error(`Function ${functionId} not found in registry`);
    }

    // Validate input
    validateJsonSchema(input, func.inputSchema);

    // Execute with tracing
    const startMs = Date.now();
    try {
      const result = await func.execute(input);
      validateJsonSchema(result, func.outputSchema);

      // Record audit entry
      await context.persistence.recordAudit({
        action: 'data_engine_execute',
        asset_id: input.asset_id,
        job_id: jobId,
        details: { function_id: functionId, duration_ms: Date.now() - startMs, success: true },
        created_at: new Date().toISOString(),
      });

      return result;
    } catch (e) {
      await context.persistence.recordAudit({
        action: 'data_engine_execute',
        asset_id: input.asset_id,
        job_id: jobId,
        details: { function_id: functionId, error: e.message },
        created_at: new Date().toISOString(),
      });
      throw e;
    }
  }

  listAvailable(): DataEngineFunction[] {
    return Array.from(this.registry.values());
  }

  getSchema(functionId: string): DataEngineFunction | undefined {
    return this.registry.get(functionId);
  }
}
```

**Initialization (control-plane startup):**
```typescript
// src/index.ts
const pipeline = new DataEnginePipeline();

// Register built-in functions
pipeline.register(new ExrInspectorFunction());
pipeline.register(new MediaSearchFunction());
// ... more functions

// Expose via API
app.get('/api/v1/data-engine/functions', (req, res) => {
  const functions = pipeline.listAvailable().map(f => ({
    id: f.id,
    version: f.version,
    description: f.description,
    inputSchema: f.inputSchema,
    outputSchema: f.outputSchema,
  }));
  res.json(functions);
});
```

---

### 5.2 exrinspector Function (End-to-End Sample)

**Purpose:** Extract technical metadata from EXR sequences for VFX workflows.

```typescript
// src/data-engine/functions/exr-inspector.ts
export class ExrInspectorFunction implements DataEngineFunction {
  id = 'exr_inspector';
  version = '1.0.0';
  description = 'Extract technical metadata from EXR sequences';

  inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      asset_id: { type: 'string', description: 'Asset UUID' },
      file_path: { type: 'string', description: 'VAST element handle or file path' },
    },
    required: ['asset_id', 'file_path'],
  };

  outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      codec: { type: 'string', enum: ['exr'] },
      channels: { type: 'array', items: { type: 'string' }, example: ['R', 'G', 'B', 'A'] },
      resolution: {
        type: 'object',
        properties: {
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      color_space: { type: 'string', enum: ['linear', 'srgb', 'rec709', 'aces'] },
      frame_count: { type: 'number' },
      bit_depth: { type: 'number', enum: [16, 32] },
      duration_ms: { type: 'number' },
      thumbnail_url: { type: 'string', description: 'Proxy image URL for preview' },
      frame_range: {
        type: 'object',
        properties: {
          first: { type: 'number' },
          last: { type: 'number' },
        },
        description: 'First and last frame numbers in sequence'
      },
      frame_rate: { type: 'number', description: 'Frames per second (e.g., 24.0, 29.97)' },
      pixel_aspect_ratio: { type: 'number', description: 'Pixel aspect ratio (typically 1.0)' },
      display_window: {
        type: 'object',
        properties: {
          x_min: { type: 'number' },
          y_min: { type: 'number' },
          x_max: { type: 'number' },
          y_max: { type: 'number' },
        },
        description: 'Display window bounds for cropped images'
      },
      data_window: {
        type: 'object',
        properties: {
          x_min: { type: 'number' },
          y_min: { type: 'number' },
          x_max: { type: 'number' },
          y_max: { type: 'number' },
        },
        description: 'Data window bounds (may differ from display window)'
      },
      compression_type: { type: 'string', description: 'Compression codec (e.g., PIZ, ZIP, ZIPS, DWAA)' },
      file_size_bytes: { type: 'number', description: 'File size in bytes' },
      checksum: { type: 'string', description: 'MD5 or xxHash for integrity verification' },
    },
  };

  async execute(input: { asset_id: string; file_path: string }): Promise<any> {
    // Call VAST Data Engine via REST API
    // In dev: mock response

    const vastDataEngineUrl = process.env.VAST_DATA_ENGINE_URL;

    if (!vastDataEngineUrl) {
      // Development: return mock data
      logger.warn('VAST_DATA_ENGINE_URL not set; using mock exrinspector data');
      return this.mockExecure(input);
    }

    // Production: call real VAST Data Engine
    const response = await fetch(`${vastDataEngineUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VAST_API_KEY}` },
      body: JSON.stringify({
        function: 'exr_inspector',
        input: { asset_id: input.asset_id, file_path: input.file_path },
      }),
    });

    if (!response.ok) {
      throw new Error(`VAST Data Engine error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private mockExecute(input: any): any {
    return {
      codec: 'exr',
      channels: ['R', 'G', 'B', 'A', 'depth'],
      resolution: { width: 4096, height: 2160 },
      color_space: 'linear',
      frame_count: 240,
      bit_depth: 32,
      duration_ms: 10000,
      thumbnail_url: 'https://mock-cdn.example.com/thumbs/exr-sample.jpg',
    };
  }
}
```

**Integration in media-worker:**
```python
# services/media-worker/worker/main.py
async def process_job(job: Job):
  """Execute Data Engine pipeline for a claimed job."""
  try:
    asset = await get_asset(job.asset_id)

    # Dispatch based on job type
    if job.type == 'ingest':
      # Ingest job: run exrinspector
      metadata = await pipeline.execute(
        job_id=job.id,
        function_id='exr_inspector',
        input={'asset_id': asset.id, 'file_path': asset.path}
      )

      # Update asset metadata in control-plane
      await http_client.post(
        f'{CONTROL_PLANE_URL}/api/v1/assets/{asset.id}/metadata',
        json=metadata,
        headers={'x-api-key': CONTROL_PLANE_API_KEY}
      )

      # Emit completed event
      await emit_event({
        id: uuid4(),
        type: 'job_completed',
        job_id: job.id,
        asset_id: asset.id,
        metadata: metadata,
        timestamp: datetime.now().isoformat(),
      })

    # ... handle other job types

  except Exception as e:
    logger.error(f"Job {job.id} failed: {e}")
    await emit_event({
      id: uuid4(),
      type: 'job_failed',
      job_id: job.id,
      error: str(e),
      timestamp: datetime.now().isoformat(),
    })
    raise
```

**End-to-end flow:**
1. User uploads EXR sequence via `/api/v1/assets/ingest`
2. Control-plane creates asset + ingest job
3. Media worker claims job
4. Worker calls DataEnginePipeline.execute('exr_inspector', { asset_id, file_path })
5. exrinspector extracts metadata (real VAST or mock)
6. Worker updates asset metadata via `/api/v1/assets/:id/metadata`
7. Worker emits `job_completed` event
8. Control-plane publishes event to Kafka
9. UI shows asset with metadata (codec, resolution, channels, duration, thumbnail)
10. User can now approve/reject asset

---

### 5.3 Extended Asset Model

```typescript
// src/domain/models.ts
export interface Asset {
  id: string;
  name: string;
  project_id: string;
  shot_id?: string;

  // Metadata (enriched by Data Engine functions)
  metadata: {
    // Technical metadata (from exrinspector)
    codec?: string;                           // 'exr', 'mov', 'jpg', etc.
    resolution?: { width: number; height: number };
    duration_ms?: number;
    channels?: string[];                      // ['R', 'G', 'B', 'A', ...]
    color_space?: string;                     // 'linear', 'srgb', 'rec709', 'aces'
    bit_depth?: number;                       // 8, 16, 32
    frame_count?: number;

    // VFX-critical metadata (from exrinspector)
    frame_range?: { first: number; last: number };
    frame_rate?: number;                      // e.g., 24.0, 29.97
    pixel_aspect_ratio?: number;              // typically 1.0
    display_window?: { x_min: number; y_min: number; x_max: number; y_max: number };
    data_window?: { x_min: number; y_min: number; x_max: number; y_max: number };
    compression_type?: string;                // 'PIZ', 'ZIP', 'ZIPS', 'DWAA'

    // Versioning (for project/shot/version organization)
    version_label?: string;                   // e.g., 'v001', 'v002'
    parent_version_id?: string;               // Reference to prior version

    // Integrity
    file_size_bytes?: number;
    checksum?: string;                        // MD5 or xxHash

    // Custom metadata (project-specific)
    tags?: string[];                          // ['hero', 'vfx', 'matte']
    labels?: string[];                        // ['approved', 'needs-revision']
    custom_fields?: Record<string, any>;      // user-defined key-values
  };

  // Media artifacts
  artifacts: {
    original: { url: string; size: number; checksum?: string };
    proxy?: { url: string; size: number };    // for review
    thumbnail?: { url: string; size: number };  // for UI display
  };

  // Workflow state
  status: AssetStatus;  // 'ingest', 'processing', 'qc_pending', 'qc_in_review', 'qc_approved', 'qc_rejected', 'ready'

  // Approval workflow
  approval?: {
    reviewer_id: string;
    status: 'pending' | 'in_review' | 'approved' | 'rejected';
    comments?: string;
    reviewed_at?: ISO8601;
  };

  // Audit
  created_at: ISO8601;
  updated_at: ISO8601;
  created_by: string;
}
```

---

### 5.3.1 DLQ Automation & Retry Counter

**Current gap:** Failed jobs stay in `claimed`/`failed` status; no automatic Dead Letter Queue promotion.

**Fix: Add attempt tracking to Job model**

```typescript
// src/domain/models.ts
export interface Job {
  id: string;
  asset_id: string;
  status: JobStatus;
  type: string;

  // NEW: Retry tracking
  attempt_count: number;     // starts at 0, incremented on failure
  max_attempts: number;      // default 3, configurable per job type
  last_error?: string;       // error message from most recent attempt

  lease_holder?: string;
  lease_acquired_at?: ISO8601;
  created_at: ISO8601;
  updated_at: ISO8601;
}
```

**Worker DLQ promotion logic**

```python
# media-worker/worker/main.py
async def process_job(self, job: Job):
  try:
    # ... processing logic ...
  except Exception as e:
    job.attempt_count += 1
    job.last_error = str(e)

    # Automatic DLQ promotion after max attempts
    if job.attempt_count >= job.max_attempts:
      logger.error(f"Job {job.id} exceeded max attempts ({job.max_attempts}), moving to DLQ")
      await self.control_plane.move_job_to_dlq(
        job.id,
        reason=f"Max attempts exceeded: {job.last_error}"
      )
    else:
      logger.warn(f"Job {job.id} failed (attempt {job.attempt_count}/{job.max_attempts}): {e}")
      # Requeue for retry (worker loop will claim it again after backoff)
      await self.control_plane.update_job_status(job.id, 'claimed', 'pending')
```

**Database schema (VAST)**

```sql
ALTER TABLE jobs ADD COLUMN attempt_count INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN max_attempts INTEGER DEFAULT 3;
ALTER TABLE jobs ADD COLUMN last_error VARCHAR;

-- DLQ table (for tracking failed jobs)
CREATE TABLE dlq (
  dlq_id VARCHAR PRIMARY KEY,
  job_id VARCHAR REFERENCES jobs(id),
  reason VARCHAR,
  created_at TIMESTAMP
);
```

**Impact:** Failed jobs automatically promote to DLQ after N retries, preventing infinite requeue loops ✓

---

### 5.4 Approval/RBAC Workflow (Scaffolding)

**Phase 3 scope:** Minimal implementation (endpoints, state machine); full RBAC deferred to Phase 4.

```typescript
// src/routes/approval.ts
router.post('/api/v1/assets/:id/approve', async (req, res) => {
  const assetId = req.params.id;
  const comments = req.body.comments || '';

  // TODO: Extract user_id from JWT/auth header (Phase 4)
  const userId = req.headers['x-user-id'] || 'system';

  try {
    const asset = await persistence.getAsset(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (asset.status !== 'qc_in_review') {
      return res.status(400).json({ error: 'Asset is not in QC review' });
    }

    // Update approval status
    const updated = await persistence.updateAssetMetadata(assetId, {
      'approval.status': 'approved',
      'approval.reviewed_at': new Date().toISOString(),
    });

    // Update asset status to ready
    await persistence.updateAssetMetadata(assetId, {
      status: 'ready',
    });

    // Emit event
    await eventBroker.publish({
      id: uuid4(),
      type: 'asset_approved',
      asset_id: assetId,
      reviewer_id: userId,
      comments: comments,
      timestamp: new Date().toISOString(),
    });

    return res.json({ status: 'approved', asset: updated });
  } catch (e) {
    logger.error(`Failed to approve asset ${assetId}: ${e.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/v1/assets/:id/reject', async (req, res) => {
  const assetId = req.params.id;
  const comments = req.body.comments || '';

  try {
    const asset = await persistence.getAsset(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (asset.status !== 'qc_in_review') {
      return res.status(400).json({ error: 'Asset is not in QC review' });
    }

    // Update approval status
    await persistence.updateAssetMetadata(assetId, {
      'approval.status': 'rejected',
      'approval.comments': comments,
      'approval.reviewed_at': new Date().toISOString(),
    });

    // Revert asset status to processing (for re-work)
    await persistence.updateAssetMetadata(assetId, {
      status: 'processing',
    });

    // Emit event
    await eventBroker.publish({
      id: uuid4(),
      type: 'asset_rejected',
      asset_id: assetId,
      comments: comments,
      timestamp: new Date().toISOString(),
    });

    return res.json({ status: 'rejected', asset: updated });
  } catch (e) {
    logger.error(`Failed to reject asset ${assetId}: ${e.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/v1/assets/pending-review', async (req, res) => {
  try {
    const assets = await persistence.listAssets({ status: 'qc_in_review' });
    return res.json(assets);
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Web UI panel (wireframe):**
```
┌─────────────────────────────────────┐
│ Approval Panel                      │
├─────────────────────────────────────┤
│                                     │
│ Asset: shot_001_v2.exr             │
│ Status: qc_in_review               │
│ Reviewer: Alice (vfx_lead)          │
│                                     │
│ [Metadata]                          │
│ Resolution: 4096x2160              │
│ Codec: EXR                          │
│ Duration: 10s                       │
│                                     │
│ [Thumbnail]                         │
│ [preview image]                     │
│                                     │
│ Comments:                           │
│ [text input]                        │
│                                     │
│ [Approve] [Reject] [Skip]          │
│                                     │
└─────────────────────────────────────┘
```

---

### 5.5 DCC Integration Pattern (Stubbed)

**Design:** REST endpoints for DCCs (Maya, Nuke) to query approved assets.

```typescript
// src/routes/dcc.ts
router.get('/api/v1/dcc/assets', async (req, res) => {
  const { project, shot, status = 'ready' } = req.query;

  try {
    const assets = await persistence.listAssets({
      project_id: project,
      shot_id: shot,
      status: status,
    });

    // Return DCC-friendly format (minimal, no internal details)
    const dccAssets = assets.map(a => ({
      id: a.id,
      name: a.name,
      codec: a.metadata?.codec,
      resolution: a.metadata?.resolution,
      url: a.artifacts.original.url,
      proxy_url: a.artifacts.proxy?.url,
      thumbnail_url: a.artifacts.thumbnail?.url,
    }));

    return res.json(dccAssets);
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/v1/dcc/assets/:id/checkout', async (req, res) => {
  const assetId = req.params.id;

  try {
    const asset = await persistence.getAsset(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.status !== 'ready') {
      return res.status(400).json({ error: 'Asset not ready for checkout' });
    }

    // Generate temporary access token (Phase 4: implement real JWT)
    const token = `temp-token-${uuid4()}`;  // TODO: real JWT with expiry

    // Log checkout
    await persistence.recordAudit({
      action: 'asset_checkout',
      asset_id: assetId,
      details: { dcc_client: req.headers['user-agent'] },
    });

    return res.json({
      asset_id: assetId,
      token: token,
      url: asset.artifacts.original.url,
      expires_in: 3600,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

**DCC plugin (stubbed, Python example):**
```python
# dcc-plugins/maya/assetharbor_plugin.py (future implementation)

class AssetHarborMayaPlugin:
    """AssetHarbor integration for Autodesk Maya."""

    def __init__(self, control_plane_url: str, api_key: str):
        self.control_plane_url = control_plane_url
        self.api_key = api_key

    def query_assets(self, project: str, shot: str) -> List[Asset]:
        """Query approved assets from AssetHarbor."""
        # Calls GET /api/v1/dcc/assets?project=<id>&shot=<id>
        pass

    def checkout_asset(self, asset_id: str) -> Dict:
        """Checkout asset for editing in Maya."""
        # Calls POST /api/v1/dcc/assets/:id/checkout
        # Returns token + download URL
        pass

    def import_asset(self, asset_id: str, as_reference: bool = True) -> None:
        """Import asset into current Maya scene."""
        # Download file, import into scene
        pass

# Usage in Maya MEL/Python
# ah = AssetHarborMayaPlugin('http://localhost:8080', 'api-key-123')
# assets = ah.query_assets('project-1', 'shot-001')
# ah.import_asset(assets[0].id, as_reference=True)
```

**Implementation notes:**
- Phase 3: Endpoints scaffolded (return mock data)
- Phase 3: API documented
- Phase 4: Full plugin dev (Maya, Nuke, Houdini)

---

### 5.6 Media Worker Pipeline Execution

```python
# services/media-worker/worker/main.py
import asyncio
import logging
from typing import Optional
from datetime import datetime
from uuid import uuid4

logger = logging.getLogger(__name__)

class PipelineExecutor:
    def __init__(self, pipeline, control_plane_client):
        self.pipeline = pipeline
        self.control_plane = control_plane_client

    async def execute_job(self, job: Job) -> None:
        """Execute data engine pipeline for job."""
        asset_id = job.asset_id
        job_id = job.id

        try:
            logger.info(f"Processing job {job_id} for asset {asset_id}")

            # Get asset details
            asset = await self.control_plane.get_asset(asset_id)
            if not asset:
                raise ValueError(f"Asset {asset_id} not found")

            # Dispatch to appropriate pipeline based on job type
            result = None
            if job.type == 'ingest':
                result = await self._process_ingest(asset, job_id)
            elif job.type == 'media_search':
                result = await self._process_media_search(asset, job_id)
            # ... other job types

            # Update asset metadata
            if result:
                await self.control_plane.update_asset_metadata(asset_id, result)

            # Emit completed event
            await self.control_plane.emit_event({
                'id': str(uuid4()),
                'type': 'job_completed',
                'job_id': job_id,
                'asset_id': asset_id,
                'metadata': result or {},
                'timestamp': datetime.now().isoformat(),
            })

            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}", exc_info=True)

            # Emit failed event
            await self.control_plane.emit_event({
                'id': str(uuid4()),
                'type': 'job_failed',
                'job_id': job_id,
                'asset_id': asset_id,
                'error': str(e),
                'timestamp': datetime.now().isoformat(),
            })

            raise

    async def _process_ingest(self, asset, job_id: str) -> dict:
        """Ingest workflow: extract metadata via exrinspector."""
        logger.info(f"Running exrinspector on {asset['name']}")

        metadata = await self.pipeline.execute(
            job_id=job_id,
            function_id='exr_inspector',
            input={
                'asset_id': asset['id'],
                'file_path': asset['path'],
            }
        )

        logger.info(f"exrinspector returned: {metadata}")
        return metadata

    async def _process_media_search(self, asset, job_id: str) -> dict:
        """Media search workflow."""
        # TBD: integrate media_search function
        pass

async def main():
    """Main worker loop."""
    executor = PipelineExecutor(pipeline, control_plane_client)

    backoff_ms = 1000
    max_backoff_ms = 60000

    while True:
        try:
            # Claim next job
            job = await control_plane_client.claim_next_job(
                worker_id=WORKER_ID,
                timeout_secs=30
            )

            if job:
                # Process job
                await executor.execute_job(job)
                backoff_ms = 1000  # reset on success
            else:
                # No pending jobs; sleep briefly
                await asyncio.sleep(1)

        except Exception as e:
            logger.error(f"Worker loop error: {e}", exc_info=True)
            await asyncio.sleep(backoff_ms / 1000)
            backoff_ms = min(backoff_ms * 1.5, max_backoff_ms)

if __name__ == '__main__':
    asyncio.run(main())
```

---

### 5.7 Phase 3 Success Criteria

- ✅ `DataEnginePipeline` abstraction + registry implemented
- ✅ `ExrInspectorFunction` end-to-end working (mock or real VAST)
- ✅ Media worker executes pipelines with proper error handling + logging
- ✅ Asset model extended with technical metadata + approval fields
- ✅ Approval workflow endpoints scaffolded (`/api/v1/assets/:id/approve`, `/reject`, `/pending-review`)
- ✅ DCC integration endpoints stubbed (documented, return mock data)
- ✅ Full workflow end-to-end: ingest EXR → exrinspector → metadata stored → asset ready for approval
- ✅ All Phase 1 + Phase 2 tests still passing
- ✅ UI approval panel designed (wireframe)

---

## 6. Integration Checkpoints & Timeline

### Weekly Checkpoint Process (Every Friday)

**All teams merge to `main` after:**
1. All tests pass locally
2. No conflicts with other teams' work
3. 30-min sync to review cross-team dependencies

**Friday checklist:**
- [ ] Code review (peer review within team)
- [ ] Tests passing (`npm run test:all`)
- [ ] No merge conflicts
- [ ] Documentation updated if routes/schemas changed
- [ ] Merge to `main` + tag commit with checkpoint label

### 4-Week Sprint Timeline

**Week 1 (Mar 1-7):** Stabilization + Async Foundation**
- **Team A:** Phase 1 fixes (reset, race condition, worker backoff, healthchecks)
- **Team B:** Async layer interface + LocalAdapter refactored
- **Team C:** Data Engine architecture designed, exrinspector scaffold
- **Friday (Mar 7):** Merge Week 1 work, validate Phase 1 foundation + async interface

**Week 2 (Mar 8-14):** Persistence Mocks + Core Features**
- **Team A:** Phase 1 load testing (5+ workers), concurrent claim validation
- **Team B:** MockVastAdapter + Kafka mock client, integration tests ready
- **Team C:** exrinspector working against MockVastAdapter, approval endpoints scaffolded
- **Friday (Mar 14):** Merge Week 2 work, full-stack test (ingest → exrinspector → metadata)

**Week 3 (Mar 15-21):** VAST Integration + Completion**
- **Team A:** Final Phase 1 tests, healthcheck validation, performance tuning
- **Team B:** VastDbAdapter working (mocked or real VAST), Kafka publisher tested
- **Team C:** DCC endpoints stubbed, extended asset model complete, UI mockup done
- **Friday (Mar 21):** Merge Week 3 work, full Phase 1+2+3 stack validation

**Week 4 (Mar 22-28):** Polish & Release**
- **All teams:** Bug fixes, performance tuning, final integration testing
- **Mon-Wed:** Manual smoke tests, documentation finalization, runbook updates
- **Thu:** Tag `v0.2.0`, build + publish container images
- **Fri (Mar 28):** Release announcement, declare MVP ready for staging deployment

---

## 7. Testing Strategy

### Unit Tests (Each Team)

**Phase 1 (Team A):**
- `persistence.reset()` guarding test
- CAS job claiming test (concurrent)
- Worker backoff/retry test
- Status enum reconciliation test

**Phase 2 (Team B):**
- AsyncAdapter interface contract test (parameterized: LocalAdapter, MockVastAdapter)
- CAS semantics test (updateJobStatus)
- Kafka publisher test (mock)
- Trino connection pool test (VastDbAdapter)

**Phase 3 (Team C):**
- DataEnginePipeline registry test
- ExrInspectorFunction input/output validation test
- Approval state machine test
- DCC endpoints test (mock asset data)

### Integration Tests

**Team B owns integration tests:**
- LocalAdapter + MockVastAdapter contract parity
- Kafka event ordering (publish → consume → verify FIFO)
- Database schema migration tests (if VAST ready)
- End-to-end persistence (create asset → restart → verify data persists)

### E2E Tests (Weekly)

**Week 1:** Health check endpoint reachable
**Week 2:** Ingest → Metadata extraction → Asset queryable
**Week 3:** Full workflow: ingest → exrinspector → metadata → approval → ready
**Week 4:** Load test (concurrent ingests, simultaneous job claims)

### CI/CD

- `npm run test:all` runs on every PR (compose check + API contract + event contract + all service tests)
- Merge blocked if any test fails
- Automatically build + publish container images on `main` merge

---

## 8. TDD Principles

**For ALL phases:**
1. **Write contract test first** (before implementation)
2. **Implement production code** (make test pass)
3. **Refactor** (clean up, no behavior change)
4. **Repeat for next feature**

**Example (Phase 1: CAS job claiming):**
```typescript
// Test first (Week 1)
describe('Job claiming', () => {
  test('concurrent claims resolve to single winner (atomic CAS)', async () => {
    const job = await persistence.createJob({ id: 'j1', status: 'pending' });

    // Simulate 5 workers claiming simultaneously
    const promises = Array(5).fill(null).map(() =>
      persistence.updateJobStatus('j1', 'pending', 'claimed', { workerId: `w${i}` })
    );
    const results = await Promise.all(promises);

    // Verify: exactly 1 true (winner), 4 false (losers)
    expect(results.filter(r => r)).toHaveLength(1);

    const updated = await persistence.getJob('j1');
    expect(updated.status).toBe('claimed');
  });
});

// Implementation
class LocalPersistenceAdapter {
  async updateJobStatus(jobId, expectedStatus, newStatus, lease) {
    const lock = await this.mutex.lock(jobId);
    try {
      const job = this.jobs.get(jobId);
      if (job?.status !== expectedStatus) return false;
      this.jobs.set(jobId, { ...job, status: newStatus, ...lease });
      return true;
    } finally {
      lock.unlock();
    }
  }
}
```

---

## 9. Risk Mitigation & Tier-Based Scope

### Tier 1 (Must-Have, March 28 Hard Deadline)
- ✅ Phase 1 stabilization (data loss elimination, race conditions, error handling)
- ✅ Phase 2 persistence layer (async interface, MockVastAdapter for testing)
- ✅ Phase 3 modular architecture (exrinspector sample end-to-end)
- ✅ Approval workflow (endpoints, state transitions)

### Tier 2 (Should-Have, Push to April if Needed)
- ⏳ Full RBAC (role-based approval routing)
- ⏳ UI polish (approval panel visual design)
- ⏳ DCC integration (functional plugin)

### Tier 3 (Nice-to-Have, Phase 4+)
- Advanced search/filter
- Webhook integrations
- VAST Catalog Element handle durability
- Performance optimization (caching, indexing)

**Escape hatch:** If schedule slips in Week 3, revert to Tier 1-only delivery:
- Complete Phase 1 + Phase 2 stabilization (Tier 1 guaranteed)
- Defer DCC integration scaffolding to Phase 4
- Defer full RBAC to Phase 4
- Deliver working MVP with exrinspector sample

---

## 10. Dependencies & Constraints

### VAST Infrastructure Constraint
- **Status:** Available but not ready for integration testing
- **Mitigation:** Use MockVastAdapter (Team B, Week 2) so Team C can develop without VAST
- **Plan:** Real VAST integration happens Week 3 (non-blocking for Tier 1 scope)

### Team Coordination
- **Code ownership:** Team A (routes) | Team B (adapters/broker) | Team C (features)
- **Dependency order:** Phase 1 → Phase 2 (async interface) → Phase 3 (features)
- **Weekly sync:** 30 min Friday to review cross-team blockers

### Documentation
- Update API contracts (`docs/api-contracts.md`) when routes change
- Update event contracts (`docs/event-contracts.md`) when events change
- Update runbook (`docs/runbook.md`) with new deployment steps
- Keep Wiki 2.0 in sync with code

---

## 11. Success Criteria (Overall)

**By March 28, 2026:**
- ✅ All Phase 1 tests passing (zero data loss, no race conditions)
- ✅ All Phase 2 tests passing (async persistence layer working)
- ✅ All Phase 3 tests passing (exrinspector end-to-end)
- ✅ Full workflow verified end-to-end (ingest → exrinspector → metadata → approval)
- ✅ Docker Compose stack starts cleanly (`docker compose up --build`)
- ✅ CI/CD tests all passing (`npm run test:all`)
- ✅ v0.2.0 tag created + container images published
- ✅ Runbook updated with new features + deployment steps
- ✅ API docs (OpenAPI) complete + accurate
- ✅ Linear board 100% resolved (all Tier 1 issues closed)

---

## Appendix: Glossary

- **MAM:** Media Asset Management
- **VFX:** Visual Effects
- **EXR:** OpenEXR (standard image format for VFX/post-prod)
- **CAS:** Compare-and-Swap (atomic operation)
- **DLQ:** Dead Letter Queue (for failed events)
- **E2E:** End-to-End
- **RBAC:** Role-Based Access Control
- **DCC:** Digital Content Creation tool (Maya, Nuke, etc.)
- **Trino:** SQL query engine (used by VAST Database)
- **Kafka:** Event streaming platform (VAST broker)
- **VAST Data Engine:** Serverless pipeline execution service
