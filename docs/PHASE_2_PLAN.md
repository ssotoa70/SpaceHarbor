# Phase 2: VAST Integration - Implementation Plan

**Status:** Ready to begin
**Duration:** 2-4 weeks
**Principle:** Test-Driven Development (TDD) - Tests first, always

---

## Phase 2 Objectives

1. ✅ Convert persistence interface to async (`Promise<T>`)
2. ✅ Implement VAST Database adapter (Trino REST API)
3. ✅ Replace in-memory job claiming with atomic VAST operations
4. ✅ Replace HTTP outbox with Kafka Event Broker
5. ✅ Full integration tests with VAST endpoints

**Goal:** Replace all in-memory state with durable VAST storage

---

## Architecture: In-Memory → VAST

### Current (Phase 1)
```
┌─────────────────────────────────┐
│  Control-Plane (Fastify)        │
│                                 │
│  PersistenceAdapter (sync)      │
│  ├─ LocalPersistenceAdapter    │  ← In-memory Maps
│  │   ├─ jobs: Map<string, Job> │
│  │   ├─ queue: Map<string, Queue>
│  │   ├─ dlq: Array<DlqItem>    │
│  │   └─ outbox: Array<Event>   │
│  │                              │
│  └─ VastPersistenceAdapter     │  ← Stub (delegates to local)
│      └─ localFallback          │
└─────────────────────────────────┘
```

### Target (Phase 2)
```
┌──────────────────────────────────────────────┐
│     Control-Plane (Fastify)                  │
│                                              │
│  async PersistenceAdapter (Promise<T>)      │
│  ├─ LocalPersistenceAdapter                 │  For testing
│  │   └─ In-memory (same as Phase 1)         │
│  │                                           │
│  └─ VastPersistenceAdapter ─────────┐       │
│      ├─ VAST Database (async) ─────┐│       │
│      │  ├─ assets table             ││       │
│      │  ├─ workflow_jobs table      ││       │
│      │  ├─ queue view               ││       │
│      │  └─ dlq_items table          ││       │
│      │                               ││       │
│      └─ VAST Event Broker (async) ──┘│       │
│         └─ Publish outbox events    │        │
│            (Kafka-compatible)       │        │
│                                    │         │
└────────────────────────────────────┼─────────┘
                                     │
                                    ▼
                          ┌──────────────────┐
                          │ VAST Platform    │
                          │ ├─ Database      │
                          │ ├─ Event Broker  │
                          │ ├─ DataEngine    │
                          │ └─ Catalog       │
                          └──────────────────┘
```

---

## Task Breakdown (TDD Approach)

### Epic 1: Async Interface Redesign

**Why First:** All other work depends on async signatures.

#### Task 1.1: Update PersistenceAdapter Interface
**TDD Workflow:**
1. Write test that calls `await adapter.claimNextJob(...)`
2. See test fail (interface not async)
3. Update interface to return `Promise<T>`
4. Update all route handlers to use `await`
5. All tests pass

**Files to Change:**
- `src/persistence/types.ts` - Interface signatures
- `src/routes/*.ts` - All route handlers (add `await`)
- `src/app.ts` - HTTP hook async handling
- `src/events/processor.ts` - Event processing

**Test Strategy:**
```typescript
// test/interface-async-contract.test.ts
test("PersistenceAdapter methods return Promises", async () => {
  const adapter = createAdapter();

  const claimResult = adapter.claimNextJob("worker-1", 30, {...});
  assert(claimResult instanceof Promise);

  const claimed = await claimResult;
  assert.strictEqual(claimed?.status, "processing");
});

test("routes await persistence methods", async () => {
  const app = buildApp();
  const result = await app.inject({
    method: "POST",
    path: "/api/v1/queue/claim",
    payload: { workerId: "worker-1", leaseSeconds: 30 }
  });

  assert.strictEqual(result.statusCode, 200);
});
```

**Acceptance Criteria:**
- All interface methods return `Promise<T>`
- All route handlers use `await`
- Tests pass for both LocalPersistenceAdapter and VastPersistenceAdapter
- No breaking changes to API contracts

---

#### Task 1.2: Update LocalPersistenceAdapter to Return Promises
**Purpose:** Maintain compatibility for testing

**Test Strategy:**
```typescript
// test/local-persistence-async.test.ts
test("LocalPersistenceAdapter.claimNextJob returns Promise", async () => {
  const adapter = new LocalPersistenceAdapter();
  const result = await adapter.claimNextJob("worker-1", 30, {correlationId: "..."});
  assert(result);
});
```

