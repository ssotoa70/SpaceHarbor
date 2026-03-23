import test from "node:test";
import assert from "node:assert/strict";

import { parseVfxMetadata } from "../src/domain/vfx-metadata-parser.js";

test("parses valid VFX metadata fields", () => {
  const raw = {
    codec: "PIZ",
    channels: ["R", "G", "B", "A"],
    resolution: { width: 1920, height: 1080 },
    color_space: "ACEScg",
    frame_count: 120,
    bit_depth: 16,
    duration_ms: 5000,
    thumbnail_url: "https://cdn.example/thumb.jpg",
    proxy_url: "https://cdn.example/proxy.mp4",
    frame_range: { start: 1001, end: 1120 },
    frame_rate: 24,
    pixel_aspect_ratio: 1.0,
    display_window: { x: 0, y: 0, width: 1920, height: 1080 },
    data_window: { x: 0, y: 0, width: 1920, height: 1080 },
    compression_type: "piz",
    file_size_bytes: 52428800,
    md5_checksum: "abc123",
    frame_head_handle: 8,
    frame_tail_handle: 8
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.codec, "PIZ");
  assert.deepEqual(result.channels, ["R", "G", "B", "A"]);
  assert.deepEqual(result.resolution, { width: 1920, height: 1080 });
  assert.equal(result.color_space, "ACEScg");
  assert.equal(result.frame_count, 120);
  assert.equal(result.bit_depth, 16);
  assert.equal(result.frame_rate, 24);
  assert.equal(result.pixel_aspect_ratio, 1.0);
  assert.equal(result.file_size_bytes, 52428800);
  assert.equal(result.md5_checksum, "abc123");
  assert.equal(result.frame_head_handle, 8);
  assert.equal(result.frame_tail_handle, 8);
});

test("drops unknown fields", () => {
  const raw = {
    codec: "PIZ",
    unknown_field: "should be dropped",
    another_unknown: 42
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.codec, "PIZ");
  assert.equal("unknown_field" in result, false);
  assert.equal("another_unknown" in result, false);
});

test("ignores fields with wrong types", () => {
  const raw = {
    codec: 42,           // should be string
    frame_count: "120",  // should be number
    channels: "R,G,B",   // should be array
    resolution: "1920x1080" // should be object
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.codec, undefined);
  assert.equal(result.frame_count, undefined);
  assert.equal(result.channels, undefined);
  assert.equal(result.resolution, undefined);
});

test("handles empty input", () => {
  const result = parseVfxMetadata({});
  assert.deepEqual(result, {});
});

test("handles partial valid input", () => {
  const raw = {
    codec: "EXR",
    frame_count: 50,
    bad_field: true,
    resolution: { width: "not-a-number", height: 1080 }
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.codec, "EXR");
  assert.equal(result.frame_count, 50);
  assert.equal(result.resolution, undefined);
});

test("rejects channels with non-string elements", () => {
  const raw = {
    channels: ["R", 42, "B"]
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.channels, undefined);
});

test("validates window objects require all four fields", () => {
  const raw = {
    display_window: { x: 0, y: 0 },  // missing width/height
    data_window: { x: 0, y: 0, width: 1920, height: 1080 }  // valid
  };

  const result = parseVfxMetadata(raw);
  assert.equal(result.display_window, undefined);
  assert.deepEqual(result.data_window, { x: 0, y: 0, width: 1920, height: 1080 });
});
