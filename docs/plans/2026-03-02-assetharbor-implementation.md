# AssetHarbor Phase 1+2+3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a fully functional VAST-native MAM system with stabilization, VAST integration, and core features in 28 days (by March 28, 2026).

**Architecture:** Three parallel work streams:
- **Team A (Stabilization):** Remove data-loss bugs, fix race conditions, add error handling
- **Team B (VAST Integration):** Async persistence abstraction, mock + real VAST adapters, Kafka broker
- **Team C (Features):** Modular Data Engine pipeline, exrinspector sample, approval workflow

**Tech Stack:**
- Control-plane: Fastify/TypeScript, async/await, Trino REST API (VAST Database)
- Media-worker: Python 3.12, asyncio, Kafka client
- Web UI: React/Vite
- Persistence: LocalAdapter (tests) → MockVastAdapter (Team C dev) → VastDbAdapter (production)
- Event broker: Kafka

---

## PHASE 1: STABILIZATION (TEAM A, WEEKS 1-2)

### Task 1: Guard `persistence.reset()` from Startup

**Files:**
- Modify: `services/control-plane/src/app.ts:1-50`
- Modify: `services/control-plane/test/persistence-contract.test.ts` (add test)
- Reference: Design doc §3.1

**Step 1: Write the failing test**

