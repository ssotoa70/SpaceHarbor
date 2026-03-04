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
    specversion: "1.0" as const,
    type: "vast.dataengine.pipeline.completed" as const,
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
    specversion: "1.0" as const,
    type: "vast.dataengine.pipeline.completed" as const,
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
