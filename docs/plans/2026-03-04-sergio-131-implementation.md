# SERGIO-131 Implementation Plan: VAST Event Broker Subscriber

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire VAST DataEngine completion events into AssetHarbor by implementing a Kafka consumer in the control-plane that receives CloudEvents from VAST Event Broker and updates job status + asset metadata.

**Architecture:** The control-plane gains a `VastEventSubscriber` module that subscribes to the VAST Event Broker Kafka topic where VAST DataEngine publishes completion events. In dev mode (no VAST cluster), the media-worker simulates the VAST element trigger + pipeline execution and publishes mock events to a local in-process broker. The subscriber code path is identical in both modes.

**Tech Stack:** TypeScript/Fastify (control-plane), `kafkajs` (Kafka consumer), Python (media-worker dev simulation), existing `processAssetEvent()` + `PersistenceAdapter` interfaces.

**Design doc:** `docs/plans/2026-03-04-sergio-131-design.md`

**VAST platform facts (validated vs docs):**
- VAST Event Broker is Kafka-compatible (Producer/Consumer API, consumer groups, SSL)
- Use `kafkajs` for Node.js — standard Kafka protocol is supported
- Messages ≤ 1MB, no transactions, max 256 consumer groups per view
- Topics must be pre-created (no automatic creation)

---

## Task 1: Define VastDataEngineCompletionEvent type

**Context:** VAST DataEngine publishes CloudEvents when a pipeline completes. We need a TypeScript type for this payload shape, and a normalizer that maps it to the existing `NormalizedAssetEvent` format used by `processAssetEvent()`.

**Files:**
- Modify: `services/control-plane/src/events/types.ts`
- Test: `services/control-plane/test/vast-event-types.test.ts` (new)

---

**Step 1: Write the failing test**

Create `services/control-plane/test/vast-event-types.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "../src/events/types.js";

test("isVastDataEngineCompletionEvent: accepts valid completion event", () => {
  const event = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-abc-123",
    time: "2026-03-04T10:00:00Z",
    data: {
      asset_id: "asset-001",
      job_id: "job-001",
      function_id: "exr_inspector",
      success: true,
      metadata: { codec: "exr", resolution: { width: 4096, height: 2160 } },
    },
  };
  assert.equal(isVastDataEngineCompletionEvent(event), true);
});

test("isVastDataEngineCompletionEvent: rejects missing asset_id", () => {
  const event = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-abc-123",
    time: "2026-03-04T10:00:00Z",
    data: { job_id: "job-001", function_id: "exr_inspector", success: true },
  };
  assert.equal(isVastDataEngineCompletionEvent(event), false);
});

test("isVastDataEngineCompletionEvent: rejects wrong event type", () => {
  const event = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.started",
    id: "evt-abc-123",
    data: { asset_id: "a", job_id: "j", function_id: "f", success: true },
  };
  assert.equal(isVastDataEngineCompletionEvent(event), false);
});

test("normalizeVastDataEngineEvent: success maps to completed event", () => {
  const event = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-abc-123",
    time: "2026-03-04T10:00:00Z",
    data: {
      asset_id: "asset-001",
      job_id: "job-001",
      function_id: "exr_inspector",
      success: true,
      metadata: { codec: "exr" },
    },
  };
  const normalized = normalizeVastDataEngineEvent(event);
  assert.equal(normalized.eventId, "evt-abc-123");
  assert.equal(normalized.eventType, "asset.processing.completed");
  assert.equal(normalized.jobId, "job-001");
  assert.equal(normalized.metadata?.codec, "exr");
  assert.equal(normalized.error, undefined);
});

test("normalizeVastDataEngineEvent: failure maps to failed event with error", () => {
  const event = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-xyz-456",
    time: "2026-03-04T10:00:00Z",
    data: {
      asset_id: "asset-002",
      job_id: "job-002",
      function_id: "exr_inspector",
      success: false,
      error: "file not found",
    },
  };
  const normalized = normalizeVastDataEngineEvent(event);
  assert.equal(normalized.eventType, "asset.processing.failed");
  assert.equal(normalized.error, "file not found");
  assert.equal(normalized.metadata, undefined);
});
```

**Step 2: Run test to verify it fails**

```bash
cd services/control-plane
node --test test/vast-event-types.test.ts
```