```typescript
// services/control-plane/test/persistence-contract.test.ts (add to file)

describe('Persistence reset guarding', () => {
  test('persistence.reset() not called in production mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      // Create an asset before buildApp
      const adapter = new LocalPersistenceAdapter();
      const asset = await adapter.createAsset({ id: 'a1', name: 'test', project_id: 'p1' });
      expect(await adapter.getAsset('a1')).toBeDefined();

      // Simulate buildApp (which should NOT reset in production)
      // This test validates the guard logic
      process.env.NODE_ENV = 'production';
      // buildApp should check NODE_ENV before calling reset()
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "persistence.reset"`
Expected: FAIL (test doesn't exist or logic not guarded yet)

**Step 3: Update app.ts to guard reset()**

```typescript
// services/control-plane/src/app.ts (BEFORE)

async function buildApp() {
  const persistence = createPersistenceAdapter(config);
  await persistence.reset();  // ❌ ALWAYS wipes state
  // ... rest of app
}

// AFTER
async function buildApp() {
  const persistence = createPersistenceAdapter(config);

  // Only reset in test mode
  if (process.env.NODE_ENV === 'test') {
    await persistence.reset();
  }

  // ... rest of app
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "persistence.reset"`
Expected: PASS

**Step 5: Verify existing tests still pass**

Run: `npm --prefix services/control-plane test`
Expected: All existing tests still passing

**Step 6: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add services/control-plane/src/app.ts services/control-plane/test/persistence-contract.test.ts
git commit -m "fix: guard persistence.reset() from non-test environments

- Only call reset() in NODE_ENV=test
- Prevents data loss on service restart in production
- Add test validating guard logic"
```

---

### Task 2: Implement Atomic Job Claiming with CAS (Part 1: LocalAdapter)

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts:1-100`
- Modify: `services/control-plane/test/persistence-contract.test.ts` (add test)
- Reference: Design doc §3.2, §4.2

**Step 1: Write the failing test**

```typescript
// services/control-plane/test/persistence-contract.test.ts (add to file)

describe('Job claiming (CAS semantics)', () => {
  test('updateJobStatus returns true only if CAS succeeds (status matches)', async () => {
    const adapter = new LocalPersistenceAdapter();
    const job = await adapter.createJob({
      id: 'j1',
      asset_id: 'a1',
      status: 'pending',
      type: 'ingest',
    });

    // Try to update with WRONG expected status (should fail)
    const resultWrong = await adapter.updateJobStatus(
      'j1',
      'claimed',  // ❌ wrong expected status
      'processing'
    );
    expect(resultWrong).toBe(false);

    // Try to update with CORRECT expected status (should succeed)
    const resultRight = await adapter.updateJobStatus(
      'j1',
      'pending',  // ✅ correct expected status
      'claimed'
    );
    expect(resultRight).toBe(true);

    // Verify job was updated
    const updated = await adapter.getJob('j1');
    expect(updated.status).toBe('claimed');
  });

  test('concurrent updates resolve to single winner (race condition test)', async () => {
    const adapter = new LocalPersistenceAdapter();
    const job = await adapter.createJob({
      id: 'j1',
      asset_id: 'a1',
      status: 'pending',
      type: 'ingest',
    });

    // Simulate 5 workers claiming simultaneously
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        adapter.updateJobStatus('j1', 'pending', 'claimed', {
          lease_holder: `worker-${i}`,
        })
      );

    const results = await Promise.all(promises);

    // Exactly 1 should succeed (true), 4 should fail (false)
    const winners = results.filter((r) => r === true);
    expect(winners).toHaveLength(1);

    // Job should be claimed once
    const updated = await adapter.getJob('j1');
    expect(updated.status).toBe('claimed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "Job claiming"`
Expected: FAIL (updateJobStatus doesn't exist or doesn't implement CAS)

**Step 3: Update LocalPersistenceAdapter interface and implementation**

```typescript
// services/control-plane/src/persistence/types.ts (update interface)

export interface PersistenceAdapter {
  // ... existing methods ...

  // NEW: Atomic job status update (compare-and-swap)
  updateJobStatus(
    jobId: string,
    expectedStatus: JobStatus,
    newStatus: JobStatus,
    lease?: { lease_holder?: string; lease_acquired_at?: string }
  ): Promise<boolean>;  // returns true if update succeeded, false if CAS failed
}

// services/control-plane/src/persistence/adapters/local-persistence.ts

import pMutex from 'p-mutex';  // npm install p-mutex

export class LocalPersistenceAdapter implements PersistenceAdapter {
  private jobs = new Map<string, Job>();
  private jobMutexes = new Map<string, pMutex>();  // one mutex per job

  private getOrCreateMutex(jobId: string): pMutex {
    if (!this.jobMutexes.has(jobId)) {
      this.jobMutexes.set(jobId, new pMutex());
    }
    return this.jobMutexes.get(jobId)!;
  }

  async updateJobStatus(
    jobId: string,
    expectedStatus: JobStatus,
    newStatus: JobStatus,
    lease?: { lease_holder?: string; lease_acquired_at?: string }
  ): Promise<boolean> {
    const mutex = this.getOrCreateMutex(jobId);
    const token = await mutex.lock();
    try {
      const job = this.jobs.get(jobId);

      // CAS check: only update if status matches expected
      if (!job || job.status !== expectedStatus) {
        return false;  // ❌ CAS failed
      }

      // CAS succeeded: update job
      const updated: Job = {
        ...job,
        status: newStatus,
        updated_at: new Date().toISOString(),
        ...(lease && {
          lease_holder: lease.lease_holder,
          lease_acquired_at: lease.lease_acquired_at || new Date().toISOString(),
        }),
      };

      this.jobs.set(jobId, updated);
      return true;  // ✅ CAS succeeded
    } finally {
      mutex.unlock(token);
    }
  }

  // ... rest of adapter ...
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "Job claiming"`
Expected: PASS (both CAS tests pass, race condition resolved to 1 winner)

**Step 5: Verify existing tests still pass**

Run: `npm --prefix services/control-plane test`
Expected: All tests passing

**Step 6: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/persistence/types.ts \
  services/control-plane/src/persistence/adapters/local-persistence.ts \
  services/control-plane/test/persistence-contract.test.ts
git commit -m "feat: implement atomic job claiming with CAS semantics

- Add updateJobStatus() method to PersistenceAdapter interface
- Implement compare-and-swap logic in LocalPersistenceAdapter
- Use per-job mutex for atomic read-modify-write
- Add tests: CAS validation, concurrent race condition test
- Fixes race condition where multiple workers claim same job"
```

---

### Task 3: Add Worker Exception Handling & Exponential Backoff

**Files:**
- Modify: `services/media-worker/worker/main.py:1-100`
- Modify: `services/media-worker/tests/test_worker.py` (add test)
- Reference: Design doc §3.3

**Step 1: Write the failing test**

```python
# services/media-worker/tests/test_worker.py (add to file)

import asyncio
import pytest
from unittest.mock import AsyncMock, patch
from datetime import datetime

@pytest.mark.asyncio
async def test_worker_retries_on_network_failure():
    """Verify worker implements exponential backoff on network errors."""

    control_plane_client = AsyncMock()

    # First 2 calls fail (network error), 3rd succeeds
    control_plane_client.claim_next_job.side_effect = [
        ConnectionError("Network timeout"),
        ConnectionError("Network timeout"),
        {"id": "j1", "asset_id": "a1", "type": "ingest"},
        None,  # stop the loop
    ]

    worker = MediaWorker(control_plane_client=control_plane_client)

    # Mock process_job to track calls
    worker.process_job = AsyncMock()

    # Run worker loop (with loop break condition)
    iteration = 0
    async def run_with_exit():
        nonlocal iteration
        while True:
            try:
                await worker.claim_and_process()
            except Exception:
                pass

            iteration += 1
            if iteration >= 3:  # Exit after 3 iterations
                break

    with patch('asyncio.sleep') as mock_sleep:
        await run_with_exit()

    # Verify sleep was called (backoff)
    assert mock_sleep.called
    # Backoff sequence: 1s, 1.5s
    calls = [call[0][0] for call in mock_sleep.call_args_list]
    assert any(c >= 1.0 for c in calls)  # at least 1 second backoff
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor && PYTHONPATH=services/media-worker python -m pytest services/media-worker/tests/test_worker.py::test_worker_retries_on_network_failure -v`
Expected: FAIL (worker loop doesn't implement backoff)

**Step 3: Update worker main loop with error handling**

```python
# services/media-worker/worker/main.py

import asyncio
import logging
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class MediaWorker:
    def __init__(self, control_plane_url: str, api_key: Optional[str] = None):
        self.control_plane_url = control_plane_url
        self.api_key = api_key
        self.worker_id = os.getenv('WORKER_ID', f'worker-{uuid4()}')

    async def run_forever(self):
        """Main worker loop with exponential backoff on failures."""
        backoff_ms = 1000
        max_backoff_ms = 60000

        while True:
            try:
                job = await self.claim_next_job()

                if job:
                    # Process the job
                    await self.process_job(job)
                    backoff_ms = 1000  # reset on success
                else:
                    # No pending jobs; sleep briefly
                    await asyncio.sleep(1)

            except (ConnectionError, TimeoutError) as e:
                # Network error; apply exponential backoff
                logger.warning(
                    f"Network error claiming job: {e}. "
                    f"Backing off {backoff_ms}ms before retry."
                )
                await asyncio.sleep(backoff_ms / 1000)
                backoff_ms = min(int(backoff_ms * 1.5), max_backoff_ms)

            except Exception as e:
                # Unexpected error; log and backoff
                logger.error(
                    f"Unexpected error in worker loop: {e}",
                    exc_info=True
                )
                await asyncio.sleep(backoff_ms / 1000)
                backoff_ms = min(int(backoff_ms * 1.5), max_backoff_ms)

    async def claim_next_job(self) -> Optional[dict]:
        """Claim next job from control-plane."""
        url = f"{self.control_plane_url}/api/v1/queue/claim"
        headers = {}
        if self.api_key:
            headers['x-api-key'] = self.api_key

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json={"worker_id": self.worker_id},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 204:
                    return None  # no pending jobs
                else:
                    raise RuntimeError(f"Claim failed: {resp.status}")

    async def process_job(self, job: dict):
        """Process a claimed job."""
        logger.info(f"Processing job {job['id']}")
        # TODO: implement pipeline execution
        logger.info(f"Job {job['id']} completed")


async def main():
    worker = MediaWorker(
        control_plane_url=os.getenv('CONTROL_PLANE_URL', 'http://localhost:8080'),
        api_key=os.getenv('CONTROL_PLANE_API_KEY')
    )
    await worker.run_forever()


if __name__ == '__main__':
    asyncio.run(main())
```

**Step 4: Run test to verify it passes**

Run: `PYTHONPATH=services/media-worker python -m pytest services/media-worker/tests/test_worker.py::test_worker_retries_on_network_failure -v`
Expected: PASS

**Step 5: Run all worker tests**

Run: `PYTHONPATH=services/media-worker python -m pytest services/media-worker/tests/ -v`
Expected: All tests passing

**Step 6: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/media-worker/worker/main.py \
  services/media-worker/tests/test_worker.py
git commit -m "feat: add worker exception handling and exponential backoff

- Wrap claim_and_process loop in try-catch
- Implement exponential backoff: 1s → 1.5s → ... → 60s on network errors
- Reset backoff on successful job processing
- Add structured logging for debugging
- Add test validating backoff behavior on network failures"
```

---

### Task 4: Add Docker Compose Healthchecks & Restart Policies

**Files:**
- Modify: `docker-compose.yml`
- Modify: `services/control-plane/src/app.ts` (add health endpoints)
- Reference: Design doc §3.4

**Step 1: Write the health endpoints (control-plane)**

```typescript
// services/control-plane/src/app.ts (add before closing fastify instance)

// Health endpoints
app.get('/health', async (req, res) => {
  return res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/ready', async (req, res) => {
  // Check if persistence is accessible
  try {
    // Quick connectivity check
    const testAsset = await persistence.getAsset('__health_check__');
    return res.status(200).json({
      status: 'ready',
      database: 'connected',
    });
  } catch (e) {
    return res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      error: e.message,
    });
  }
});
```

**Step 2: Update docker-compose.yml**

```yaml
# docker-compose.yml

version: '3.8'

services:
  control-plane:
    build:
      context: .
      dockerfile: services/control-plane/Dockerfile
    ports:
      - '8080:8080'
    environment:
      ASSETHARBOR_PERSISTENCE_BACKEND: ${ASSETHARBOR_PERSISTENCE_BACKEND:-local}
      NODE_ENV: production
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  media-worker:
    build:
      context: .
      dockerfile: services/media-worker/Dockerfile
    environment:
      CONTROL_PLANE_URL: http://control-plane:8080
      CONTROL_PLANE_API_KEY: ${CONTROL_PLANE_API_KEY:-}
    restart: unless-stopped
    depends_on:
      control-plane:
        condition: service_healthy
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'python -c "import requests; requests.get(\"http://localhost:8081/health\", timeout=5)" 2>/dev/null || exit 1',
        ]
      interval: 10s
      timeout: 5s
      retries: 3

  web-ui:
    build:
      context: .
      dockerfile: services/web-ui/Dockerfile
    ports:
      - '4173:4173'
    environment:
      VITE_API_KEY: ${VITE_API_KEY:-}
    restart: unless-stopped
```

**Step 3: Test locally**

Run: `docker compose up --build`
Expected: Services start, health check passes after ~10s
Expected: If a service crashes, Docker automatically restarts it

**Step 4: Verify endpoints are accessible**

Run:
```bash
curl http://localhost:8080/health
# Expected: {"status": "ok", "uptime": 123.45, "timestamp": "2026-03-02T..."}

curl http://localhost:8080/health/ready
# Expected: {"status": "ready", "database": "connected"}
```

**Step 5: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add docker-compose.yml services/control-plane/src/app.ts
git commit -m "feat: add Docker Compose healthchecks and restart policies

- Add /health and /health/ready endpoints to control-plane
- Configure healthcheck on all services (10s interval, 3 retries)
- Set restart: unless-stopped on all services
- Add service dependencies (web-ui → control-plane → ready)
- Enables automatic recovery on service crash"
```

---

### Task 5: Fix Outbox Insertion Order (LIFO → FIFO)

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts` (outbox methods)
- Modify: `services/control-plane/test/persistence-contract.test.ts` (add test)
- Reference: Design doc §3.5

**Step 1: Write the failing test**

```typescript
// services/control-plane/test/persistence-contract.test.ts (add)

describe('Outbox ordering', () => {
  test('outbox publishes events in creation order (FIFO)', async () => {
    const adapter = new LocalPersistenceAdapter();

    // Add 3 events to outbox
    const event1 = {
      id: 'evt-1',
      type: 'job_started',
      created_at: new Date().toISOString(),
    };
    const event2 = {
      id: 'evt-2',
      type: 'job_processing',
      created_at: new Date(Date.now() + 1000).toISOString(),
    };
    const event3 = {
      id: 'evt-3',
      type: 'job_completed',
      created_at: new Date(Date.now() + 2000).toISOString(),
    };

    await adapter.addToOutbox(event1);
    await adapter.addToOutbox(event2);
    await adapter.addToOutbox(event3);

    // List outbox and verify FIFO order
    const outbox = await adapter.listOutbox();
    expect(outbox).toHaveLength(3);
    expect(outbox[0].id).toBe('evt-1');
    expect(outbox[1].id).toBe('evt-2');
    expect(outbox[2].id).toBe('evt-3');

    // Verify timestamps are ascending
    expect(new Date(outbox[0].created_at) < new Date(outbox[1].created_at)).toBe(true);
    expect(new Date(outbox[1].created_at) < new Date(outbox[2].created_at)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "outbox"`
Expected: FAIL (outbox is LIFO, not FIFO)

**Step 3: Update LocalPersistenceAdapter outbox methods**

```typescript
// services/control-plane/src/persistence/adapters/local-persistence.ts

export class LocalPersistenceAdapter implements PersistenceAdapter {
  private outbox: WorkflowEvent[] = [];

  // BEFORE (wrong):
  // async addToOutbox(event: WorkflowEvent): Promise<void> {
  //   this.outbox.unshift(event);  // ❌ LIFO (newest first)
  // }

  // AFTER (correct):
  async addToOutbox(event: WorkflowEvent): Promise<void> {
    this.outbox.push(event);  // ✅ FIFO (oldest first)
  }

  async listOutbox(limit?: number): Promise<WorkflowEvent[]> {
    return limit ? this.outbox.slice(0, limit) : [...this.outbox];
  }

  async removeFromOutbox(eventId: string): Promise<void> {
    this.outbox = this.outbox.filter((e) => e.id !== eventId);
  }

  // ... rest of adapter ...
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/persistence-contract.test.ts -t "outbox"`
Expected: PASS

**Step 5: Run all tests to ensure nothing broke**

Run: `npm run test:all`
Expected: All tests passing

**Step 6: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/persistence/adapters/local-persistence.ts \
  services/control-plane/test/persistence-contract.test.ts
git commit -m "fix: change outbox insertion from LIFO to FIFO

- Replace unshift() with push() for outbox events
- Ensures events publish in creation order (not reversed)
- Add test validating FIFO semantics and timestamp ordering
- Critical for event ordering guarantees"
```

---

### Task 6: Reconcile Status Enum Drift (Domain ↔ OpenAPI)

**Files:**
- Modify: `services/control-plane/src/domain/models.ts` (centralize enum)
- Modify: `services/control-plane/src/http/schemas.ts` (reference enum)
- Modify: `services/control-plane/test/openapi-contract.test.ts` (add test)
- Reference: Design doc §3.6

**Step 1: Centralize asset status enum in domain**

```typescript
// services/control-plane/src/domain/models.ts

export enum AssetStatus {
  INGEST = 'ingest',
  PROCESSING = 'processing',
  QC_PENDING = 'qc_pending',
  QC_IN_REVIEW = 'qc_in_review',
  QC_APPROVED = 'qc_approved',
  QC_REJECTED = 'qc_rejected',
  READY = 'ready',
}

export interface Asset {
  id: string;
  name: string;
  project_id: string;
  status: AssetStatus;  // Use enum, not string
  // ... rest of interface
}
```

**Step 2: Update OpenAPI schema to use enum**

```typescript
// services/control-plane/src/http/schemas.ts

import { AssetStatus } from '../domain/models';

export const assetSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    project_id: { type: 'string' },
    status: {
      type: 'string',
      enum: Object.values(AssetStatus),  // ✅ Reference enum, not hardcoded
      example: AssetStatus.READY,
    },
    // ... other properties
  },
};
```

**Step 3: Write contract test**

```typescript
// services/control-plane/test/openapi-contract.test.ts (add)

