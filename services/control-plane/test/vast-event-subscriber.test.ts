import test from "node:test";
import assert from "node:assert/strict";
import { VastEventSubscriber } from "../src/events/vast-event-subscriber.js";
import { buildApp } from "../src/app.js";
import type { KafkaClient } from "../src/events/kafka-types.js";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "../src/events/types.js";

// Minimal mock Kafka consumer
function makeMockKafka() {
  let handler: ((payload: { message: import("../src/events/kafka-types.js").KafkaMessage }) => Promise<void>) | null = null;

  const mockKafka: KafkaClient = {
    consumer: () => ({
      connect: async () => {},
      subscribe: async () => {},
      run: async (opts: { eachMessage: NonNullable<typeof handler> }) => {
        handler = opts.eachMessage;
      },
      disconnect: async () => {},
    }),
    producer: () => ({
      connect: async () => {},
      disconnect: async () => {},
      send: async () => {},
    }),
  };

  return {
    kafka: mockKafka,
    async deliver(msg: object) {
      if (handler) {
        await handler({
          message: {
            value: Buffer.from(JSON.stringify(msg)),
            key: null,
            offset: "0",
            timestamp: new Date().toISOString(),
          },
        });
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
  assert.equal(ingestRes.statusCode, 201);
  const { job } = ingestRes.json();

  // Claim the job (move to processing)
  await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });

  // Set up mock Kafka
  const mock = makeMockKafka();
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
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
  assert.equal(jobRes.json().status, "completed");

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
  assert.equal(ingestRes.statusCode, 201);
  const { job } = ingestRes.json();

  await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });

  const mock = makeMockKafka();
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
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
    ["failed", "needs_replay", "pending"].includes(jobRes.json().status),
    "job should be failed, queued for replay, or rescheduled to pending"
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
  assert.equal(ingestRes.statusCode, 201);
  const { job } = ingestRes.json();

  await app.inject({ method: "POST", url: "/api/v1/queue/claim", body: { workerId: "w", leaseSeconds: 30 } });

  const mock = makeMockKafka();
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
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
  assert.equal(jobRes.json().status, "completed");

  await subscriber.stop();
  await app.close();
});

test("VastEventSubscriber: non-DataEngine message is silently skipped", async () => {
  const app = buildApp();
  await app.ready();

  const mock = makeMockKafka();
  const persistence = (app as any).persistence;
  const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
  await subscriber.start();

  // Should not throw for unknown event type
  await mock.deliver({ type: "some.other.event", id: "x", data: {} });

  await subscriber.stop();
  await app.close();
});

// --- B.3: CloudEvent format verification tests ---

test("B.3: OLD flat format event is rejected by type guard", () => {
  const oldFlatEvent = {
    eventType: "mtlx_parsed",
    assetId: "abc123",
    parseResult: { material_name: "hero_paint" },
  };
  assert.equal(isVastDataEngineCompletionEvent(oldFlatEvent), false);
});

test("B.3: OLD otio flat format event is rejected by type guard", () => {
  const oldOtioEvent = {
    eventType: "otio_parsed",
    assetId: "def456",
    parseResult: { timeline_name: "main_edit", tracks: [] },
  };
  assert.equal(isVastDataEngineCompletionEvent(oldOtioEvent), false);
});

test("B.3: NEW CloudEvents 1.0 format is accepted and normalized", () => {
  const cloudEvent = {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "spaceharbor/mtlx-parser",
    id: "evt-b3-001",
    time: "2026-03-11T12:00:00Z",
    data: {
      asset_id: "abc123",
      job_id: "j456",
      function_id: "mtlx-parser",
      success: true,
      metadata: { material_name: "hero_paint" },
    },
  };

  assert.equal(isVastDataEngineCompletionEvent(cloudEvent), true);

  const normalized = normalizeVastDataEngineEvent(cloudEvent as any);
  assert.equal(normalized.eventId, "evt-b3-001");
  assert.equal(normalized.eventType, "asset.processing.completed");
  assert.equal(normalized.jobId, "j456");
  assert.deepEqual(normalized.metadata, { material_name: "hero_paint" });
});