Expected: `SyntaxError: Cannot find module` or `isVastDataEngineCompletionEvent is not exported`

**Step 3: Implement the type + guards in `src/events/types.ts`**

Append to the end of `services/control-plane/src/events/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// VAST DataEngine CloudEvent — published by VAST Event Broker on pipeline completion
// ---------------------------------------------------------------------------

export interface VastDataEngineCompletionEvent {
  specversion: "1.0";
  type: "vast.dataengine.pipeline.completed";
  source: string;
  id: string;
  time: string;
  data: {
    asset_id: string;
    job_id: string;
    function_id: string;
    success: boolean;
    metadata?: Record<string, unknown>;
    error?: string;
  };
}

export interface NormalizedVastEvent extends NormalizedAssetEvent {
  metadata?: Record<string, unknown>;
}

export function isVastDataEngineCompletionEvent(
  input: unknown,
): input is VastDataEngineCompletionEvent {
  if (!input || typeof input !== "object") return false;
  const v = input as Record<string, unknown>;
  if (v["type"] !== "vast.dataengine.pipeline.completed") return false;
  if (typeof v["id"] !== "string") return false;
  const data = v["data"] as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return false;
  return (
    typeof data["asset_id"] === "string" &&
    typeof data["job_id"] === "string" &&
    typeof data["function_id"] === "string" &&
    typeof data["success"] === "boolean"
  );
}

export function normalizeVastDataEngineEvent(
  event: VastDataEngineCompletionEvent,
): NormalizedVastEvent {
  return {
    eventId: event.id,
    eventType: event.data.success
      ? "asset.processing.completed"
      : "asset.processing.failed",
    jobId: event.data.job_id,
    error: event.data.error,
    metadata: event.data.metadata,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd services/control-plane
node --test test/vast-event-types.test.ts
```

Expected: `5 passing`

**Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: `0 errors`

**Step 6: Commit**

```bash
git add services/control-plane/src/events/types.ts \
        services/control-plane/test/vast-event-types.test.ts
git commit -m "feat(events): add VastDataEngineCompletionEvent type and normalizer"
```

---

## Task 2: Add sourceUri to WorkflowJob (dev mode support)

**Context:** In dev simulation mode, the media worker claims jobs and needs `sourceUri` to locate the mock file. Add it to `WorkflowJob` domain model and include it in the claim response. In production, VAST element triggers already have the file path from the VAST view.

**Files:**
- Modify: `services/control-plane/src/domain/models.ts`
- Modify: `services/control-plane/src/routes/queue.ts`
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Test: `services/control-plane/test/queue-claim-source-uri.test.ts` (new)

---

**Step 1: Write the failing test**

Create `services/control-plane/test/queue-claim-source-uri.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("POST /api/v1/queue/claim returns sourceUri in job response", async () => {
  const app = buildApp();
  await app.ready();

  // First ingest an asset to create a job
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "test.exr", sourceUri: "file:///vast/renders/test.exr" },
  });
  assert.equal(ingestRes.statusCode, 201);

  // Claim the job
  const claimRes = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });
  assert.equal(claimRes.statusCode, 200);
  const body = claimRes.json();
  assert.ok(body.job, "job should not be null");
  assert.equal(body.job.sourceUri, "file:///vast/renders/test.exr");

  await app.close();
});
```

**Step 2: Run test to verify it fails**

```bash
cd services/control-plane
node --test test/queue-claim-source-uri.test.ts
```

Expected: FAIL — `body.job.sourceUri` is undefined

**Step 3: Add `sourceUri` to WorkflowJob domain model**

In `services/control-plane/src/domain/models.ts`, add `sourceUri` to `WorkflowJob`:

```typescript
export interface WorkflowJob {
  id: string;
  assetId: string;
  sourceUri: string;           // ← ADD THIS LINE
  status: WorkflowStatus;
  // ... rest of existing fields unchanged
```

**Step 4: Update LocalPersistenceAdapter to include sourceUri when creating jobs**

In `services/control-plane/src/persistence/adapters/local-persistence.ts`, find where `WorkflowJob` is constructed in `createIngestAsset()` and add `sourceUri: input.sourceUri`.

Read the file first to find the exact location:

