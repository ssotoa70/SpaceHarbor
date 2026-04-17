import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRenderPath } from "../src/scanner/path-parser.js";

describe("parseRenderPath — standard render paths", () => {
  it("parses a canonical EXR frame path", () => {
    const r = parseRenderPath("projects/PROJ_NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr");
    assert.ok(r);
    assert.equal(r.projectCode, "PROJ_NOVA");
    assert.equal(r.episodeCode, null);
    assert.equal(r.sequenceCode, "SEQ_010");
    assert.equal(r.shotCode, "SH040");
    assert.equal(r.versionLabel, "v001");
    assert.equal(r.filename, "beauty.0001.exr");
    assert.equal(r.extension, ".exr");
    assert.equal(r.isSentinel, false);
  });

  it("captures the optional episode segment", () => {
    const r = parseRenderPath("projects/PROJ/EP02/SEQ_010/SH040/render/v001/file.exr");
    assert.ok(r);
    assert.equal(r.episodeCode, "EP02");
    assert.equal(r.sequenceCode, "SEQ_010");
    assert.equal(r.shotCode, "SH040");
  });

  it("returns null for non-render paths", () => {
    assert.equal(parseRenderPath("projects/PROJ/dailies/preview.mov"), null);
  });

  it("returns null when version segment is missing", () => {
    assert.equal(parseRenderPath("projects/PROJ/SEQ/SHOT/beauty.0001.exr"), null);
  });

  it("accepts video extensions", () => {
    const r = parseRenderPath("projects/PROJ/SEQ_020/SH010/render/v003/output.mov");
    assert.ok(r);
    assert.equal(r.extension, ".mov");
    assert.equal(r.versionLabel, "v003");
  });

  it("accepts USD/Alembic 3D extensions", () => {
    for (const ext of [".usd", ".usda", ".usdc", ".usdz", ".abc"]) {
      const r = parseRenderPath(`projects/PROJ/SEQ/SHOT/render/v001/scene${ext}`);
      assert.ok(r, `expected ${ext} to parse`);
      assert.equal(r.extension, ext);
    }
  });

  it("rejects unsupported extensions on non-sentinel files", () => {
    assert.equal(parseRenderPath("projects/PROJ/SEQ/SHOT/render/v001/notes.txt"), null);
  });

  it("accepts version suffixes like v002_colorfix", () => {
    const r = parseRenderPath("projects/PROJ/SEQ/SHOT/render/v002_colorfix/file.exr");
    assert.ok(r);
    assert.equal(r.versionLabel, "v002_colorfix");
  });
});

describe("parseRenderPath — sentinel handling", () => {
  it("treats .ready as a sentinel and points filename at the render directory", () => {
    const r = parseRenderPath("projects/PROJ/SEQ_010/SH040/render/v001/sh040_v001.ready");
    assert.ok(r);
    assert.equal(r.isSentinel, true);
    assert.equal(r.extension, ".ready");
    assert.equal(r.filename, "projects/PROJ/SEQ_010/SH040/render/v001");
  });

  it("preserves project/sequence/shot/version codes on a sentinel hit", () => {
    const r = parseRenderPath("projects/SHOW1/EP04/SEQ_500/SH200/render/v005/done.ready");
    assert.ok(r);
    assert.equal(r.projectCode, "SHOW1");
    assert.equal(r.episodeCode, "EP04");
    assert.equal(r.sequenceCode, "SEQ_500");
    assert.equal(r.shotCode, "SH200");
    assert.equal(r.versionLabel, "v005");
    assert.equal(r.isSentinel, true);
  });
});

describe("parseRenderPath — edge cases", () => {
  it("handles uppercase extensions case-insensitively", () => {
    const r = parseRenderPath("projects/PROJ/SEQ/SHOT/render/v001/IMAGE.EXR");
    assert.ok(r);
    assert.equal(r.extension, ".exr");
  });

  it("returns null for empty string", () => {
    assert.equal(parseRenderPath(""), null);
  });

  it("returns null when key starts with extra prefix", () => {
    assert.equal(parseRenderPath("/projects/PROJ/SEQ/SHOT/render/v001/file.exr"), null);
  });
});
