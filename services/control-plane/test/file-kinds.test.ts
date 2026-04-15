import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  inferFileKind,
  IMAGE_PIPELINE_EXTS,
  VIDEO_PIPELINE_EXTS,
  RAW_CAMERA_EXTS,
} from "../src/storage/file-kinds.js";

describe("inferFileKind", () => {
  it("classifies every registered image extension as image", () => {
    for (const ext of IMAGE_PIPELINE_EXTS) {
      assert.equal(inferFileKind(`file${ext}`), "image", `ext=${ext}`);
    }
  });

  it("classifies every registered video extension as video", () => {
    for (const ext of VIDEO_PIPELINE_EXTS) {
      assert.equal(inferFileKind(`shot${ext}`), "video", `ext=${ext}`);
    }
  });

  it("classifies raw camera formats as raw_camera", () => {
    for (const ext of RAW_CAMERA_EXTS) {
      assert.equal(inferFileKind(`clip${ext}`), "raw_camera", `ext=${ext}`);
    }
  });

  it("is case-insensitive on extensions", () => {
    assert.equal(inferFileKind("SHOT.MOV"), "video");
    assert.equal(inferFileKind("frame.EXR"), "image");
    assert.equal(inferFileKind("clip.R3D"), "raw_camera");
  });

  it("returns other for unsupported extensions", () => {
    assert.equal(inferFileKind("notes.pdf"), "other");
    assert.equal(inferFileKind("index.html"), "other");
  });

  it("returns other for files with no extension", () => {
    assert.equal(inferFileKind("README"), "other");
    assert.equal(inferFileKind(""), "other");
  });

  it("handles full paths, not just basenames", () => {
    assert.equal(inferFileKind("/a/b/c/shot_010.exr"), "image");
    assert.equal(inferFileKind("s3://bucket/key/movie.mxf"), "video");
  });
});