```bash
grep -n "sourceUri\|WorkflowJob\|createIngestAsset" \
  services/control-plane/src/persistence/adapters/local-persistence.ts | head -20
```

Add `sourceUri: input.sourceUri` to the job object literal in `createIngestAsset`.

**Step 5: Update the OpenAPI/JSON schema for WorkflowJob in `src/http/schemas.ts`**

Find `workflowJobSchema` and add:

```typescript
sourceUri: { type: "string" },
```

to its `properties` and `required` array.

**Step 6: Run test to verify it passes**

```bash
cd services/control-plane
node --test test/queue-claim-source-uri.test.ts
```

Expected: PASS

**Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: `0 errors`

**Step 8: Commit**

```bash
git add services/control-plane/src/domain/models.ts \
        services/control-plane/src/persistence/adapters/local-persistence.ts \
        services/control-plane/src/http/schemas.ts \
        services/control-plane/test/queue-claim-source-uri.test.ts
git commit -m "feat(queue): include sourceUri in claim response for dev simulation mode"
```

---

## Task 3: Implement VastEventSubscriber

**Context:** This is the core of SERGIO-131. A Kafka consumer that subscribes to the VAST Event Broker topic, parses `VastDataEngineCompletionEvent` CloudEvents, correlates them to AssetHarbor jobs, and updates job status + asset metadata via the existing `processAssetEvent()` + `updateAsset()`.

**Files:**
- Create: `services/control-plane/src/events/vast-event-subscriber.ts`
- Test: `services/control-plane/test/vast-event-subscriber.test.ts` (new)

**Install dependency first:**

```bash
cd services/control-plane
npm install kafkajs
```

---

**Step 1: Write the failing test**

Create `services/control-plane/test/vast-event-subscriber.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { VastEventSubscriber } from "../src/events/vast-event-subscriber.js";
import { buildApp } from "../src/app.js";

// Minimal mock Kafka consumer
function makeMockKafka(messages: object[]) {
  let handler: ((payload: { message: { value: Buffer } }) => Promise<void>) | null = null;

  return {
    kafka: {
      consumer: () => ({
        connect: async () => {},
        subscribe: async () => {},
        run: async (opts: { eachMessage: typeof handler }) => {
          handler = opts!.eachMessage;
        },
        disconnect: async () => {},
      }),
    },
    // Call this in tests to simulate receiving a message
    async deliver(msg: object) {
      if (handler) {
        await handler({
          message: { value: Buffer.from(JSON.stringify(msg)) },
        } as any);
      }
    },
  };
}

test("VastEventSubscriber: completion event updates job to completed", async () => {
  const app = buildApp();
  await app.ready();

  // Ingest an asset to get a job in the queue
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "shot_010.exr", sourceUri: "file:///vast/shot_010.exr" },
  });
  const { job } = ingestRes.json();

  // Claim the job (move to processing)
  await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });

  // Set up mock Kafka
  const mock = makeMockKafka([]);
  const persistence = (app as any).persistence; // exposed via app for testing
  const subscriber = new VastEventSubscriber(persistence, mock.kafka as any, "test-topic", "test-group");
  await subscriber.start();

  // Simulate VAST DataEngine completion event
  await mock.deliver({
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-001",
    time: new Date().toISOString(),
    data: {
      asset_id: job.assetId,
      job_id: job.id,
      function_id: "exr_inspector",
      success: true,
      metadata: { codec: "exr", resolution: { width: 4096, height: 2160 } },
    },
  });

  // Verify job is now completed
  const jobRes = await app.inject({ method: "GET", url: `/api/v1/jobs/${job.id}` });
  assert.equal(jobRes.json().job.status, "completed");

  await subscriber.stop();
  await app.close();
});

test("VastEventSubscriber: failure event triggers job failure handling", async () => {
  const app = buildApp();
  await app.ready();

  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "broken.exr", sourceUri: "file:///vast/broken.exr" },
  });
  const { job } = ingestRes.json();

  await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });

  const mock = makeMockKafka([]);
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka as any, "test-topic", "test-group");
  await subscriber.start();

  await mock.deliver({
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-002",
    time: new Date().toISOString(),
    data: {
      asset_id: job.assetId,
      job_id: job.id,
      function_id: "exr_inspector",
      success: false,
      error: "EXR file corrupted",
    },
  });

  const jobRes = await app.inject({ method: "GET", url: `/api/v1/jobs/${job.id}` });
  assert.ok(
    ["failed", "needs_replay"].includes(jobRes.json().job.status),
    "job should be failed or queued for replay"
  );

  await subscriber.stop();
  await app.close();
});

test("VastEventSubscriber: duplicate event is ignored (idempotency)", async () => {
  const app = buildApp();
  await app.ready();

  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "dup.exr", sourceUri: "file:///vast/dup.exr" },
  });
  const { job } = ingestRes.json();

  await app.inject({ method: "POST", url: "/api/v1/queue/claim", body: { workerId: "w", leaseSeconds: 30 } });

  const mock = makeMockKafka([]);
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka as any, "test-topic", "test-group");
  await subscriber.start();

  const completionEvent = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-dup-001",
    time: new Date().toISOString(),
    data: { asset_id: job.assetId, job_id: job.id, function_id: "exr_inspector", success: true, metadata: {} },
  };

  // Deliver twice — should not throw
  await mock.deliver(completionEvent);
  await mock.deliver(completionEvent); // duplicate

  const jobRes = await app.inject({ method: "GET", url: `/api/v1/jobs/${job.id}` });
  assert.equal(jobRes.json().job.status, "completed");

  await subscriber.stop();
  await app.close();
});

test("VastEventSubscriber: non-DataEngine message is silently skipped", async () => {
  const app = buildApp();
  await app.ready();

  const mock = makeMockKafka([]);
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka as any, "test-topic", "test-group");
  await subscriber.start();

  // Should not throw for unknown event type
  await mock.deliver({ type: "some.other.event", id: "x", data: {} });

  await subscriber.stop();
  await app.close();
});
```