**Acceptance Criteria:**
- All methods return `Promise<T>`
- Behavior identical to Phase 1 (just wrapped in Promise)
- All existing tests still pass

---

### Epic 2: VAST Database Adapter Implementation

**Why:** Replace in-memory storage with durable database.

#### Task 2.1: Design VAST Schema
**TDD Approach:** Test the schema by writing queries

**Schema Design:**
```sql
-- Core tables
CREATE TABLE assets (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  source_uri VARCHAR(1024) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE workflow_jobs (
  id VARCHAR(36) PRIMARY KEY,
  asset_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL,
  lease_owner VARCHAR(255),
  lease_expires_at TIMESTAMP,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMP,
  last_error VARCHAR(1024),
  updated_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

-- Indexes for critical queries
CREATE INDEX idx_workflow_jobs_claimable
  ON workflow_jobs(next_attempt_at ASC)
  WHERE status = 'pending' AND lease_owner IS NULL;

CREATE TABLE dlq_items (
  id VARCHAR(36) PRIMARY KEY,
  job_id VARCHAR(36) NOT NULL UNIQUE,
  asset_id VARCHAR(36) NOT NULL,
  error VARCHAR(1024),
  attempt_count INT,
  failed_at TIMESTAMP NOT NULL
);

CREATE TABLE outbox_items (
  id VARCHAR(36) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  correlation_id VARCHAR(100),
  payload TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP
);

CREATE INDEX idx_outbox_unpublished
  ON outbox_items(created_at ASC)
  WHERE published_at IS NULL;

CREATE TABLE audit_events (
  id VARCHAR(36) PRIMARY KEY,
  correlation_id VARCHAR(100),
  message TEXT NOT NULL,
  at TIMESTAMP NOT NULL
);
```

**Test Strategy:**
```typescript
// test/vast-schema.test.ts
test("VAST schema supports required operations", async () => {
  // Test that Trino API can execute schema DDL
  // Test that queries are performant
  // Test that constraints are enforced
});
```

#### Task 2.2: Implement VastPersistenceAdapter
**TDD Approach:** Write async tests first, implement adapter

**Key Methods:**
```typescript
export class VastPersistenceAdapter implements PersistenceAdapter {
  async createIngestAsset(input: IngestInput, context: WriteContext): Promise<IngestResult> {
    // INSERT INTO assets (id, title, source_uri, created_at) VALUES (...)
    // INSERT INTO workflow_jobs (id, asset_id, status, ...) VALUES (...)
    // Enqueue outbox event
    // Return result
  }

  async claimNextJob(
    workerId: string,
    leaseSeconds: number,
    context: WriteContext
  ): Promise<WorkflowJob | null> {
    // SELECT id FROM workflow_jobs
    //   WHERE status = 'pending'
    //   AND lease_owner IS NULL
    //   AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    //   ORDER BY next_attempt_at ASC
    //   LIMIT 1
    // UPDATE workflow_jobs SET status = 'processing', ... WHERE id = ?
  }

  async setJobStatus(
    jobId: string,
    status: WorkflowStatus,
    lastError: string | null,
    context: WriteContext
  ): Promise<WorkflowJob | null> {
    // UPDATE workflow_jobs SET status = ?, ... WHERE id = ?
  }

  // ... all other methods async ...
}
```

**Test Strategy:**
```typescript
// test/vast-persistence-adapter.test.ts

// 1. Contract tests - same tests as LocalPersistenceAdapter
test("VAST adapter implements PersistenceAdapter contract", async () => {
  const adapter = new VastPersistenceAdapter(config);

  // Run all same tests as local adapter
  const asset = await adapter.createIngestAsset({...}, {...});
  assert(asset.job.status === "pending");
});

// 2. VAST-specific tests
test("VAST adapter uses Trino API for queries", async () => {
  // Verify HTTP calls to VAST Database URL
  // Verify SQL queries are correct
  // Verify result mapping
});
```

**Acceptance Criteria:**
- All PersistenceAdapter methods implemented
- All contract tests pass (same as LocalPersistenceAdapter)
- Trino REST API calls verified
- Error handling for network/DB failures

---

### Epic 3: Atomic Job Claiming with VAST

**Why:** Current CAS check insufficient for horizontal scaling.

