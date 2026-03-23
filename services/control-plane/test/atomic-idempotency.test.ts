/**
 * Atomic Idempotency Marking Tests (CWE-367 / M13 Fix)
 *
 * Validates that the TOCTOU race condition in event deduplication has been
 * closed by using the atomic markIfNotProcessed() method instead of the
 * previous hasProcessedEvent() → markProcessedEvent() pattern.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { processAssetEvent, processVastFunctionCompletion } from "../src/events/processor.js";
import type { NormalizedAssetEvent, NormalizedVastEvent } from "../src/events/types.js";
import type { WriteContext } from "../src/persistence/types.js";

const CTX: WriteContext = { correlationId: "idempotency-test" };

// ---------------------------------------------------------------------------
// markIfNotProcessed — unit tests
// ---------------------------------------------------------------------------

test("markIfNotProcessed returns true for a new event", async () => {
  const persistence = new LocalPersistenceAdapter();
  const result = await persistence.markIfNotProcessed("evt-new-001");
  assert.equal(result, true);
});

test("markIfNotProcessed returns false for an already-marked event", async () => {
  const persistence = new LocalPersistenceAdapter();
  const first = await persistence.markIfNotProcessed("evt-dup-001");
  assert.equal(first, true, "first call should mark as new");

  const second = await persistence.markIfNotProcessed("evt-dup-001");
  assert.equal(second, false, "second call should detect duplicate");
});

test("markIfNotProcessed marks event as processed (hasProcessedEvent confirms)", async () => {
  const persistence = new LocalPersistenceAdapter();
  await persistence.markIfNotProcessed("evt-check-001");
  const has = await persistence.hasProcessedEvent("evt-check-001");
  assert.equal(has, true, "event should be visible via hasProcessedEvent");
});

test("markIfNotProcessed is idempotent across many calls", async () => {
  const persistence = new LocalPersistenceAdapter();
  const eventId = "evt-multi-001";

  const results: boolean[] = [];
  for (let i = 0; i < 10; i++) {
    results.push(await persistence.markIfNotProcessed(eventId));
  }

  assert.equal(results[0], true, "first call returns true");
  for (let i = 1; i < results.length; i++) {
    assert.equal(results[i], false, `call ${i + 1} returns false (duplicate)`);
  }
});

test("markIfNotProcessed handles distinct events independently", async () => {
  const persistence = new LocalPersistenceAdapter();

  const r1 = await persistence.markIfNotProcessed("evt-a");
  const r2 = await persistence.markIfNotProcessed("evt-b");
  const r3 = await persistence.markIfNotProcessed("evt-a");
  const r4 = await persistence.markIfNotProcessed("evt-b");

  assert.equal(r1, true, "evt-a first");
  assert.equal(r2, true, "evt-b first");
  assert.equal(r3, false, "evt-a duplicate");
  assert.equal(r4, false, "evt-b duplicate");
});

// ---------------------------------------------------------------------------
// processAssetEvent — idempotency via atomic marking
// ---------------------------------------------------------------------------

test("processAssetEvent uses atomic idempotency and detects duplicates", async () => {
  const persistence = new LocalPersistenceAdapter();
  const { job } = await persistence.createIngestAsset(
    { title: "test.exr", sourceUri: "s3://bucket/test.exr" },
    CTX,
  );

  const event: NormalizedAssetEvent = {
    eventId: "evt-asset-idem-001",
    eventType: "asset.processing.started",
    jobId: job.id,
  };

  const first = await processAssetEvent(persistence, event, CTX);
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.status, "processing");

  const second = await processAssetEvent(persistence, event, CTX);
  assert.equal(second.accepted, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.status, undefined, "duplicate should not carry status");
});

test("processAssetEvent marks event atomically before processing", async () => {
  const persistence = new LocalPersistenceAdapter();
  const { job } = await persistence.createIngestAsset(
    { title: "test.exr", sourceUri: "s3://bucket/test.exr" },
    CTX,
  );

  const event: NormalizedAssetEvent = {
    eventId: "evt-asset-idem-002",
    eventType: "asset.processing.completed",
    jobId: job.id,
  };

  // Transition to processing first
  await processAssetEvent(persistence, {
    eventId: "evt-prereq-002",
    eventType: "asset.processing.started",
    jobId: job.id,
  }, CTX);

  const result = await processAssetEvent(persistence, event, CTX);
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);

  // Verify the event is recorded as processed
  const isProcessed = await persistence.hasProcessedEvent("evt-asset-idem-002");
  assert.equal(isProcessed, true);
});

// ---------------------------------------------------------------------------
// processVastFunctionCompletion — idempotency via atomic marking
// ---------------------------------------------------------------------------

test("processVastFunctionCompletion uses atomic idempotency and detects duplicates", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event: NormalizedVastEvent = {
    eventId: "evt-vast-idem-001",
    eventType: "asset.processing.completed",
    jobId: "job-001",
    metadata: { timeline_name: "Edit_v3" },
  };

  const first = await processVastFunctionCompletion(persistence, event, "otio_parser", CTX);
  assert.equal(first.accepted, true);
  assert.equal(first.action, "otio_parsed");

  const second = await processVastFunctionCompletion(persistence, event, "otio_parser", CTX);
  assert.equal(second.accepted, true);
  assert.equal(second.action, "duplicate");
});

// ---------------------------------------------------------------------------
// Simulated concurrent access (single-process, interleaved awaits)
// ---------------------------------------------------------------------------

test("concurrent markIfNotProcessed calls — only one wins", async () => {
  const persistence = new LocalPersistenceAdapter();
  const eventId = "evt-concurrent-001";

  // Launch multiple "concurrent" calls. In a single Node.js process these
  // resolve synchronously inside the same microtask, so the atomic
  // check-and-set in LocalPersistenceAdapter guarantees exactly one true.
  const results = await Promise.all([
    persistence.markIfNotProcessed(eventId),
    persistence.markIfNotProcessed(eventId),
    persistence.markIfNotProcessed(eventId),
    persistence.markIfNotProcessed(eventId),
    persistence.markIfNotProcessed(eventId),
  ]);

  const trueCount = results.filter((r) => r === true).length;
  assert.equal(trueCount, 1, "exactly one call should return true (newly marked)");
});

test("concurrent processAssetEvent — only one processes, rest are duplicates", async () => {
  const persistence = new LocalPersistenceAdapter();
  const { job } = await persistence.createIngestAsset(
    { title: "concurrent.exr", sourceUri: "s3://bucket/concurrent.exr" },
    CTX,
  );

  const event: NormalizedAssetEvent = {
    eventId: "evt-concurrent-asset-001",
    eventType: "asset.processing.started",
    jobId: job.id,
  };

  const results = await Promise.all([
    processAssetEvent(persistence, event, CTX),
    processAssetEvent(persistence, event, CTX),
    processAssetEvent(persistence, event, CTX),
  ]);

  const nonDuplicate = results.filter((r) => !r.duplicate);
  const duplicates = results.filter((r) => r.duplicate);

  assert.equal(nonDuplicate.length, 1, "exactly one should process the event");
  assert.equal(duplicates.length, 2, "the rest should be duplicates");
  assert.equal(nonDuplicate[0].accepted, true);
  assert.equal(nonDuplicate[0].status, "processing");
});
