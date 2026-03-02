# Test-Driven Development (TDD) Guidelines

**Effective:** Phase 2 onwards
**Principle:** Tests first, implementation second

---

## Why TDD for AssetHarbor?

1. **Prevent Data Loss** - Tests catch persistence bugs early
2. **Catch Race Conditions** - Concurrency tests prevent multi-worker issues
3. **Maintain Clarity** - Tests document expected behavior
4. **Enable Refactoring** - Green tests = safe to change code
5. **VAST Integration Safety** - Async/DB operations need comprehensive coverage

---

## The TDD Workflow

### Step 1: Write Failing Test (RED)
```typescript
// test/my-feature.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("claimNextJob returns null if all jobs are leased", async () => {
  const persistence = new LocalPersistenceAdapter();

  // Ingest an asset (creates a pending job)
  const asset = persistence.createIngestAsset(
    { title: "test.mp4", sourceUri: "s3://bucket/test.mp4" },
    { correlationId: "corr-123" }
  );

  const job = asset.job;

  // Claim it (should succeed)
  const claimed = persistence.claimNextJob("worker-1", 30, {
    correlationId: "corr-456"
  });
  assert.strictEqual(claimed?.id, job.id);

  // Try to claim again (should return null - already leased)
  const secondClaim = persistence.claimNextJob("worker-2", 30, {
    correlationId: "corr-789"
  });
  assert.strictEqual(secondClaim, null);
});
```