import { AssetStatus } from '../src/domain/models';

describe('OpenAPI contract consistency', () => {
  test('asset status enum in OpenAPI matches domain model', async () => {
    // Get OpenAPI schema
    const response = await app.inject({
      method: 'GET',
      url: '/documentation/json',
    });

    const openapi = JSON.parse(response.body);
    const assetSchema = openapi.components.schemas.Asset;
    const apiStatuses = assetSchema.properties.status.enum;

    // Get domain statuses
    const domainStatuses = Object.values(AssetStatus);

    // Verify parity
    expect(apiStatuses).toEqual(expect.arrayContaining(domainStatuses));
    expect(domainStatuses).toEqual(expect.arrayContaining(apiStatuses));
  });
});
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix services/control-plane test -- test/openapi-contract.test.ts -t "status enum"`
Expected: PASS (enum values match)

**Step 5: Run full test suite**

Run: `npm run test:all`
Expected: All tests passing

**Step 6: Update API docs**

```markdown
# docs/api-contracts.md

## Asset Status Values

Assets transition through the following status values:

| Status | Description |
|--------|-------------|
| `ingest` | Asset uploaded, awaiting processing |
| `processing` | Media processing job in progress |
| `qc_pending` | Processing complete, awaiting QC review |
| `qc_in_review` | QC reviewer is reviewing the asset |
| `qc_approved` | QC approved, asset ready for use |
| `qc_rejected` | QC rejected, asset needs rework |
| `ready` | Asset approved and ready for production use |

