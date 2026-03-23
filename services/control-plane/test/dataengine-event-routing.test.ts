/**
 * DataEngine Function Completion Event Routing Tests
 *
 * Tests that processVastFunctionCompletion routes events
 * correctly based on function_id.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { processVastFunctionCompletion } from "../src/events/processor.js";
import type { NormalizedVastEvent } from "../src/events/types.js";
import type { WriteContext } from "../src/persistence/types.js";

const CTX: WriteContext = { correlationId: "event-routing-test" };

function makeEvent(overrides: Partial<NormalizedVastEvent> = {}): NormalizedVastEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    eventType: "asset.processing.completed",
    jobId: "job-001",
    ...overrides,
  };
}

test("processVastFunctionCompletion routes exr_inspector events", async () => {
  const persistence = new LocalPersistenceAdapter();

  // Create an asset to update
  const { asset } = await persistence.createIngestAsset(
    { title: "test.exr", sourceUri: "s3://bucket/test.exr" },
    CTX
  );

  const event = makeEvent({
    metadata: { asset_id: asset.id, resolution: { width: 4096, height: 2160 } },
  });

  const result = await processVastFunctionCompletion(persistence, event, "exr_inspector", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.functionId, "exr_inspector");
  assert.equal(result.action, "metadata_updated");
});

test("processVastFunctionCompletion routes mtlx_parser events", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent({ metadata: { material_name: "HeroSkin" } });
  const result = await processVastFunctionCompletion(persistence, event, "mtlx_parser", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.action, "mtlx_parsed");
});

test("processVastFunctionCompletion routes otio_parser events", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent({ metadata: { timeline_name: "Edit_v3" } });
  const result = await processVastFunctionCompletion(persistence, event, "otio_parser", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.action, "otio_parsed");
});

test("processVastFunctionCompletion routes oiio_proxy_generator events", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent();
  const result = await processVastFunctionCompletion(persistence, event, "oiio_proxy_generator", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.action, "proxy_generated");
});

test("processVastFunctionCompletion routes scanner events", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent();
  const result = await processVastFunctionCompletion(persistence, event, "scanner", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.action, "scan_completed");
});

test("processVastFunctionCompletion handles unknown function", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent();
  const result = await processVastFunctionCompletion(persistence, event, "new_unknown_fn", CTX);

  assert.equal(result.accepted, true);
  assert.equal(result.action, "unknown_function");
});

test("processVastFunctionCompletion deduplicates events", async () => {
  const persistence = new LocalPersistenceAdapter();

  const event = makeEvent();

  const first = await processVastFunctionCompletion(persistence, event, "scanner", CTX);
  assert.equal(first.action, "scan_completed");

  const second = await processVastFunctionCompletion(persistence, event, "scanner", CTX);
  assert.equal(second.action, "duplicate");
});