**Status:** 🔴 RED (test fails because feature doesn't exist yet)

### Step 2: Write Minimum Code to Pass (GREEN)
```typescript
// src/persistence/adapters/local-persistence.ts
claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null {
  // ... find claimable job ...

  // Validate job state hasn't changed (CAS check)
  if (job.status !== "pending" || job.leaseOwner) {
    return null;  // ← This makes the test pass
  }

  // ... claim the job ...
}
```

**Status:** 🟢 GREEN (test passes)

### Step 3: Refactor for Clarity (REFACTOR)
```typescript
// Extract the validation into a helper method
private isSafeToClaimJob(job: WorkflowJob): boolean {
  return job.status === "pending" && !job.leaseOwner;
}

claimNextJob(workerId: string, leaseSeconds: number, context: WriteContext): WorkflowJob | null {
  // ... find claimable job ...

  if (!this.isSafeToClaimJob(job)) {
    return null;
  }

  // ... claim the job ...
}
```

**Status:** 🟢 GREEN (test still passes, code clearer)

---

## Test Organization

### By Layer

```
test/
├── unit/                          # Pure functions, no I/O
│   ├── event-processor.test.ts     # Workflow transitions
│   ├── backoff-calculation.test.ts # Retry logic
│   └── correlation-id.test.ts      # ID generation
│
├── integration/                    # Single component + dependencies
│   ├── persistence-contract.test.ts # Adapter interface
│   ├── job-claiming.test.ts        # Queue operations
│   └── outbox-publishing.test.ts   # Event publishing
│
├── contract/                       # API surface + schemas
│   ├── openapi-contract.test.ts    # REST endpoints
│   ├── event-contract.test.ts      # Event envelopes
│   └── error-envelope.test.ts      # Error responses
│
└── e2e/                            # Full workflows
    ├── ingest-to-completion.test.ts
    ├── retry-and-dlq.test.ts
    └── concurrent-workers.test.ts
```

### By Scenario (Happy Path + Edge Cases)

**Example: Job Claiming**

```typescript
// Happy path
test("claimNextJob claims pending job and updates state", async () => { ... });
test("claimNextJob increments attemptCount", async () => { ... });
test("claimNextJob sets leaseExpiresAt", async () => { ... });

// Edge cases
test("claimNextJob returns null if no pending jobs", async () => { ... });
test("claimNextJob returns null if job already leased", async () => { ... });
test("claimNextJob returns null if job status is not pending", async () => { ... });
test("claimNextJob returns null if lease has expired", async () => { ... });

// Concurrency
test("concurrent claimNextJob calls don't double-claim", async () => { ... });
test("claimNextJob is safe with multiple workers", async () => { ... });
```

---

## Writing Good Tests

### ✅ DO

**1. Test Behavior, Not Implementation**
```typescript
// ✅ GOOD - Tests what the user cares about
test("asset ingest creates asset and pending job", async () => {
  const result = persistence.createIngestAsset({...}, {...});
  assert.strictEqual(result.job.status, "pending");
  assert(result.asset.id);
});

// ❌ BAD - Tests internal details
test("createIngestAsset calls randomUUID exactly once", async () => {
  // mock UUID generation...
});
```

**2. Use Clear Setup/Act/Assert (AAA Pattern)**
```typescript
// ✅ GOOD - Easy to understand test flow
test("heartbeat extends lease expiration", async () => {
  // Arrange
  const job = persistence.createIngestAsset({...}, {...}).job;
  persistence.claimNextJob("worker-1", 30, {...});

  // Act
  const now = new Date();
  const heartbeat = persistence.heartbeatJob(
    job.id,
    "worker-1",
    60,  // extend by 60 seconds
    { correlationId: "corr-123", now }
  );

  // Assert
  const expectedExpiry = new Date(now.getTime() + 60 * 1000);
  assert(
    new Date(heartbeat?.leaseExpiresAt || "").getTime() > expectedExpiry.getTime() - 1000
  );
});
```

**3. Test Error Cases**
```typescript
// ✅ GOOD - Tests what happens when things go wrong
test("handleJobFailure moves job to DLQ after max attempts", async () => {
  // Create job with maxAttempts=3
  const asset = persistence.createIngestAsset(
    { title: "test.mp4", sourceUri: "s3://bucket/test.mp4" },
    { correlationId: "corr-123" }
  );
  const job = asset.job;

  // Fail it 3 times
  for (let i = 0; i < 3; i++) {
    persistence.handleJobFailure(job.id, "Error", { correlationId: "corr-123" });
  }

  // Assert it's in DLQ
  const dlq = persistence.getDlqItems();
  assert(dlq.some(item => item.jobId === job.id));
});
```

**4. Use Descriptive Test Names**
```typescript
// ✅ GOOD - Clear what's being tested
test("claimNextJob with expired lease resets lease status", async () => {});

// ❌ BAD - Unclear intent
test("claimNextJob works with leases", async () => {});
```

**5. Isolate Tests (No Shared State)**
```typescript
// ✅ GOOD - Each test is independent
test("test 1", async () => {
  const persistence = new LocalPersistenceAdapter();
  // test logic
});

test("test 2", async () => {
  const persistence = new LocalPersistenceAdapter();  // Fresh adapter
  // test logic
});

// ❌ BAD - Tests depend on each other
let persistence: PersistenceAdapter;

before(() => {
  persistence = new LocalPersistenceAdapter();
});

test("test 1", async () => {
  // ... uses persistence from before hook
});

test("test 2", async () => {
  // ... depends on state from test 1 !
});
```

### ❌ DON'T

**1. Test Implementation Details**
```typescript
// ❌ BAD - Tests internal Map usage
test("jobs are stored in a Map", async () => {
  const adapter = new LocalPersistenceAdapter();
  // Access private field... bad!
  assert(adapter["jobs"] instanceof Map);
});
```

**2. Mock Too Much**
```typescript
// ❌ BAD - Mocks the thing you're testing
test("claimNextJob works", async () => {
  const mockPersistence = { claimNextJob: () => ({...}) };
  // Not testing real implementation!
});
```

**3. Test Multiple Things in One Test**
```typescript
// ❌ BAD - Tests three things at once
test("job lifecycle", async () => {
  // ... test ingest ...
  // ... test claim ...
  // ... test complete ...
  // When it fails, which part broke?
});

// ✅ GOOD - One test per scenario
test("ingest creates pending job", async () => { ... });
test("claimNextJob transitions to processing", async () => { ... });
test("completing job creates event", async () => { ... });
```

---

## Persistence Layer Testing

### Contract Tests (What Every Adapter Must Support)

```typescript
// test/persistence-contract.test.ts
// This test file runs against BOTH local and VAST adapters

const adapters = [
  { name: "LocalPersistenceAdapter", factory: () => new LocalPersistenceAdapter() },
  { name: "VastPersistenceAdapter", factory: () => new VastPersistenceAdapter({...}) }
];

for (const { name, factory } of adapters) {
  describe(`${name} contract`, () => {
    test("createIngestAsset creates asset with pending job", async () => {
      const adapter = factory();
      const result = adapter.createIngestAsset(
        { title: "test.mp4", sourceUri: "s3://..." },
        { correlationId: "corr-123" }
      );

      assert(result.asset.id);
      assert.strictEqual(result.job.status, "pending");
    });

    test("claimNextJob atomically claims exactly one job", async () => {
      // ... test implementation ...
    });

    // ... more contract tests ...
  });
}
```

This ensures both adapters behave identically.

---

## Concurrency Testing (For Multi-Worker Safety)

```typescript
// test/concurrent-workers.test.ts

test("concurrent claimNextJob calls don't double-claim", async () => {
  const persistence = new LocalPersistenceAdapter();

  // Create 100 pending jobs
  const jobs = [];
  for (let i = 0; i < 100; i++) {
    const result = persistence.createIngestAsset(
      { title: `asset-${i}.mp4`, sourceUri: `s3://bucket/${i}` },
      { correlationId: `corr-ingest-${i}` }
    );
    jobs.push(result.job);
  }

  // Simulate 10 workers claiming simultaneously
  const claims = await Promise.all(
    Array.from({ length: 10 }, (_, workerIdx) =>
      Promise.resolve().then(() =>
        persistence.claimNextJob(
          `worker-${workerIdx}`,
          30,
          { correlationId: `corr-claim-${workerIdx}` }
        )
      )
    )
  );

  // Assert each job claimed by at most one worker
  const claimedJobIds = claims
    .filter(Boolean)
    .map(job => job!.id);

  const uniqueIds = new Set(claimedJobIds);
  assert.strictEqual(uniqueIds.size, claimedJobIds.length, "Some jobs claimed twice!");
  assert.strictEqual(claimedJobIds.length, 10, "Should claim 10 jobs");
});
```

---

## Running Tests

### Run All Tests
```bash
npm run test:all
```

### Run Specific Service
```bash
npm run test:control-plane
npm run test:worker
npm run test:web-ui
```

### Run Single Test File
```bash
npm --prefix services/control-plane test -- test/job-claiming.test.ts
```

### Watch Mode (Development)
```bash
npm --prefix services/control-plane test -- --watch
```

---

## CI/CD Integration

Tests run automatically on:
- **PR creation** - Must pass before merge
- **Pre-commit** - Optional local hook (recommended)
- **Merge to main** - Builds + publishes containers

**See:** `.github/workflows/ci.yml` and `cd.yml`

---

## Checklist for Phase 2+ PRs

Before submitting a PR:

- [ ] **Tests written FIRST** (Red → Green → Refactor)
- [ ] **All tests passing:** `npm run test:all`
- [ ] **No skipped tests** (`.only` or `.skip` removed)
- [ ] **Edge cases covered:**
  - Happy path ✅
  - Empty results ✅
  - Error cases ✅
  - Boundary conditions ✅
  - Concurrency scenarios ✅
- [ ] **Persistence layer tests** (if modifying adapter)
- [ ] **Contract tests updated** (if changing API)
- [ ] **Commit message clear:** Explains "why" not just "what"
- [ ] **No console.log() left behind**
- [ ] **Code cleanup:** Remove temporary debugging code
- [ ] **Docker Compose validates:** `docker compose config`

---

## Questions?

- **How to test async operations?** See `test/outbox-publishing.test.ts` for Promise handling
- **How to test race conditions?** See `test/concurrent-workers.test.ts` for Promise.all patterns
- **How to test VAST integration?** Phase 2 will add VAST-specific tests in `test/vast-integration/`

**Remember:** Tests are documentation. A good test tells future developers exactly how to use the code.