**Step 2: Run test to verify it fails**

```bash
cd services/control-plane
node --test test/vast-event-subscriber.test.ts
```

Expected: FAIL — `VastEventSubscriber` not found

**Step 3: Implement VastEventSubscriber**

Create `services/control-plane/src/events/vast-event-subscriber.ts`:

```typescript
import { Kafka, type Consumer } from "kafkajs";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "./types.js";
import { processAssetEvent } from "./processor.js";

export class VastEventSubscriber {
  private consumer: Consumer;
  private running = false;

  constructor(
    private readonly persistence: PersistenceAdapter,
    private readonly kafka: Kafka,
    private readonly topic: string,
    private readonly groupId: string,
  ) {
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
    this.running = true;

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(message.value.toString());
        } catch {
          console.warn("[VastEventSubscriber] Unparseable message — skipping");
          return;
        }

        if (!isVastDataEngineCompletionEvent(parsed)) {
          // Not a VAST DataEngine completion event — skip silently
          return;
        }

        const normalized = normalizeVastDataEngineEvent(parsed);
        const context = {
          correlationId: parsed.id,
          now: parsed.time,
        };

        // Update job status via existing event processor
        const result = processAssetEvent(this.persistence, normalized, context, {
          enableRetryOnFailure: true,
        });

        if (!result.accepted && !result.duplicate) {
          console.warn(
            `[VastEventSubscriber] Event rejected: ${result.reason} — job ${normalized.jobId}`,
          );
          return;
        }

        if (result.duplicate) {
          return; // Idempotency — already processed
        }

        // If success, also persist metadata to the asset record
        if (normalized.eventType === "asset.processing.completed" && normalized.metadata) {
          const job = this.persistence.getJobById(normalized.jobId);
          if (job) {
            this.persistence.updateAsset(job.assetId, { metadata: normalized.metadata }, context);
          }
        }
      },
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.consumer.disconnect();
  }
}
```

**Step 4: Expose persistence on app for testing**

In `services/control-plane/src/app.ts`, after `const persistence = ...`, add:

```typescript
(app as any).persistence = persistence;
```

Note: This is test scaffolding only. In production the subscriber is wired directly.

**Step 5: Run tests to verify they pass**

```bash
cd services/control-plane
node --test test/vast-event-subscriber.test.ts
```

Expected: `4 passing`

**Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: `0 errors`

**Step 7: Commit**