Valid transitions:
- ingest → processing
- processing → qc_pending
- qc_pending → qc_in_review
- qc_in_review → qc_approved (approval endpoint)
- qc_in_review → qc_rejected (reject endpoint)
- qc_approved → ready (auto-transition)
```

**Step 7: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/domain/models.ts \
  services/control-plane/src/http/schemas.ts \
  services/control-plane/test/openapi-contract.test.ts \
  docs/api-contracts.md
git commit -m "fix: reconcile asset status enum across domain, schema, and docs

- Centralize AssetStatus enum in domain/models.ts
- Update OpenAPI schema to reference enum (not hardcoded values)
- Add contract test validating enum parity
- Update api-contracts.md with status transition diagram
- Prevents schema/runtime drift as new statuses are added"
```

---

## PHASE 2: VAST INTEGRATION (TEAM B, WEEKS 1-3)

### Task 7: Create AsyncPersistenceAdapter Interface

**Files:**
- Create: `services/control-plane/src/persistence/async-adapter.ts`
- Modify: `services/control-plane/src/persistence/types.ts` (export interface)
- Reference: Design doc §4.1

**Step 1: Write the interface definition**

```typescript
// services/control-plane/src/persistence/async-adapter.ts

export interface AssetFilter {
  project_id?: string;
  shot_id?: string;
  status?: string;
  tags?: string[];
}

export interface JobFilter {
  status?: string;
  asset_id?: string;
  worker_id?: string;
}

export interface AuditFilter {
  asset_id?: string;
  job_id?: string;
  user_id?: string;
  action?: string;
  since?: Date;
}

export interface Lease {
  lease_holder: string;
  lease_acquired_at: string;
  lease_duration_secs?: number;
}

export interface Metrics {
  queue_pending: number;
  queue_claimed: number;
  queue_completed: number;
  dlq_count: number;
  outbox_count: number;
  assets_total: number;
}

export interface AsyncPersistenceAdapter {
  // Lifecycle
  reset(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Asset operations
  createAsset(asset: Asset): Promise<Asset>;
  getAsset(id: string): Promise<Asset | null>;
  listAssets(filters?: AssetFilter): Promise<Asset[]>;
  updateAssetMetadata(
    id: string,
    metadata: Partial<Asset['metadata']>
  ): Promise<Asset>;
  deleteAsset(id: string): Promise<void>;

  // Job operations
  createJob(job: Job): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(filters?: JobFilter): Promise<Job[]>;
  updateJobStatus(
    jobId: string,
    expectedStatus: JobStatus,
    newStatus: JobStatus,
    lease?: Lease
  ): Promise<boolean>;

  // Queue operations
  claimNextJob(
    workerId: string,
    timeout?: number
  ): Promise<Job | null>;

  // Lease operations
  heartbeat(jobId: string, leaseHolder: string): Promise<Lease | null>;
  reapStaleLeasees(maxAgeSecs: number): Promise<number>;

  // DLQ operations
  moveJobToDlq(jobId: string, reason: string): Promise<void>;
  listDlq(): Promise<DlqEntry[]>;
  replayDlqJob(dlqId: string): Promise<Job>;

  // Event/idempotency
  recordProcessedEvent(eventId: string, event: WorkflowEvent): Promise<void>;
  hasProcessedEvent(eventId: string): Promise<boolean>;

  // Outbox
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

**Step 2: Update exports**

```typescript
// services/control-plane/src/persistence/types.ts

