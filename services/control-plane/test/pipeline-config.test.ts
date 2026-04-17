import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validatePipelineConfig,
  validatePipelineConfigList,
  InvalidPipelineConfigError,
  type DataEnginePipelineConfig,
} from "../src/data-engine/pipeline-config.js";

const validFrame: DataEnginePipelineConfig = {
  fileKind: "image",
  functionName: "frame-metadata-extractor",
  extensions: [".exr", ".dpx", ".tif", ".tiff"],
  targetSchema: "frame_metadata",
  targetTable: "frames",
  sidecarSchemaId: "frame@1",
  displayLabel: "Frame Metadata",
};

const validVideo: DataEnginePipelineConfig = {
  fileKind: "video",
  functionName: "video-metadata-extractor",
  extensions: [".mp4", ".mov", ".mxf"],
  targetSchema: "video_metadata",
  targetTable: "files",
  sidecarSchemaId: "video@1",
};

describe("validatePipelineConfig — happy path", () => {
  it("accepts a fully-formed config and returns it", () => {
    const result = validatePipelineConfig(validFrame);
    assert.deepEqual(result, validFrame);
  });

  it("normalizes extensions to lowercase", () => {
    const result = validatePipelineConfig({ ...validFrame, extensions: [".EXR", ".Dpx", ".TIF"] });
    assert.deepEqual(result.extensions, [".exr", ".dpx", ".tif"]);
  });

  it("dedupes repeated extensions", () => {
    const result = validatePipelineConfig({ ...validFrame, extensions: [".exr", ".EXR", ".exr"] });
    assert.deepEqual(result.extensions, [".exr"]);
  });

  it("trims whitespace from functionName, schemas, and label", () => {
    const result = validatePipelineConfig({
      ...validFrame,
      functionName: "  frame-metadata-extractor  ",
      targetSchema: " frame_metadata ",
      targetTable: " frames ",
      displayLabel: "  Frame Metadata  ",
    });
    assert.equal(result.functionName, "frame-metadata-extractor");
    assert.equal(result.targetSchema, "frame_metadata");
    assert.equal(result.targetTable, "frames");
    assert.equal(result.displayLabel, "Frame Metadata");
  });

  it("omits displayLabel when empty string is passed", () => {
    const result = validatePipelineConfig({ ...validFrame, displayLabel: "   " });
    assert.equal(result.displayLabel, undefined);
  });

  it("omits displayLabel when undefined", () => {
    const { displayLabel: _omit, ...withoutLabel } = validFrame;
    const result = validatePipelineConfig(withoutLabel);
    assert.equal(result.displayLabel, undefined);
  });
});

describe("validatePipelineConfig — rejection cases", () => {
  it("rejects non-object input", () => {
    assert.throws(() => validatePipelineConfig(null), InvalidPipelineConfigError);
    assert.throws(() => validatePipelineConfig("string"), InvalidPipelineConfigError);
    assert.throws(() => validatePipelineConfig(42), InvalidPipelineConfigError);
    assert.throws(() => validatePipelineConfig([]), InvalidPipelineConfigError);
  });

  it("rejects unknown fileKind", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, fileKind: "audio" }),
      /fileKind must be one of/,
    );
  });

  it("rejects missing or empty functionName", () => {
    assert.throws(() => validatePipelineConfig({ ...validFrame, functionName: "" }), /functionName/);
    assert.throws(() => validatePipelineConfig({ ...validFrame, functionName: "   " }), /functionName/);
    const { functionName: _omit, ...withoutName } = validFrame;
    assert.throws(() => validatePipelineConfig(withoutName), /functionName/);
  });

  it("rejects functionName longer than 128 chars", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, functionName: "x".repeat(129) }),
      /128 characters/,
    );
  });

  it("rejects empty extensions array", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, extensions: [] }),
      /extensions must be a non-empty array/,
    );
  });

  it("rejects extensions missing leading dot", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, extensions: ["exr"] }),
      /invalid/,
    );
  });

  it("rejects extensions with non-alphanumeric chars", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, extensions: [".ex r"] }),
      /invalid/,
    );
  });

  it("rejects missing targetSchema or targetTable", () => {
    const { targetSchema: _s, ...withoutSchema } = validFrame;
    assert.throws(() => validatePipelineConfig(withoutSchema), /targetSchema/);
    const { targetTable: _t, ...withoutTable } = validFrame;
    assert.throws(() => validatePipelineConfig(withoutTable), /targetTable/);
  });

  it("rejects malformed sidecarSchemaId", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, sidecarSchemaId: "not-a-schema-id" }),
      /sidecarSchemaId/,
    );
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, sidecarSchemaId: "" }),
      /sidecarSchemaId/,
    );
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, sidecarSchemaId: "@1" }),
      /sidecarSchemaId/,
    );
  });

  it("accepts a variety of valid sidecarSchemaId formats", () => {
    for (const id of ["frame@1", "video@1.0.0", "image-proxy@legacy", "my_schema@2"]) {
      assert.doesNotThrow(() => validatePipelineConfig({ ...validFrame, sidecarSchemaId: id }));
    }
  });

  it("rejects targetSchema with whitespace", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, targetSchema: "bogus with spaces" }),
      /targetSchema must be a valid identifier/,
    );
  });

  it("rejects targetTable starting with a digit", () => {
    assert.throws(
      () => validatePipelineConfig({ ...validFrame, targetTable: "1badtable" }),
      /targetTable must be a valid identifier/,
    );
  });
});

describe("validatePipelineConfigList", () => {
  it("accepts an empty list", () => {
    assert.deepEqual(validatePipelineConfigList([]), []);
  });

  it("accepts one image + one video pipeline", () => {
    const result = validatePipelineConfigList([validFrame, validVideo]);
    assert.equal(result.length, 2);
    assert.equal(result[0].fileKind, "image");
    assert.equal(result[1].fileKind, "video");
  });

  it("rejects non-array input", () => {
    assert.throws(() => validatePipelineConfigList({}), /must be an array/);
    assert.throws(() => validatePipelineConfigList(null), /must be an array/);
  });

  it("rejects duplicate fileKind entries", () => {
    const dup = { ...validFrame, functionName: "other" };
    assert.throws(
      () => validatePipelineConfigList([validFrame, dup]),
      /duplicate pipeline for fileKind=image/,
    );
  });

  it("rejects extensions claimed by multiple fileKinds", () => {
    const conflict = { ...validVideo, extensions: [".exr", ".mp4"] };
    assert.throws(
      () => validatePipelineConfigList([validFrame, conflict]),
      /claimed by both fileKind=image and fileKind=video/,
    );
  });

  it("surfaces per-entry errors with the index prefix", () => {
    assert.throws(
      () => validatePipelineConfigList([validFrame, { ...validVideo, fileKind: "bogus" }]),
      /pipelines\[1\]: fileKind must be one of/,
    );
  });

  it("normalizes extensions inside each entry", () => {
    const result = validatePipelineConfigList([
      { ...validFrame, extensions: [".EXR"] },
      { ...validVideo, extensions: [".MP4", ".MOV"] },
    ]);
    assert.deepEqual(result[0].extensions, [".exr"]);
    assert.deepEqual(result[1].extensions, [".mp4", ".mov"]);
  });
});