```bash
git add services/control-plane/src/events/vast-event-subscriber.ts \
        services/control-plane/test/vast-event-subscriber.test.ts \
        services/control-plane/src/app.ts \
        services/control-plane/package.json \
        services/control-plane/package-lock.json
git commit -m "feat(events): implement VastEventSubscriber Kafka consumer for DataEngine completion events"
```

---

## Task 4: Wire VastEventSubscriber into app lifecycle

**Context:** The subscriber must start when the app is ready (alongside `auditRetention`) and stop cleanly on shutdown. In production it connects to `VAST_EVENT_BROKER_URL`. In dev (no env var) it skips Kafka entirely — the mock broker in tests handles the dev path.

**Files:**
- Modify: `services/control-plane/src/app.ts`
- Test: `services/control-plane/test/app-subscriber-lifecycle.test.ts` (new)

---

**Step 1: Write the failing test**

Create `services/control-plane/test/app-subscriber-lifecycle.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("app starts without VAST_EVENT_BROKER_URL — subscriber skipped gracefully", async () => {
  // Ensure env var is not set
  const prev = process.env.VAST_EVENT_BROKER_URL;
  delete process.env.VAST_EVENT_BROKER_URL;

  try {
    const app = buildApp();
    // Should not throw even without broker URL
    await assert.doesNotReject(app.ready());
    await app.close();
  } finally {
    if (prev !== undefined) process.env.VAST_EVENT_BROKER_URL = prev;
  }
});
```

**Step 2: Run test to verify it passes already (it should)**

```bash
cd services/control-plane
node --test test/app-subscriber-lifecycle.test.ts
```

Expected: PASS (app already starts without broker URL)

**Step 3: Wire subscriber into `src/app.ts`**

Add the following to `src/app.ts` after the existing `auditRetention` setup:

```typescript
import { Kafka } from "kafkajs";
import { VastEventSubscriber } from "./events/vast-event-subscriber.js";

// Inside buildApp(), after const auditRetention = ...:
const brokerUrl = process.env.VAST_EVENT_BROKER_URL;
const topic = process.env.VAST_EVENT_BROKER_TOPIC ?? "assetharbor.dataengine.completed";
const groupId = process.env.VAST_EVENT_BROKER_GROUP ?? "assetharbor-control-plane";

let subscriber: VastEventSubscriber | null = null;

if (brokerUrl) {
  const kafka = new Kafka({
    clientId: "assetharbor-control-plane",
    brokers: [brokerUrl],
    ssl: process.env.VAST_EVENT_BROKER_SSL === "true",
  });
  subscriber = new VastEventSubscriber(persistence, kafka, topic, groupId);
}

// In the onReady hook (add after auditRetention.start()):
app.addHook("onReady", async () => {
  auditRetention.start();
  if (subscriber) {
    await subscriber.start();
  }
});

// In the onClose hook (add after auditRetention.stop()):
app.addHook("onClose", async () => {
  auditRetention.stop();
  if (subscriber) {
    await subscriber.stop();
  }
});
```

**Step 4: Run all tests**

```bash
cd services/control-plane
node --test test/app-subscriber-lifecycle.test.ts
node --test test/vast-event-subscriber.test.ts
npx tsc --noEmit
```

Expected: All passing, 0 TS errors

**Step 5: Commit**

```bash
git add services/control-plane/src/app.ts
git commit -m "feat(app): wire VastEventSubscriber into app lifecycle — starts when VAST_EVENT_BROKER_URL is set"
```

---

## Task 5: Update media worker for dev simulation mode

**Context:** `services/media-worker/` is dev-mode simulation only. It should clearly document this, and after its mock pipeline runs, publish a mock completion event that follows the `VastDataEngineCompletionEvent` shape. This lets the control-plane subscriber code path be tested end-to-end locally.

**Files:**
- Modify: `services/media-worker/worker/main.py`
- Modify: `services/media-worker/worker/client.py`
- Modify: `services/media-worker/worker/data_engine.py` (add DEV SIMULATION header)
- Test: `services/media-worker/tests/test_worker_flow.py` (update)

---

**Step 1: Add `post_dataengine_completion` to ControlPlaneClient**

In `services/media-worker/worker/client.py`, add:

