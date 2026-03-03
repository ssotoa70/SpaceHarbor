import test from "node:test";
import assert from "node:assert/strict";

import {
  DataEnginePipeline,
  FunctionRegistry,
  ExrInspectorFunction,
  SchemaValidationError,
} from "../src/data-engine/index.js";

import type {
  DataEngineFunction,
  PipelineAuditSink,
  ExecutionResult,
} from "../src/data-engine/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<{ jobId: string; assetId: string }>) {
  return {
    jobId: overrides?.jobId ?? "job-001",
    assetId: overrides?.assetId ?? "asset-001",
  };
}

/** Minimal function that echoes input with an extra field. */
class EchoFunction implements DataEngineFunction {
  readonly id = "echo";
  readonly version = "0.1.0";
  readonly description = "Echo input for testing";
  readonly inputSchema = {
    type: "object" as const,
    properties: { message: { type: "string" as const } },
    required: ["message"],
  };
  readonly outputSchema = {
    type: "object" as const,
    properties: { message: { type: "string" as const }, echoed: { type: "string" as const } },
  };
  async execute(input: Record<string, unknown>) {
    return { message: input.message as string, echoed: "true" };
  }
}

/** Function that always throws. */
class FailingFunction implements DataEngineFunction {
  readonly id = "failing";
  readonly version = "0.1.0";
  readonly description = "Always fails";
  readonly inputSchema = { type: "object" as const };
  readonly outputSchema = { type: "object" as const };
  async execute(): Promise<Record<string, unknown>> {
    throw new Error("intentional failure");
  }
}

// ---------------------------------------------------------------------------
// 1. Registry
// ---------------------------------------------------------------------------

test("registry: register and retrieve a function", () => {
  const registry = new FunctionRegistry();
  const fn = new EchoFunction();
  registry.register(fn);

  assert.equal(registry.has("echo"), true);
  assert.equal(registry.get("echo"), fn);
  assert.equal(registry.size, 1);
});

test("registry: duplicate registration throws", () => {
  const registry = new FunctionRegistry();
  registry.register(new EchoFunction());
  assert.throws(
    () => registry.register(new EchoFunction()),
    /already registered/,
  );
});

test("registry: list returns summaries without execute", () => {
  const registry = new FunctionRegistry();
  registry.register(new EchoFunction());
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "echo");
  assert.equal(list[0].version, "0.1.0");
  assert.ok(list[0].inputSchema);
  assert.ok(list[0].outputSchema);
  // Summary should not carry the execute method
  assert.equal((list[0] as any).execute, undefined);
});

// ---------------------------------------------------------------------------
// 2. Pipeline — happy path
// ---------------------------------------------------------------------------

test("pipeline: execute returns successful result with output", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new EchoFunction());

  const result = await pipeline.execute(
    "echo",
    { message: "hello" },
    makeContext(),
  );

  assert.equal(result.success, true);
  assert.equal(result.functionId, "echo");
  assert.ok(result.durationMs >= 0);
  assert.deepEqual(result.output, { message: "hello", echoed: "true" });
});

// ---------------------------------------------------------------------------
// 3. Pipeline — function not found
// ---------------------------------------------------------------------------

test("pipeline: execute throws when function not found", async () => {
  const pipeline = new DataEnginePipeline();
  await assert.rejects(
    () => pipeline.execute("nonexistent", {}, makeContext()),
    /not found in registry/,
  );
});

// ---------------------------------------------------------------------------
// 4. Pipeline — input validation
// ---------------------------------------------------------------------------

test("pipeline: rejects input that violates schema", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new EchoFunction());

  // 'message' is required but missing
  await assert.rejects(
    () => pipeline.execute("echo", {}, makeContext()),
    SchemaValidationError,
  );
});

// ---------------------------------------------------------------------------
// 5. Pipeline — function failure returns error result
// ---------------------------------------------------------------------------

test("pipeline: function failure returns error result", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new FailingFunction());

  const result = await pipeline.execute("failing", {}, makeContext());
  assert.equal(result.success, false);
  assert.equal(result.error, "intentional failure");
});

// ---------------------------------------------------------------------------
// 6. Pipeline — audit sink receives records
// ---------------------------------------------------------------------------

test("pipeline: audit sink records success and failure", async () => {
  const auditEntries: Record<string, unknown>[] = [];
  const sink: PipelineAuditSink = {
    async recordAudit(entry) {
      auditEntries.push(entry);
    },
  };

  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new EchoFunction());
  pipeline.registry.register(new FailingFunction());

  // Success
  await pipeline.execute("echo", { message: "hi" }, makeContext(), sink);
  // Failure
  await pipeline.execute("failing", {}, makeContext(), sink);

  assert.equal(auditEntries.length, 2);

  const success = auditEntries[0] as any;
  assert.equal(success.action, "data_engine_execute");
  assert.equal(success.assetId, "asset-001");
  assert.equal(success.details.success, true);
  assert.equal(success.details.function_id, "echo");

  const failure = auditEntries[1] as any;
  assert.equal(failure.details.error, "intentional failure");
});