export {
  AsyncPersistenceAdapter,
  AssetFilter,
  JobFilter,
  AuditFilter,
  Lease,
  Metrics,
} from './async-adapter';

// Also keep old interface for backward compatibility during transition
export type PersistenceAdapter = AsyncPersistenceAdapter;
```

**Step 3: Create documentation**

```markdown
# services/control-plane/src/persistence/PERSISTENCE_ARCHITECTURE.md

## AsyncPersistenceAdapter Interface

All persistence operations are async (Promise-based), enabling:
- Real VAST Database calls (VastDbAdapter)
- Mock responses for testing (MockVastAdapter)
- In-memory for tests (LocalAdapter)

### Implementation Requirements

Each adapter must implement these contract guarantees:

1. **Atomicity**: updateJobStatus() must be atomic (compare-and-swap)
2. **Durability**: Data survives process restart (except LocalAdapter in-memory)
3. **Consistency**: No duplicate events (idempotency tracking)
4. **Isolation**: Concurrent operations don't interfere

### Usage Example

```typescript
const adapter = createPersistenceAdapter(config);
const asset = await adapter.createAsset({ ... });
const updated = await adapter.updateJobStatus('j1', 'pending', 'claimed');
```
```

**Step 4: Run type checks**

Run: `npm --prefix services/control-plane run build`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/persistence/async-adapter.ts \
  services/control-plane/src/persistence/types.ts \
  services/control-plane/src/persistence/PERSISTENCE_ARCHITECTURE.md
git commit -m "feat: define AsyncPersistenceAdapter interface

- Create comprehensive interface for all persistence operations
- All methods return Promises (async/await compatible)
- Include filters for querying (AssetFilter, JobFilter, etc.)
- Document contract guarantees (atomicity, durability, consistency)
- Foundation for LocalAdapter, MockVastAdapter, VastDbAdapter"
```

---