```python
def post_dataengine_completion(
    self,
    event_id: str,
    asset_id: str,
    job_id: str,
    function_id: str,
    success: bool,
    metadata: dict | None = None,
    error: str | None = None,
) -> dict:
    """
    DEV SIMULATION ONLY.
    Posts a mock VAST DataEngine completion CloudEvent to the control-plane events endpoint.
    In production, VAST DataEngine publishes directly to the VAST Event Broker (Kafka).
    """
    payload = {
        "specversion": "1.0",
        "type": "vast.dataengine.pipeline.completed",
        "source": "dev-simulation/media-worker",
        "id": event_id,
        "time": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "data": {
            "asset_id": asset_id,
            "job_id": job_id,
            "function_id": function_id,
            "success": success,
            "metadata": metadata,
            "error": error,
        },
    }
    response = requests.post(
        f"{self.base_url}/api/v1/events/vast-dataengine",
        json=payload,
        headers=self._headers(),
        timeout=10,
    )
    response.raise_for_status()
    return response.json()
```

**Step 2: Update `main.py` to publish completion event after mock processing**

Replace the current `process_next_job` body in `services/media-worker/worker/main.py`:

```python
"""
DEV SIMULATION MODE
===================
This file simulates VAST DataEngine behavior locally when no VAST cluster is available.

In production (VAST environment):
- VAST element triggers fire automatically when files land in VAST views
- VAST DataEngine runs registered pipeline functions (exr_inspector, ASR, transcode, etc.)
- VAST Event Broker publishes completion CloudEvents to Kafka
- Control-plane VastEventSubscriber consumes those events

This file is NOT used in production VAST environments.
"""

def process_next_job(self) -> bool:
    claimed = self.client.claim_next_job(self.worker_id, self.lease_seconds)
    if not claimed:
        return False

    job_id = claimed["id"]
    asset_id = claimed["assetId"]
    source_uri = claimed.get("sourceUri", "")
    correlation_id = f"dev-sim-{self.worker_id}-{job_id}-{uuid4()}"

    # Emit started event
    started = WorkflowEvent(
        event_type="asset.processing.started",
        asset_id=asset_id,
        job_id=job_id,
        correlation_id=correlation_id,
    )
    self.client.post_event(started.to_payload())

    self.client.heartbeat_job(job_id, self.worker_id, self.lease_seconds)

    try:
        # DEV SIMULATION: run local mock pipeline
        # In production, VAST DataEngine runs the real function
        mock_metadata = {
            "codec": "exr",
            "resolution": {"width": 4096, "height": 2160},
            "frame_rate": 24.0,
            "file_size_bytes": 52428800,
        }

        # Publish mock VAST DataEngine completion event
        # Control-plane VastEventSubscriber will receive and process this
        self.client.post_dataengine_completion(
            event_id=str(uuid4()),
            asset_id=asset_id,
            job_id=job_id,
            function_id="exr_inspector",
            success=True,
            metadata=mock_metadata,
        )

    except Exception as exc:
        self.client.post_dataengine_completion(
            event_id=str(uuid4()),
            asset_id=asset_id,
            job_id=job_id,
            function_id="exr_inspector",
            success=False,
            error=str(exc),
        )
        return True

    return True
```

**Step 3: Update `worker/data_engine.py` with DEV SIMULATION header**

Add to the top of `services/media-worker/worker/data_engine.py`:

```python
"""
DEV SIMULATION ONLY — Not used in production VAST environments.

In production, VAST DataEngine runs pipeline functions as containerized images
on Kubernetes, triggered by VAST element triggers (file CRUD on VAST views).
This module provides local mock execution for development without a VAST cluster.
"""
```

**Step 4: Update worker tests**

In `services/media-worker/tests/test_worker_flow.py`, update `FakeControlPlaneClient` to include:
- `post_dataengine_completion()` method that records calls
- `claim_next_job()` to return `sourceUri` in the job dict
- Update assertions to check `post_dataengine_completion` was called instead of the old completed event

```python
class FakeControlPlaneClient:
    def __init__(self):
        self._claims = [
            {
                "id": "job-1",
                "assetId": "asset-1",
                "sourceUri": "file:///vast/renders/test.exr",
                "status": "processing",
                "attemptCount": 1,
            }
        ]
        self.events = []
        self.heartbeats = []
        self.dataengine_completions = []

    def claim_next_job(self, worker_id, lease_seconds):
        if not self._claims:
            return None
        return self._claims.pop(0)

    def heartbeat_job(self, job_id, worker_id, lease_seconds):
        self.heartbeats.append({"job_id": job_id})

    def post_event(self, payload):
        self.events.append(payload)

    def post_dataengine_completion(self, event_id, asset_id, job_id, function_id, success, metadata=None, error=None):
        self.dataengine_completions.append({
            "event_id": event_id,
            "asset_id": asset_id,
            "job_id": job_id,
            "function_id": function_id,
            "success": success,
            "metadata": metadata,
            "error": error,
        })
```

