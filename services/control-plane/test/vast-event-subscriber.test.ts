import test from "node:test";
import assert from "node:assert/strict";
import { VastEventSubscriber } from "../src/events/vast-event-subscriber.js";
import { buildApp } from "../src/app.js";
import type { Kafka } from "kafkajs";

// Minimal mock Kafka consumer
function makeMockKafka() {
  let handler: ((payload: { message: { value: Buffer } }) => Promise<void>) | null = null;

  const mockKafka = {
    consumer: () => ({
      connect: async () => {},
      subscribe: async () => {},
      run: async (opts: { eachMessage: typeof handler }) => {
        handler = opts!.eachMessage;
      },
      disconnect: async () => {},
    }),
  } as unknown as Kafka;

  return {
    kafka: mockKafka,
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