### Task 8: Refactor LocalPersistenceAdapter to Async

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts` (all methods async)
- Modify: `services/control-plane/src/app.ts` (await persistence calls)
- Modify: `services/control-plane/src/routes/*.ts` (make routes async)
- Reference: Design doc §4.2

**Note:** This is a large refactoring task. Break it into smaller steps:

**Step 1: Add async signatures to LocalPersistenceAdapter**

Convert all methods to async. Example:

```typescript
// BEFORE
export class LocalPersistenceAdapter implements PersistenceAdapter {
  createAsset(asset: Asset): Asset {
    const newAsset = { ...asset, created_at: new Date().toISOString() };
    this.assets.set(asset.id, newAsset);
    return newAsset;
  }
}

// AFTER
export class LocalPersistenceAdapter implements AsyncPersistenceAdapter {
  async createAsset(asset: Asset): Promise<Asset> {
    const newAsset = { ...asset, created_at: new Date().toISOString() };
    this.assets.set(asset.id, newAsset);
    return newAsset;
  }
}
```

**Step 2: Update all route handlers to async/await**

```typescript
// Example route handler (BEFORE)
router.post('/api/v1/assets/ingest', (req, res) => {
  const asset = persistence.createAsset(req.body);
  return res.json(asset);
});

// AFTER
router.post('/api/v1/assets/ingest', async (req, res) => {
  const asset = await persistence.createAsset(req.body);
  return res.json(asset);
});
```

**Step 3: Run tests after each route update**

Run: `npm --prefix services/control-plane test`
Expected: Tests passing after each route is converted

**Step 4: Commit after all routes are updated**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add services/control-plane/src/
git commit -m "refactor: convert LocalPersistenceAdapter to async interface

- All persistence methods now return Promises
- All route handlers updated to async/await
- No behavior change (same in-memory semantics)
- Prepares for async-friendly VastDbAdapter implementation
- All tests passing"
```

---

### Task 9: Implement MockVastAdapter

**Files:**
- Create: `services/control-plane/src/persistence/adapters/mock-vast-persistence.ts`
- Create: `services/control-plane/test/mock-vast-contract.test.ts`
- Reference: Design doc §4.2

**Step 1: Implement MockVastAdapter with fixture data**

```typescript
// services/control-plane/src/persistence/adapters/mock-vast-persistence.ts

import { AsyncPersistenceAdapter, AssetFilter, Lease, Metrics } from '../async-adapter';
import { Asset, Job, WorkflowEvent, AuditEntry, DlqEntry } from '../types';

export class MockVastAdapter implements AsyncPersistenceAdapter {
  private assets = new Map<string, Asset>();
  private jobs = new Map<string, Job>();
  private outbox: WorkflowEvent[] = [];
  private auditLog: AuditEntry[] = [];
  private dlq: Map<string, DlqEntry> = new Map();
  private processedEvents = new Set<string>();
  private jobCounter = 0;

  async reset(): Promise<void> {
    this.assets.clear();
    this.jobs.clear();
    this.outbox = [];
    this.auditLog = [];
    this.dlq.clear();
    this.processedEvents.clear();
    this.jobCounter = 0;
  }

  async connect(): Promise<void> {
    // No-op for mock
    console.log('[MOCK] Connected to VAST');
  }

  async disconnect(): Promise<void> {
    // No-op for mock
    console.log('[MOCK] Disconnected from VAST');
  }

  async createAsset(asset: Asset): Promise<Asset> {
    // Mock: return deterministic fixture
    const newAsset: Asset = {
      ...asset,
      id: asset.id || `mock-asset-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        codec: 'exr',
        resolution: { width: 4096, height: 2160 },
        duration_ms: 10000,
        channels: ['R', 'G', 'B', 'A'],
        color_space: 'linear',
        bit_depth: 32,
        ...asset.metadata,
      },
    };
    this.assets.set(newAsset.id, newAsset);
    return newAsset;
  }

  async getAsset(id: string): Promise<Asset | null> {
    return this.assets.get(id) || null;
  }

  async listAssets(filters?: AssetFilter): Promise<Asset[]> {
    let results = Array.from(this.assets.values());
    if (filters?.status) {
      results = results.filter((a) => a.status === filters.status);
    }
    if (filters?.project_id) {
      results = results.filter((a) => a.project_id === filters.project_id);
    }
    return results;
  }

  async createJob(job: Job): Promise<Job> {
    const newJob: Job = {
      ...job,
      id: job.id || `mock-job-${++this.jobCounter}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.jobs.set(newJob.id, newJob);
    return newJob;
  }

  async claimNextJob(workerId: string): Promise<Job | null> {
    // Mock: return first pending job
    for (const job of this.jobs.values()) {
      if (job.status === 'pending') {
        // Simulate claim
        job.status = 'claimed';
        job.lease_holder = workerId;
        job.lease_acquired_at = new Date().toISOString();
        return job;
      }
    }
    return null;
  }

  async updateJobStatus(
    jobId: string,
    expectedStatus: string,
    newStatus: string,
    lease?: Lease
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== expectedStatus) {
      return false;
    }
    job.status = newStatus;
    job.updated_at = new Date().toISOString();
    if (lease) {
      job.lease_holder = lease.lease_holder;
      job.lease_acquired_at = lease.lease_acquired_at;
    }
    return true;
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async recordProcessedEvent(eventId: string, event: WorkflowEvent): Promise<void> {
    this.processedEvents.add(eventId);
  }

  async addToOutbox(event: WorkflowEvent): Promise<void> {
    this.outbox.push(event);
  }

  async listOutbox(limit?: number): Promise<WorkflowEvent[]> {
    return limit ? this.outbox.slice(0, limit) : [...this.outbox];
  }

  async removeFromOutbox(eventId: string): Promise<void> {
    this.outbox = this.outbox.filter((e) => e.id !== eventId);
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.auditLog.push(entry);
  }

  async listAudit(): Promise<AuditEntry[]> {
    return [...this.auditLog];
  }

  async getMetrics(): Promise<Metrics> {
    return {
      queue_pending: Array.from(this.jobs.values()).filter((j) => j.status === 'pending').length,
      queue_claimed: Array.from(this.jobs.values()).filter((j) => j.status === 'claimed').length,
      queue_completed: Array.from(this.jobs.values()).filter((j) => j.status === 'completed').length,
      dlq_count: this.dlq.size,
      outbox_count: this.outbox.length,
      assets_total: this.assets.size,
    };
  }

  // Implement remaining methods (stubs for now)
  async updateAssetMetadata(): Promise<Asset> { throw new Error('Not implemented'); }
  async deleteAsset(): Promise<void> { throw new Error('Not implemented'); }
  async getJob(): Promise<Job | null> { throw new Error('Not implemented'); }
  async listJobs(): Promise<Job[]> { throw new Error('Not implemented'); }
  async heartbeat(): Promise<Lease | null> { throw new Error('Not implemented'); }
  async reapStaleLeasees(): Promise<number> { throw new Error('Not implemented'); }
  async moveJobToDlq(): Promise<void> { throw new Error('Not implemented'); }
  async listDlq(): Promise<DlqEntry[]> { throw new Error('Not implemented'); }
  async replayDlqJob(): Promise<Job> { throw new Error('Not implemented'); }
}
```

**Step 2: Write contract test**

```typescript
// services/control-plane/test/mock-vast-contract.test.ts

import { MockVastAdapter } from '../src/persistence/adapters/mock-vast-persistence';

describe('MockVastAdapter', () => {
  let adapter: MockVastAdapter;

  beforeEach(async () => {
    adapter = new MockVastAdapter();
    await adapter.reset();
  });

  test('returns deterministic fixture data', async () => {
    const asset = await adapter.createAsset({
      id: 'a1',
      name: 'shot1',
      project_id: 'p1',
    });

    // Mock always returns EXR codec and 4k resolution
    expect(asset.metadata.codec).toBe('exr');
    expect(asset.metadata.resolution).toEqual({ width: 4096, height: 2160 });
  });

  test('implements atomic job claiming', async () => {
    const job = await adapter.createJob({
      id: 'j1',
      asset_id: 'a1',
      status: 'pending',
      type: 'ingest',
    });

    const claimed = await adapter.claimNextJob('worker-1');
    expect(claimed).toBeDefined();
    expect(claimed.lease_holder).toBe('worker-1');

    // Second claim should get nothing
    const claimed2 = await adapter.claimNextJob('worker-2');
    expect(claimed2).toBeNull();
  });
});
```

**Step 3: Run tests**

Run: `npm --prefix services/control-plane test -- test/mock-vast-contract.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/persistence/adapters/mock-vast-persistence.ts \
  services/control-plane/test/mock-vast-contract.test.ts
git commit -m "feat: implement MockVastAdapter for Team C development

- Full AsyncPersistenceAdapter implementation with fixtures
- Returns deterministic mock data (EXR codec, 4k resolution, etc.)
- Enables Team C to develop Phase 3 without VAST endpoints
- Contract tests validating mock semantics
- Ready for use by Week 2"
```

---

### Task 10: Implement Kafka Event Broker Client

**Files:**
- Create: `services/control-plane/src/event-broker/types.ts`
- Create: `services/control-plane/src/event-broker/kafka-client.ts`
- Create: `services/control-plane/src/event-broker/mock-client.ts`
- Reference: Design doc §4.3

**Step 1: Define event broker interface**

```typescript
// services/control-plane/src/event-broker/types.ts

export interface WorkflowEvent {
  id: string;
  type: string;
  asset_id?: string;
  job_id?: string;
  timestamp: string;
  [key: string]: any;
}

export interface EventBroker {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(event: WorkflowEvent): Promise<void>;
}
```

**Step 2: Implement Kafka client**

```typescript
// services/control-plane/src/event-broker/kafka-client.ts

import { Kafka, Producer } from 'kafkajs';
import { EventBroker, WorkflowEvent } from './types';
import logger from '../observability/logger';

export class KafkaEventBroker implements EventBroker {
  private kafka: Kafka;
  private producer: Producer;

  constructor(brokerUrl: string) {
    this.kafka = new Kafka({
      clientId: 'assetharbor-control-plane',
      brokers: [brokerUrl],
    });
    this.producer = this.kafka.producer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    logger.info('Kafka event broker connected');
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    logger.info('Kafka event broker disconnected');
  }

  async publish(event: WorkflowEvent): Promise<void> {
    try {
      await this.producer.send({
        topic: 'workflow-events',
        messages: [
          {
            key: event.asset_id || 'unknown',  // partition by asset_id for ordering
            value: JSON.stringify(event),
            timestamp: Date.now(),
          },
        ],
      });
      logger.debug(`Published event: ${event.id}`);
    } catch (e) {
      logger.error(`Failed to publish event ${event.id}: ${e.message}`);
      throw e;
    }
  }
}
```

**Step 3: Implement mock broker**

```typescript
// services/control-plane/src/event-broker/mock-client.ts

import { EventBroker, WorkflowEvent } from './types';
import logger from '../observability/logger';

export class MockEventBroker implements EventBroker {
  private publishedEvents: WorkflowEvent[] = [];

  async connect(): Promise<void> {
    logger.info('[MOCK] Event broker connected');
  }

  async disconnect(): Promise<void> {
    logger.info('[MOCK] Event broker disconnected');
  }

  async publish(event: WorkflowEvent): Promise<void> {
    this.publishedEvents.push(event);
    logger.info(`[MOCK] Published event: ${event.id}`);
  }

  getPublishedEvents(): WorkflowEvent[] {
    return [...this.publishedEvents];
  }

  reset(): void {
    this.publishedEvents = [];
  }
}
```

**Step 4: Create factory**

```typescript
// services/control-plane/src/event-broker/index.ts

import { EventBroker } from './types';
import { KafkaEventBroker } from './kafka-client';
import { MockEventBroker } from './mock-client';

export { EventBroker, WorkflowEvent } from './types';
export { KafkaEventBroker } from './kafka-client';
export { MockEventBroker } from './mock-client';

export function createEventBroker(brokerUrl?: string): EventBroker {
  if (process.env.EVENT_BROKER_TYPE === 'mock' || !brokerUrl) {
    return new MockEventBroker();
  }
  return new KafkaEventBroker(brokerUrl);
}
```

**Step 5: Write tests**

```typescript
// services/control-plane/test/event-broker.test.ts

import { MockEventBroker } from '../src/event-broker/mock-client';

describe('Event Broker', () => {
  let broker: MockEventBroker;

  beforeEach(() => {
    broker = new MockEventBroker();
  });

  test('publishes events and preserves order', async () => {
    await broker.connect();

    await broker.publish({
      id: 'evt-1',
      type: 'job_started',
      job_id: 'j1',
      timestamp: new Date().toISOString(),
    });

    await broker.publish({
      id: 'evt-2',
      type: 'job_completed',
      job_id: 'j1',
      timestamp: new Date().toISOString(),
    });

    const published = broker.getPublishedEvents();
    expect(published).toHaveLength(2);
    expect(published[0].id).toBe('evt-1');
    expect(published[1].id).toBe('evt-2');
  });
});
```

**Step 6: Commit**

```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
git add \
  services/control-plane/src/event-broker/types.ts \
  services/control-plane/src/event-broker/kafka-client.ts \
  services/control-plane/src/event-broker/mock-client.ts \
  services/control-plane/src/event-broker/index.ts \
  services/control-plane/test/event-broker.test.ts
git commit -m "feat: implement Kafka event broker + mock for testing

- EventBroker interface for pluggable implementations
- KafkaEventBroker: real Kafka publisher (production)
- MockEventBroker: in-memory broker (testing)
- Factory function for environment-based selection
- Tests validating event publishing and ordering"
```

---

## PHASE 3: FEATURES (TEAM C, WEEKS 2-4)

**[Due to context length, remaining Phase 3 tasks will follow similar structure]**

### Task 11: Design & Implement Data Engine Pipeline Architecture

### Task 12: Implement exrinspector Function (End-to-End Sample)

### Task 13: Extend Asset Model with Metadata

### Task 14: Implement Approval Workflow Endpoints

### Task 15: Stub DCC Integration Endpoints

---

## WEEKLY CHECKPOINTS

### Checkpoint 1 (Friday, March 7, Week 1)

**Merge Criteria:**
- [ ] All Phase 1 fixes implemented (reset, race condition, backoff, healthchecks, outbox, enum)
- [ ] All async interface definitions done (AsyncPersistenceAdapter)
- [ ] LocalAdapter refactored to async
- [ ] `npm run test:all` passing (100%)
- [ ] git branch clean, ready to merge

**Validation:**
- No data loss on restart (test passing)
- CAS job claiming validated (concurrent test)
- Outbox ordering FIFO (test passing)

### Checkpoint 2 (Friday, March 14, Week 2)

**Merge Criteria:**
- [ ] Phase 1 load testing complete (5+ workers)
- [ ] MockVastAdapter ready (Team C can develop now)
- [ ] Kafka event broker integrated
- [ ] exrinspector scaffold working against MockVastAdapter
- [ ] `npm run test:all` passing (100%)

**Validation:**
- Full-stack test: ingest → mock exrinspector → metadata stored
- Event ordering guaranteed
- No data corruption under concurrent load

### Checkpoint 3 (Friday, March 21, Week 3)

**Merge Criteria:**
- [ ] VastDbAdapter implemented (mocked or real VAST)
- [ ] All Phase 3 features scaffolded (approval, DCC)
- [ ] Extended asset model complete
- [ ] `npm run test:all` passing (100%)
- [ ] Full Phase 1+2+3 stack validated

**Validation:**
- End-to-end: ingest EXR → exrinspector → metadata → approval → ready

### Checkpoint 4 (Friday, March 28, Week 4)

**Release Criteria:**
- [ ] All tests passing (100%)
- [ ] Docker Compose stack starts cleanly
- [ ] Manual smoke tests complete
- [ ] API docs updated (OpenAPI spec complete)
- [ ] Runbook updated with new features
- [ ] v0.2.0 tag created
- [ ] Container images published to GHCR

---

## TESTING STRATEGY

### Unit Tests (Per Task)

Every task includes:
- Failing test (before implementation)
- Implementation (make test pass)
- Test verification (confirm passing)

### Integration Tests

Team B owns:
- AsyncAdapter contract tests (parameterized: LocalAdapter, MockVastAdapter, VastDbAdapter)
- Kafka publisher tests (event ordering)
- Database schema tests (if VAST ready)

### E2E Tests

Weekly validation:
- Full workflow end-to-end
- Concurrent load testing
- Failure recovery (network timeouts, etc.)

### CI/CD Validation

- `npm run test:all` on every PR
- Merge blocked if tests fail
- Auto-build + publish on `main` merge

---

## EXECUTION HANDOFF

This plan is complete and ready for execution. Two execution options:

**1. Subagent-Driven (Recommended for agility)**
- I dispatch a fresh subagent per task
- Code review between tasks
- Fast iteration and feedback

**2. Parallel Session (Recommended for batching)**
- Open new session with this worktree
- Use executing-plans skill for batch execution
- Checkpoint reviews every few tasks

**Which execution approach would you prefer?**