Update the main worker test assertion:

```python
def test_worker_claims_job_emits_started_then_dataengine_completion():
    client = FakeControlPlaneClient()
    worker = MediaWorker(client, worker_id="worker-a", lease_seconds=30)

    processed = worker.process_next_job()

    assert processed is True
    # Started event emitted
    assert len(client.events) == 1
    assert client.events[0]["eventType"] == "asset.processing.started"
    # DataEngine completion published
    assert len(client.dataengine_completions) == 1
    assert client.dataengine_completions[0]["success"] is True
    assert client.dataengine_completions[0]["function_id"] == "exr_inspector"
    assert len(client.heartbeats) == 1
```

**Step 5: Run worker tests**

```bash
cd services/media-worker
python -m pytest tests/ -v
```

Expected: All passing

**Step 6: Commit**

```bash
git add services/media-worker/worker/main.py \
        services/media-worker/worker/client.py \
        services/media-worker/worker/data_engine.py \
        services/media-worker/tests/test_worker_flow.py
git commit -m "feat(worker): dev simulation — publish VastDataEngineCompletionEvent after mock pipeline"
```

---

## Task 6: New control-plane route for dev simulation events

**Context:** In dev mode, the media worker posts mock DataEngine completion events to the control-plane via HTTP (since there's no real Kafka broker). We need a `POST /api/v1/events/vast-dataengine` endpoint that receives these events and routes them through `processAssetEvent()` + `updateAsset()` — the same logic as the Kafka subscriber.

**Files:**
- Create: `services/control-plane/src/routes/vast-events.ts`
- Modify: `services/control-plane/src/app.ts`
- Test: `services/control-plane/test/vast-events-route.test.ts` (new)

---

**Step 1: Write the failing test**

Create `services/control-plane/test/vast-events-route.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("POST /api/v1/events/vast-dataengine: completion event updates job status", async () => {
  const app = buildApp();
  await app.ready();

  // Ingest + claim
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "frame.exr", sourceUri: "file:///vast/frame.exr" },
  });
  const { job } = ingestRes.json();
  await app.inject({ method: "POST", url: "/api/v1/queue/claim", body: { workerId: "w", leaseSeconds: 30 } });

  // Post mock DataEngine completion event
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/events/vast-dataengine",
    body: {
      specversion: "1.0",
      type: "vast.dataengine.pipeline.completed",
      source: "dev-simulation/media-worker",
      id: "evt-dev-001",
      time: new Date().toISOString(),
      data: {
        asset_id: job.assetId,
        job_id: job.id,
        function_id: "exr_inspector",
        success: true,
        metadata: { codec: "exr", resolution: { width: 4096, height: 2160 } },
      },
    },
  });
  assert.equal(res.statusCode, 200);

  const jobRes = await app.inject({ method: "GET", url: `/api/v1/jobs/${job.id}` });
  assert.equal(jobRes.json().job.status, "completed");

  await app.close();
});

test("POST /api/v1/events/vast-dataengine: rejects invalid event shape", async () => {
  const app = buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/events/vast-dataengine",
    body: { type: "wrong.event.type", data: {} },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});
```

**Step 2: Run test to verify it fails**

```bash
cd services/control-plane
node --test test/vast-events-route.test.ts
```

Expected: FAIL — 404 or route not found

**Step 3: Create the route**

Create `services/control-plane/src/routes/vast-events.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { resolveCorrelationId } from "../http/correlation.js";
import { sendError } from "../http/errors.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "../events/types.js";
import { processAssetEvent } from "../events/processor.js";

export async function registerVastEventsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
): Promise<void> {
  app.post(
    "/api/v1/events/vast-dataengine",
    {
      schema: {
        tags: ["events"],
        operationId: "v1PostVastDataEngineEvent",
        summary: "Receive VAST DataEngine completion event (dev simulation mode)",
        security: [{ ApiKeyAuth: [] as string[] }],
      },
    },
    async (request, reply) => {
      const body = request.body;

      if (!isVastDataEngineCompletionEvent(body)) {
        return sendError(request, reply, 400, "VALIDATION_ERROR", "invalid VAST DataEngine event shape", null);
      }

      const normalized = normalizeVastDataEngineEvent(body);
      const context = {
        correlationId: resolveCorrelationId(request),
        now: body.time,
      };

      const result = processAssetEvent(persistence, normalized, context, {
        enableRetryOnFailure: true,
      });

      if (!result.accepted && !result.duplicate) {
        return sendError(request, reply, 422, "EVENT_REJECTED", result.reason ?? "event rejected", null);
      }

      // Persist metadata if success
      if (normalized.eventType === "asset.processing.completed" && normalized.metadata) {
        const job = persistence.getJobById(normalized.jobId);
        if (job) {
          persistence.updateAsset(job.assetId, { metadata: normalized.metadata }, context);
        }
      }

      return reply.status(200).send({ accepted: true, duplicate: result.duplicate ?? false });
    },
  );
}
```

**Step 4: Register route in `src/app.ts`**

```typescript
import { registerVastEventsRoute } from "./routes/vast-events.js";

// Inside app.after():
void registerVastEventsRoute(app, persistence);
```

**Step 5: Run tests**

```bash
cd services/control-plane
node --test test/vast-events-route.test.ts
npx tsc --noEmit
```

Expected: All passing, 0 errors

**Step 6: Commit**

```bash
git add services/control-plane/src/routes/vast-events.ts \
        services/control-plane/src/app.ts \
        services/control-plane/test/vast-events-route.test.ts
git commit -m "feat(routes): POST /api/v1/events/vast-dataengine for dev simulation mode"
```

---

## Task 7: Run full test suite and verify

**Context:** Validate all existing tests still pass alongside the new ones. Fix any regressions.

---

**Step 1: Run control-plane full suite**

```bash
cd services/control-plane
node --test test/*.test.ts 2>&1 | tail -20
```

Expected: All existing tests pass + new tests pass. Note any failures.

**Step 2: Run media-worker full suite**

```bash
cd services/media-worker
python -m pytest tests/ -v
```

Expected: All passing.

**Step 3: TypeScript final check**

```bash
cd services/control-plane
npx tsc --noEmit
```

Expected: `0 errors`

**Step 4: Fix any regressions**

If any existing tests fail due to `sourceUri` being added to `WorkflowJob`:
- Update test fixtures that construct `WorkflowJob` objects to include `sourceUri: ""`
- Update `VastDbAdapter` to include `sourceUri` in its SQL `SELECT` and `INSERT` queries

**Step 5: Final commit**

```bash
git add -p  # stage only test/fixture fixes
git commit -m "fix(tests): update fixtures for sourceUri field on WorkflowJob"
```

---

## Summary

| Task | What it builds | New files |
|---|---|---|
| 1 | `VastDataEngineCompletionEvent` type + normalizer | `test/vast-event-types.test.ts` |
| 2 | `sourceUri` on `WorkflowJob` + claim response | `test/queue-claim-source-uri.test.ts` |
| 3 | `VastEventSubscriber` Kafka consumer | `src/events/vast-event-subscriber.ts`, `test/vast-event-subscriber.test.ts` |
| 4 | Wire subscriber into app lifecycle | `test/app-subscriber-lifecycle.test.ts` |
| 5 | Media worker dev simulation mode | (updates only) |
| 6 | `POST /api/v1/events/vast-dataengine` route | `src/routes/vast-events.ts`, `test/vast-events-route.test.ts` |
| 7 | Full suite validation | — |

**Environment variables added:**

| Var | Purpose |
|---|---|
| `VAST_EVENT_BROKER_URL` | Kafka broker address (omit for dev simulation) |
| `VAST_EVENT_BROKER_TOPIC` | Topic name (default: `assetharbor.dataengine.completed`) |
| `VAST_EVENT_BROKER_GROUP` | Consumer group ID (default: `assetharbor-control-plane`) |
| `VAST_EVENT_BROKER_SSL` | Set to `"true"` to enable SSL |
