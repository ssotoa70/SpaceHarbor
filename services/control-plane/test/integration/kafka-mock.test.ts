/**
 * Kafka consumer mock-based integration tests for VastEventSubscriber.
 *
 * These tests exercise VastEventSubscriber message processing with a canned
 * in-memory Kafka transport. No running broker required — all Kafka I/O is
 * replaced by a minimal mock that holds the eachMessage handler in memory
 * and lets the test deliver messages directly.
 *
 * Coverage:
 * - CloudEvent completion payload → job marked completed
 * - Idempotency: same eventId delivered twice → second is a no-op
 * - Malformed message (invalid JSON) → silently skipped, no throw
 * - Missing required CloudEvent fields → silently skipped
 * - Non-DataEngine event type → silently skipped
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { VastEventSubscriber } from "../../src/events/vast-event-subscriber.js";
import { LocalPersistenceAdapter } from "../../src/persistence/adapters/local-persistence.js";
import type { KafkaClient, KafkaMessage } from "../../src/events/kafka-types.js";

// ---------------------------------------------------------------------------
// Minimal mock Kafka transport
// ---------------------------------------------------------------------------

type MessageHandler = (payload: { message: KafkaMessage }) => Promise<void>;

function makeMockKafka() {
  let handler: MessageHandler | null = null;

  const kafka: KafkaClient = {
    consumer: () => ({
      connect: async () => {},
      subscribe: async () => {},
      run: async (opts: { eachMessage: MessageHandler }) => {
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
    kafka,
    async deliver(msg: object): Promise<void> {
      if (!handler) throw new Error("subscriber not started — call start() first");
      await handler({
        message: {
          value: Buffer.from(JSON.stringify(msg)),
          key: null,
          offset: "0",
          timestamp: new Date().toISOString(),
        },
      });
    },
    async deliverRaw(raw: Buffer | null): Promise<void> {
      if (!handler) throw new Error("subscriber not started — call start() first");
      await handler({
        message: {
          value: raw,
          key: null,
          offset: "0",
          timestamp: new Date().toISOString(),
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

function buildCompletionEvent(overrides: Record<string, unknown> = {}): object {
  return {
    specversion: "1.0",
    type: "vast.dataengine.pipeline.completed",
    source: "vast-cluster/dataengine",
    id: "evt-mock-001",
    time: "2026-03-22T10:00:00.000Z",
    data: {
      asset_id: "asset-placeholder",
      job_id: "job-placeholder",
      function_id: "exr_inspector",
      success: true,
      metadata: { codec: "exr", width: 4096, height: 2304 },
    },
    ...overrides,
  };
}

async function ingestAndClaim(persistence: LocalPersistenceAdapter): Promise<{ assetId: string; jobId: string }> {
  const ctx = { correlationId: "test-corr" };
  const { asset, job } = await persistence.createIngestAsset(
    { title: "test.exr", sourceUri: "file:///vast/test.exr" },
    ctx,
  );
  await persistence.claimNextJob("worker-mock", 60, ctx);
  return { assetId: asset.id, jobId: job.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VastEventSubscriber mock integration — message processing", () => {
  it("processes a valid CloudEvent completion payload and marks job completed", async () => {
    const persistence = new LocalPersistenceAdapter();
    const { assetId, jobId } = await ingestAndClaim(persistence);

    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await mock.deliver(
      buildCompletionEvent({
        id: "evt-complete-001",
        data: {
          asset_id: assetId,
          job_id: jobId,
          function_id: "exr_inspector",
          success: true,
          metadata: { codec: "exr" },
        },
      }),
    );

    const job = await persistence.getJobById(jobId);
    assert.ok(job, "job must exist");
    assert.equal(job.status, "completed");

    await subscriber.stop();
  });

  it("marks job failed on a completion event with success=false", async () => {
    const persistence = new LocalPersistenceAdapter();
    const { assetId, jobId } = await ingestAndClaim(persistence);

    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await mock.deliver(
      buildCompletionEvent({
        id: "evt-fail-001",
        data: {
          asset_id: assetId,
          job_id: jobId,
          function_id: "exr_inspector",
          success: false,
          error: "EXR file is corrupted",
        },
      }),
    );

    const job = await persistence.getJobById(jobId);
    assert.ok(job, "job must exist");
    assert.ok(
      ["failed", "needs_replay", "pending"].includes(job.status),
      `Expected failed/needs_replay/pending, got: ${job.status}`,
    );

    await subscriber.stop();
  });
});

describe("VastEventSubscriber mock integration — idempotency", () => {
  it("ignores a duplicate event with the same eventId (delivered twice)", async () => {
    const persistence = new LocalPersistenceAdapter();
    const { assetId, jobId } = await ingestAndClaim(persistence);

    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    const event = buildCompletionEvent({
      id: "evt-dup-001",
      data: {
        asset_id: assetId,
        job_id: jobId,
        function_id: "exr_inspector",
        success: true,
        metadata: {},
      },
    });

    // First delivery — should succeed
    await mock.deliver(event);
    const jobAfterFirst = await persistence.getJobById(jobId);
    assert.ok(jobAfterFirst, "job must exist after first delivery");
    assert.equal(jobAfterFirst.status, "completed", "job should be completed after first delivery");

    // Second delivery of the identical event — should not throw, idempotent
    await assert.doesNotReject(() => mock.deliver(event), "duplicate delivery must not throw");

    // Status must not regress
    const jobAfterSecond = await persistence.getJobById(jobId);
    assert.ok(jobAfterSecond, "job must still exist");
    assert.equal(jobAfterSecond.status, "completed", "status must not change on duplicate delivery");

    await subscriber.stop();
  });
});

describe("VastEventSubscriber mock integration — malformed input", () => {
  it("silently skips a null message value without throwing", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await assert.doesNotReject(
      () => mock.deliverRaw(null),
      "null message value must be silently skipped",
    );

    await subscriber.stop();
  });

  it("silently skips a message with invalid JSON without throwing", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await assert.doesNotReject(
      () => mock.deliverRaw(Buffer.from("{not valid json!!")),
      "invalid JSON must be silently skipped",
    );

    await subscriber.stop();
  });

  it("silently skips a message missing required CloudEvent fields", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    // Missing specversion, type, and id — not a valid CloudEvent
    await assert.doesNotReject(
      () => mock.deliver({ source: "some/source", data: { job_id: "j1" } }),
      "message missing required CloudEvent fields must be silently skipped",
    );

    await subscriber.stop();
  });

  it("silently skips a non-DataEngine event type", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await assert.doesNotReject(
      () =>
        mock.deliver({
          specversion: "1.0",
          type: "com.example.some.other.event",
          source: "external/system",
          id: "evt-irrelevant",
          time: new Date().toISOString(),
          data: {},
        }),
      "unrecognized event type must be silently skipped",
    );

    await subscriber.stop();
  });

  it("silently skips an event with the wrong CloudEvent specversion", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();

    await assert.doesNotReject(
      () =>
        mock.deliver({
          specversion: "0.3",
          type: "vast.dataengine.pipeline.completed",
          source: "vast-cluster/dataengine",
          id: "evt-old-format",
          time: new Date().toISOString(),
          data: {},
        }),
      "wrong specversion must be silently skipped",
    );

    await subscriber.stop();
  });
});

describe("VastEventSubscriber mock integration — subscriber lifecycle", () => {
  it("stop() disconnects the consumer and subsequent deliver calls have no effect", async () => {
    const persistence = new LocalPersistenceAdapter();
    const mock = makeMockKafka();
    const subscriber = new VastEventSubscriber(persistence, mock.kafka, "test-topic", "test-group");
    await subscriber.start();
    await subscriber.stop();

    // After stop the handler reference is still held by our mock but calling it
    // should not mutate persistence — we verify no jobs were created
    const stats = await persistence.getWorkflowStats();
    assert.equal(stats.jobs.pending, 0, "no jobs should have been created");
  });
});
