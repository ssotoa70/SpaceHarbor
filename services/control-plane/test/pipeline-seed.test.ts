import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  planSeed,
  FileSeedLoader,
  DEFAULT_SEED_PATH,
  type SeedLoader,
} from "../src/data-engine/pipeline-seed.js";
import type { DataEnginePipelineConfig } from "../src/data-engine/pipeline-config.js";

const validFrame: DataEnginePipelineConfig = {
  fileKind: "image",
  functionName: "frame-metadata-extractor",
  extensions: [".exr"],
  targetSchema: "frame_metadata",
  targetTable: "files",
  sidecarSchemaId: "frame@1",
};

function loaderFromValue(value: unknown): SeedLoader {
  return { load: () => value };
}

function throwingLoader(message: string): SeedLoader {
  return {
    load: () => {
      throw new Error(message);
    },
  };
}

describe("planSeed", () => {
  it("seeds when list is empty and sentinel is false", () => {
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader: loaderFromValue([validFrame]),
    });
    assert.equal(result.action, "seeded");
    if (result.action === "seeded") {
      assert.equal(result.pipelines.length, 1);
      assert.equal(result.pipelines[0].functionName, "frame-metadata-extractor");
    }
  });

  it("skips when sentinel is true even if list is empty", () => {
    const result = planSeed({
      current: [],
      alreadySeeded: true,
      loader: loaderFromValue([validFrame]),
    });
    assert.equal(result.action, "skipped");
    if (result.action === "skipped") {
      assert.equal(result.reason, "already-seeded");
    }
  });

  it("skips when list is non-empty and sentinel is false (legacy data)", () => {
    const result = planSeed({
      current: [validFrame],
      alreadySeeded: false,
      loader: loaderFromValue([validFrame, validFrame]), // different from current
    });
    assert.equal(result.action, "skipped");
    if (result.action === "skipped") {
      assert.equal(result.reason, "nonempty-without-sentinel");
    }
  });

  it("does NOT re-seed after an admin deletes all pipelines", () => {
    // Admin scenario: they had pipelines, then cleared them via PUT.
    // Sentinel stays true — seed must NOT overwrite their empty choice.
    const result = planSeed({
      current: [],
      alreadySeeded: true,
      loader: loaderFromValue([validFrame]),
    });
    assert.equal(result.action, "skipped");
  });

  it("fails with descriptive reason when loader throws", () => {
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader: throwingLoader("ENOENT: no such file"),
    });
    assert.equal(result.action, "failed");
    if (result.action === "failed") {
      assert.match(result.reason, /could not load seed file/);
      assert.match(result.reason, /ENOENT/);
    }
  });

  it("fails with descriptive reason when seed content is invalid", () => {
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader: loaderFromValue([{ ...validFrame, fileKind: "bogus" }]),
    });
    assert.equal(result.action, "failed");
    if (result.action === "failed") {
      assert.match(result.reason, /seed file failed validation/);
      assert.match(result.reason, /fileKind must be one of/);
    }
  });

  it("fails when seed is not an array", () => {
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader: loaderFromValue({ not: "an array" }),
    });
    assert.equal(result.action, "failed");
  });

  it("seeds an empty array cleanly (explicit zero-pipeline config)", () => {
    // Edge case: a production site might ship with an empty seed file
    // to force admins to configure pipelines manually. Empty seed is
    // valid — it just means "seed ran and wrote nothing".
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader: loaderFromValue([]),
    });
    assert.equal(result.action, "seeded");
    if (result.action === "seeded") {
      assert.equal(result.pipelines.length, 0);
    }
  });
});

describe("FileSeedLoader", () => {
  it("loads and parses the default-pipelines.json file that ships with the image", () => {
    const loader = new FileSeedLoader(DEFAULT_SEED_PATH);
    const raw = loader.load();
    assert.ok(Array.isArray(raw), "default pipelines must be an array");
    const arr = raw as Array<Record<string, unknown>>;
    // Minimum sanity: at least one entry, and every entry has the
    // required fields. Full validation is covered by planSeed tests.
    assert.ok(arr.length > 0, "default seed file should not be empty");
    for (const entry of arr) {
      assert.equal(typeof entry.fileKind, "string");
      assert.equal(typeof entry.functionName, "string");
      assert.ok(Array.isArray(entry.extensions));
      assert.equal(typeof entry.targetSchema, "string");
      assert.equal(typeof entry.targetTable, "string");
      assert.equal(typeof entry.sidecarSchemaId, "string");
    }
  });

  it("the shipped default file passes full validation via planSeed", () => {
    // This is a belt-and-suspenders test: if someone edits the JSON
    // and breaks it, this test fails before deploy rather than after.
    const loader = new FileSeedLoader(DEFAULT_SEED_PATH);
    const result = planSeed({
      current: [],
      alreadySeeded: false,
      loader,
    });
    assert.equal(result.action, "seeded", result.action === "failed" ? result.reason : "");
    if (result.action === "seeded") {
      // Sanity: we expect at least the three pipelines we authored
      assert.ok(result.pipelines.length >= 3);
      const kinds = result.pipelines.map((p) => p.fileKind).sort();
      assert.deepEqual(kinds, ["image", "raw_camera", "video"]);
    }
  });
});