// ---------------------------------------------------------------------------
// 7. exrinspector — mock execution returns VFX metadata
// ---------------------------------------------------------------------------

test("exrinspector: returns expected VFX metadata fields (mock)", async () => {
  // Ensure mock path (no VAST_DATA_ENGINE_URL)
  const prev = process.env.VAST_DATA_ENGINE_URL;
  delete process.env.VAST_DATA_ENGINE_URL;

  try {
    const pipeline = new DataEnginePipeline();
    pipeline.registry.register(new ExrInspectorFunction());

    const result = await pipeline.execute(
      "exr_inspector",
      { asset_id: "asset-exr-001", file_path: "/vast/renders/shot_010/frame.1001.exr" },
      makeContext({ assetId: "asset-exr-001" }),
    );

    assert.equal(result.success, true);
    const out = result.output!;

    // Core metadata
    assert.equal(out.codec, "exr");
    assert.ok(Array.isArray(out.channels));
    assert.ok((out.channels as string[]).includes("R"));
    assert.equal((out.resolution as any).width, 4096);
    assert.equal((out.resolution as any).height, 2160);
    assert.equal(out.bit_depth, 32);
    assert.equal(out.color_space, "linear");

    // VFX-critical fields (specialist validation)
    assert.ok(out.frame_range);
    assert.equal((out.frame_range as any).first, 1001);
    assert.equal((out.frame_range as any).last, 1240);
    assert.equal(out.frame_rate, 24.0);
    assert.equal(out.pixel_aspect_ratio, 1.0);
    assert.ok(out.display_window);
    assert.ok(out.data_window);
    assert.equal(out.compression_type, "PIZ");
    assert.ok(typeof out.file_size_bytes === "number");
    assert.ok(typeof out.checksum === "string");
  } finally {
    if (prev !== undefined) process.env.VAST_DATA_ENGINE_URL = prev;
  }
});

// ---------------------------------------------------------------------------
// 8. exrinspector — input validation
// ---------------------------------------------------------------------------

test("exrinspector: rejects input missing required fields", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new ExrInspectorFunction());

  await assert.rejects(
    () => pipeline.execute("exr_inspector", { asset_id: "a" }, makeContext()),
    SchemaValidationError,
  );
});

// ---------------------------------------------------------------------------
// 9. Pipeline — executeSequence chains functions
// ---------------------------------------------------------------------------

test("pipeline: executeSequence chains multiple functions", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new EchoFunction());

  // Register a second function that transforms
  const upper: DataEngineFunction = {
    id: "upper",
    version: "0.1.0",
    description: "Uppercase message",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    outputSchema: { type: "object", properties: { message: { type: "string" } } },
    async execute(input) {
      return { message: (input.message as string).toUpperCase() };
    },
  };
  pipeline.registry.register(upper);

  const results = await pipeline.executeSequence(
    ["echo", "upper"],
    { message: "hello" },
    makeContext(),
  );

  assert.equal(results.length, 2);
  assert.equal(results[0].success, true);
  assert.equal(results[1].success, true);
  assert.equal((results[1].output as any).message, "HELLO");
});

// ---------------------------------------------------------------------------
// 10. Pipeline — executeSequence stops on failure
// ---------------------------------------------------------------------------

test("pipeline: executeSequence stops on first failure", async () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new FailingFunction());
  pipeline.registry.register(new EchoFunction());

  const results = await pipeline.executeSequence(
    ["failing", "echo"],
    { message: "hi" },
    makeContext(),
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
});

// ---------------------------------------------------------------------------
// 11. listAvailable / getSchema
// ---------------------------------------------------------------------------

test("pipeline: listAvailable and getSchema", () => {
  const pipeline = new DataEnginePipeline();
  pipeline.registry.register(new ExrInspectorFunction());

  const available = pipeline.listAvailable();
  assert.equal(available.length, 1);
  assert.equal(available[0].id, "exr_inspector");

  const schema = pipeline.getSchema("exr_inspector");
  assert.ok(schema);
  assert.equal(schema!.id, "exr_inspector");

  assert.equal(pipeline.getSchema("nonexistent"), undefined);
});

// ---------------------------------------------------------------------------
// 12. New functions can be added without pipeline refactoring
// ---------------------------------------------------------------------------

test("extensibility: adding a new function requires no pipeline changes", () => {
  const pipeline = new DataEnginePipeline();

  // Simulate adding a brand-new function at startup time
  const checksumFn: DataEngineFunction = {
    id: "checksum",
    version: "1.0.0",
    description: "Compute file checksum",
    inputSchema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
    outputSchema: { type: "object", properties: { md5: { type: "string" } } },
    async execute(input) {
      return { md5: "abc123" };
    },
  };

  pipeline.registry.register(checksumFn);
  assert.equal(pipeline.registry.has("checksum"), true);
  assert.equal(pipeline.listAvailable().length, 1);
});
