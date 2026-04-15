import { describe, expect, it } from "vitest";

import { detectSchema, extractVideoFields } from "./schema-dispatch";

describe("detectSchema", () => {
  it("detects video@1 via $schema URL", () => {
    expect(detectSchema({
      $schema: "https://spaceharbor.dev/schemas/video-metadata-v1.json",
      schema_version: "1.0.0",
      metadata: { video_codec: "prores" },
    })).toBe("video@1");
  });

  it("detects video@1 via schema_version string alone", () => {
    expect(detectSchema({ schema_version: "1.0.0", metadata: {} })).toBe("video@1");
  });

  it("detects video@1 by flat shape when version header is missing", () => {
    expect(detectSchema({ video_codec: "h264", width: 1920, height: 1080 })).toBe("video@1");
  });

  it("detects frame@1 via numeric schema_version + parts array", () => {
    expect(detectSchema({
      schema_version: 1,
      file: { format: "openexr" },
      parts: [{ part_index: 0, width: 3840, height: 2160 }],
    })).toBe("frame@1");
  });

  it("detects legacy image-proxy shape", () => {
    expect(detectSchema({
      codec: "OpenEXR",
      resolution: { width: 1920, height: 1080 },
      frame_range: { start: 1, end: 48 },
    })).toBe("image-proxy@legacy");
  });

  it("returns unknown for completely foreign payloads", () => {
    expect(detectSchema({ some_random: "thing" })).toBe("unknown");
  });

  it("returns unknown and does not throw on null input", () => {
    expect(detectSchema(null)).toBe("unknown");
    expect(detectSchema(undefined)).toBe("unknown");
  });

  it("returns unknown and does not throw on non-object input", () => {
    expect(detectSchema(42)).toBe("unknown");
    expect(detectSchema("foo")).toBe("unknown");
    expect(detectSchema([])).toBe("unknown");
  });
});

describe("extractVideoFields", () => {
  it("returns the nested metadata bag when present", () => {
    const payload = {
      schema_version: "1.0.0",
      metadata: { video_codec: "prores", width: 3840 },
    };
    expect(extractVideoFields(payload)).toEqual({ video_codec: "prores", width: 3840 });
  });

  it("falls back to top-level fields when metadata bag is missing", () => {
    const payload = { video_codec: "h264", width: 1920 };
    expect(extractVideoFields(payload)).toEqual({ video_codec: "h264", width: 1920 });
  });

  it("excludes identity and envelope fields from the flat fallback", () => {
    const payload = {
      $schema: "foo",
      schema_version: "1.0.0",
      file_id: "abc",
      asset_id: "def",
      s3_key: "k",
      s3_bucket: "b",
      metadata_sidecar_s3_key: "s",
      original_filename: "f",
      video_codec: "h264",
    };
    const fields = extractVideoFields(payload);
    expect(fields.video_codec).toBe("h264");
    expect(fields.file_id).toBeUndefined();
    expect(fields.$schema).toBeUndefined();
  });

  it("returns empty object for null / non-object input", () => {
    expect(extractVideoFields(null)).toEqual({});
    expect(extractVideoFields(undefined)).toEqual({});
    expect(extractVideoFields(42 as unknown)).toEqual({});
  });
});