#### Task 3.1: Implement SELECT FOR UPDATE SKIP LOCKED
**Purpose:** Database-level atomic claiming

**SQL Pattern:**
```sql
UPDATE workflow_jobs
SET status = 'processing',
    lease_owner = $1,
    lease_expires_at = now() + interval '30 seconds',
    attempt_count = attempt_count + 1,
    updated_at = now()
WHERE id = (
  SELECT id FROM workflow_jobs
  WHERE status = 'pending'
    AND lease_owner IS NULL
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  ORDER BY next_attempt_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, asset_id, status, ...;
```

**Test Strategy:**
```typescript
// test/vast-atomic-claiming.test.ts

test("concurrent claimNextJob calls are atomic (no double-claims)", async () => {
  const adapter = new VastPersistenceAdapter(config);

  // Create 100 pending jobs
  for (let i = 0; i < 100; i++) {
    await adapter.createIngestAsset(
      { title: `asset-${i}.mp4`, sourceUri: `s3://bucket/${i}` },
      { correlationId: `corr-${i}` }
    );
  }

  // Simulate 10 workers claiming simultaneously (true concurrency)
  const claims = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      adapter.claimNextJob(`worker-${i}`, 30, { correlationId: `claim-${i}` })
    )
  );

  // Verify each job claimed by exactly one worker
  const claimedIds = new Set(claims.filter(Boolean).map(j => j!.id));
  assert.strictEqual(claimedIds.size, claims.filter(Boolean).length);
  assert.strictEqual(claimedIds.size, 10);
});
```

**Acceptance Criteria:**
- No double-claiming under concurrent load
- All 10 workers claim distinct jobs
- Tests pass with real VAST Database

---

### Epic 4: Kafka Event Broker Integration

**Why:** Replace HTTP outbox with durable message queue.

#### Task 4.1: Implement Event Broker Publishing
**Purpose:** Reliable event delivery to downstream systems

**Implementation:**
```typescript
export class VastPersistenceAdapter {
  async publishOutbox(context: WriteContext): Promise<number> {
    const unpublished = await this.getUnpublishedOutboxItems();

    let publishedCount = 0;
    for (const item of unpublished) {
      try {
        // Publish to Kafka-compatible broker
        await this.eventBroker.publish(item.eventType, {
          eventId: item.id,
          correlationId: item.correlationId,
          payload: item.payload,
          timestamp: item.createdAt
        });

        // Mark as published
        await this.markOutboxPublished(item.id);
        publishedCount++;
      } catch (error) {
        // Log error, continue with next item
        // Will retry on next publishOutbox call
        console.error(`Failed to publish event ${item.id}:`, error);
      }
    }

    return publishedCount;
  }
}
```

**Test Strategy:**
```typescript
// test/vast-event-broker.test.ts

test("publishOutbox publishes to Kafka broker", async () => {
  const mockBroker = {
    publish: jest.fn().mockResolvedValue(undefined)
  };

  const adapter = new VastPersistenceAdapter(config, mockBroker);

  // Create event via ingest
  await adapter.createIngestAsset({...}, {...});

  // Publish outbox
  const published = await adapter.publishOutbox({correlationId: "..."});

  // Verify broker was called
  assert(mockBroker.publish.called);
  assert(published > 0);
});

test("publishOutbox handles broker failures gracefully", async () => {
  const mockBroker = {
    publish: jest.fn().mockRejectedValue(new Error("Broker down"))
  };

  const adapter = new VastPersistenceAdapter(config, mockBroker);
  await adapter.createIngestAsset({...}, {...});

  // Should not throw, just log error
  const published = await adapter.publishOutbox({correlationId: "..."});
  assert.strictEqual(published, 0);  // Nothing published

  // Event still in outbox, can retry later
});
```

**Acceptance Criteria:**
- Events published to Kafka Event Broker
- Graceful handling of broker failures
- Idempotent publishing (same event not published twice)
- All tests pass

---

### Epic 5: Integration Testing

**Why:** Verify Phase 2 works end-to-end with VAST.

#### Task 5.1: E2E Tests with VAST
**TDD Approach:** Write comprehensive integration tests

**Test Strategy:**
```typescript
// test/phase2-e2e-vast.test.ts

