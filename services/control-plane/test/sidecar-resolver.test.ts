import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseSourceUri,
  deriveSidecarKey,
  resolveSidecarLocation,
  InvalidSourceUriError,
} from "../src/storage/sidecar-resolver.js";

describe("parseSourceUri", () => {
  it("parses s3://bucket/key form", () => {
    assert.deepEqual(parseSourceUri("s3://sergio-spaceharbor/footage/shot.mov"), {
      bucket: "sergio-spaceharbor",
      key: "footage/shot.mov",
    });
  });

  it("accepts bare /key form and strips leading slash", () => {
    assert.deepEqual(parseSourceUri("/uploads/abc/shot.exr"), {
      bucket: null,
      key: "uploads/abc/shot.exr",
    });
  });

  it("accepts bare key form without leading slash", () => {
    assert.deepEqual(parseSourceUri("uploads/abc/shot.exr"), {
      bucket: null,
      key: "uploads/abc/shot.exr",
    });
  });

  it("throws on empty string", () => {
    assert.throws(() => parseSourceUri(""), InvalidSourceUriError);
  });

  it("throws on s3:// with empty bucket or key", () => {
    assert.throws(() => parseSourceUri("s3:///key"), InvalidSourceUriError);
  });

  it("throws on non-string input", () => {
    assert.throws(() => parseSourceUri(undefined as unknown as string), InvalidSourceUriError);
  });
});

describe("deriveSidecarKey", () => {
  it("handles top-level files", () => {
    assert.equal(deriveSidecarKey("shot.mov"), ".proxies/shot_metadata.json");
  });

  it("handles nested paths", () => {
    assert.equal(
      deriveSidecarKey("footage/shot_010/A001.mov"),
      "footage/shot_010/.proxies/A001_metadata.json",
    );
  });

  it("handles directories with dots in their names", () => {
    assert.equal(
      deriveSidecarKey("proj.v2/dailies/shot.exr"),
      "proj.v2/dailies/.proxies/shot_metadata.json",
    );
  });

  it("handles file without extension (stem == filename)", () => {
    assert.equal(deriveSidecarKey("a/b/README"), "a/b/.proxies/README_metadata.json");
  });

  it("throws on empty string", () => {
    assert.throws(() => deriveSidecarKey(""), InvalidSourceUriError);
  });

  it("throws when filename stem is empty (leading dot only)", () => {
    assert.throws(() => deriveSidecarKey("folder/.env"), InvalidSourceUriError);
  });
});

describe("resolveSidecarLocation", () => {
  it("resolves video sources to their metadata sidecar", () => {
    const result = resolveSidecarLocation("s3://sergio-spaceharbor/footage/shot_010/A001C003.mov");
    assert.deepEqual(result, {
      bucket: "sergio-spaceharbor",
      sourceKey: "footage/shot_010/A001C003.mov",
      sidecarKey: "footage/shot_010/.proxies/A001C003_metadata.json",
      fileKind: "video",
      filename: "A001C003.mov",
    });
  });

  it("resolves raw camera sources to their metadata sidecar", () => {
    const result = resolveSidecarLocation("s3://bucket/A001_001.R3D");
    assert.deepEqual(result, {
      bucket: "bucket",
      sourceKey: "A001_001.R3D",
      sidecarKey: ".proxies/A001_001_metadata.json",
      fileKind: "raw_camera",
      filename: "A001_001.R3D",
    });
  });

  it("resolves image sources to the same sidecar convention", () => {
    const result = resolveSidecarLocation("s3://bucket/shot.0042.exr");
    assert.equal(result?.fileKind, "image");
    assert.equal(result?.sidecarKey, ".proxies/shot.0042_metadata.json");
  });

  it("returns null for unsupported file kinds", () => {
    assert.equal(resolveSidecarLocation("s3://bucket/notes.pdf"), null);
    assert.equal(resolveSidecarLocation("s3://bucket/index.html"), null);
  });

  it("returns null for files without an extension", () => {
    assert.equal(resolveSidecarLocation("s3://bucket/README"), null);
  });

  it("handles bare-key form with no bucket", () => {
    const result = resolveSidecarLocation("/uploads/abc/shot.mov");
    assert.equal(result?.bucket, null);
    assert.equal(result?.fileKind, "video");
    assert.equal(result?.sidecarKey, "uploads/abc/.proxies/shot_metadata.json");
  });

  it("throws on invalid sourceUri", () => {
    assert.throws(() => resolveSidecarLocation(""), InvalidSourceUriError);
  });
});