test("End-to-end: ingest asset → claim job → complete → event published", async () => {
  const adapter = new VastPersistenceAdapter(vastConfig);

  // 1. Ingest asset
  const ingest = await adapter.createIngestAsset(
    { title: "test.mp4", sourceUri: "s3://bucket/test.mp4" },
    { correlationId: "corr-e2e-1" }
  );
  assert.strictEqual(ingest.job.status, "pending");

  // 2. Worker claims job
  const claimed = await adapter.claimNextJob(
    "worker-1",
    30,
    { correlationId: "corr-e2e-2" }
  );
  assert.strictEqual(claimed?.status, "processing");
  assert.strictEqual(claimed?.leaseOwner, "worker-1");

  // 3. Worker heartbeats
  const heartbeat = await adapter.heartbeatJob(
    claimed!.id,
    "worker-1",
    30,
    { correlationId: "corr-e2e-3" }
  );
  assert(heartbeat);

  // 4. Job completes
  const completed = await adapter.setJobStatus(
    claimed!.id,
    "completed",
    null,
    { correlationId: "corr-e2e-4" }
  );
  assert.strictEqual(completed?.status, "completed");

  // 5. Outbox events published
  const published = await adapter.publishOutbox({ correlationId: "corr-e2e-5" });
  assert(published > 0);

  // 6. Query VAST to verify state
  const final = await adapter.getJobById(claimed!.id);
  assert.strictEqual(final?.status, "completed");
});
```

---

## Development Workflow

### Per-Task Workflow (TDD)

1. **RED:** Write failing test
   ```bash
   npm --prefix services/control-plane test -- test/new-test.test.ts
   # Fails - feature not implemented
   ```

2. **GREEN:** Write minimum code to pass
   ```bash
   # Edit implementation file
   npm --prefix services/control-plane test -- test/new-test.test.ts
   # Passes
   ```

3. **REFACTOR:** Clean up code
   ```bash
   # Improve code clarity
   npm --prefix services/control-plane test -- test/new-test.test.ts
   # Still passes
   ```

4. **COMMIT:** Push work
   ```bash
   git add -A
   git commit -m "feat: implement feature X

   - Red: wrote failing test for behavior Y
   - Green: implemented minimum code to pass test
   - Refactor: extracted helper method Z

   Tests: 56/57 → 57/57 passing"
   ```

### Integration Checkpoints

After each epic:
```bash
# Verify all tests still pass
npm run test:all

# Check Docker Compose still works
docker compose config

# See test coverage
npm --prefix services/control-plane test -- --coverage
```

---

## VAST Configuration

For Phase 2, you'll need VAST endpoints:

```bash
# .env file
VAST_DATABASE_URL=https://vast.example.com/api/v1/trino
VAST_EVENT_BROKER_URL=https://vast.example.com/api/v1/kafka
VAST_DATAENGINE_URL=https://vast.example.com/api/v1/dataengine
VAST_API_TOKEN=<your-token>

# Enable strict mode (require all VAST endpoints)
ASSETHARBOR_VAST_STRICT=true
```

---

## Definition of Done

Phase 2 is complete when:

- ✅ All PersistenceAdapter methods are async (`Promise<T>`)
- ✅ VastPersistenceAdapter fully implemented
- ✅ All LocalPersistenceAdapter contract tests pass with VAST adapter
- ✅ Job claiming is atomic (no double-claims under concurrency)
- ✅ Outbox events publish to Kafka Event Broker
- ✅ End-to-end tests pass with real VAST endpoints
- ✅ All existing tests still pass (56/56 → 60+/60+)
- ✅ Docker Compose still validates
- ✅ No regressions in Phase 1 fixes
- ✅ Documentation updated
- ✅ TDD workflow followed throughout

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test Coverage | ≥70% (up from ~50%) |
| Tests Passing | 60+ (up from 56) |
| Async Methods | 100% of PersistenceAdapter |
| VAST Integration | All 5 core operations |
| Concurrency Safety | 0 double-claims under load |

---

## Next Steps

When ready to start Phase 2:

1. **Confirm VAST endpoints** available (staging acceptable)
2. **Review TDD guidelines** in `docs/TDD_GUIDELINES.md`
3. **Start with Task 1.1** (async interface)
4. **Follow Red-Green-Refactor** for each task
5. **Commit frequently** with clear messages
6. **Run `npm run test:all`** after each task

**Estimated Timeline:** 2-4 weeks (depends on VAST availability + team familiarity with async/database patterns)

---

**Phase 2 Ready to Begin:** ✅
