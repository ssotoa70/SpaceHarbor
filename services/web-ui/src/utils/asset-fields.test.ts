import { describe, expect, it } from "vitest";

import {
  buildAssetFields,
  formatMetaFieldValue,
  groupFields,
  humanizeMetaLabel,
  shouldSkipField,
  type AssetField,
} from "./asset-fields";
import type { AssetRow } from "../types";
import type { AssetMetadataResponse } from "../api";

const mkAsset = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: "a1",
  jobId: null,
  title: "test.exr",
  sourceUri: "s3://bucket/test.exr",
  status: "pending",
  thumbnail: null,
  proxy: null,
  metadata: undefined,
  productionMetadata: null as unknown as AssetRow["productionMetadata"],
  annotationHook: { enabled: false, provider: null, contextId: null },
  handoffChecklist: {
    releaseNotesReady: false,
    verificationComplete: false,
    commsDraftReady: false,
    ownerAssigned: false,
  },
  handoff: { status: "not_ready", owner: null, lastUpdatedAt: null },
  ...over,
});

const mkMetadata = (over: Partial<AssetMetadataResponse> = {}): AssetMetadataResponse => ({
  assetId: "a1",
  sourceUri: "s3://bucket/test.exr",
  fileKind: "image",
  pipeline: null,
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [],
  sidecar: null,
  ...over,
});

describe("humanizeMetaLabel", () => {
  it("snake_case → Title Case", () => {
    expect(humanizeMetaLabel("frame_count")).toBe("Frame Count");
  });

  it("camelCase → Title Case", () => {
    expect(humanizeMetaLabel("frameCount")).toBe("Frame Count");
  });

  it("preserves already-cased labels", () => {
    expect(humanizeMetaLabel("FPS")).toBe("FPS");
  });
});

describe("formatMetaFieldValue", () => {
  it("booleans → Yes/No", () => {
    expect(formatMetaFieldValue(true)).toBe("Yes");
    expect(formatMetaFieldValue(false)).toBe("No");
  });

  it("null/undefined → empty string", () => {
    expect(formatMetaFieldValue(null)).toBe("");
    expect(formatMetaFieldValue(undefined)).toBe("");
  });

  it("arrays → comma-joined", () => {
    expect(formatMetaFieldValue(["a", "b", "c"])).toBe("a, b, c");
  });

  it("objects → JSON-serialized", () => {
    expect(formatMetaFieldValue({ x: 1 })).toBe('{"x":1}');
  });
});

describe("shouldSkipField", () => {
  it("skips embedding vectors by name pattern", () => {
    expect(shouldSkipField("metadata_embedding", [0.1, 0.2])).toBe(true);
    expect(shouldSkipField("text_embedding", [0.1])).toBe(true);
    expect(shouldSkipField("embedding", [])).toBe(true);
  });

  it("skips schema housekeeping keys", () => {
    expect(shouldSkipField("$schema", "https://x.com/schema")).toBe(true);
    expect(shouldSkipField("schema_version", "1.0.0")).toBe(true);
    expect(shouldSkipField("generator_version", "1.0.0")).toBe(true);
  });

  it("skips long numeric arrays heuristically (vectors)", () => {
    const vec = Array.from({ length: 100 }, (_, i) => i * 0.01);
    expect(shouldSkipField("any_field", vec)).toBe(true);
  });

  it("keeps short arrays of mixed types", () => {
    expect(shouldSkipField("audio_tracks", ["en", "fr"])).toBe(false);
  });

  it("keeps regular fields", () => {
    expect(shouldSkipField("width", 1920)).toBe(false);
    expect(shouldSkipField("codec", "h264")).toBe(false);
  });
});

describe("buildAssetFields", () => {
  it("FILE group always contains Filename + Source", () => {
    const fields = buildAssetFields(mkAsset(), null);
    const file = fields.filter((f) => f.group === "FILE");
    expect(file).toHaveLength(2);
    expect(file[0]).toEqual({ group: "FILE", label: "Filename", value: "test.exr" });
    expect(file[1].label).toBe("Source");
  });

  it("MEDIA group surfaces video-specific fields when fileKind=video", () => {
    const meta = mkMetadata({
      fileKind: "video",
      sources: { db: "ok", sidecar: "ok" },
      sidecar: {
        metadata: {
          width: 1920,
          height: 1080,
          video_codec: "h264",
          duration_seconds: 60,
          fps: 24,
          audio_channels: 2,
        },
      },
    });
    const fields = buildAssetFields(mkAsset({ title: "x.mov" }), meta);
    const media = fields.filter((f) => f.group === "MEDIA");
    const labels = media.map((f) => f.label);
    expect(labels).toContain("Resolution");
    expect(labels).toContain("Codec");
    expect(labels).toContain("FPS");
    expect(labels).toContain("Audio Channels");
    expect(media.find((f) => f.label === "Resolution")?.value).toBe("1920x1080");
  });

  it("MEDIA omits fields not present (no empty rows)", () => {
    const meta = mkMetadata({ fileKind: "video", sidecar: { metadata: { fps: 24 } } });
    const media = buildAssetFields(mkAsset(), meta).filter((f) => f.group === "MEDIA");
    expect(media.map((f) => f.label)).toEqual(["FPS"]);
  });

  it("ATTRIBUTES group hides metadata_embedding", () => {
    const meta = mkMetadata({
      dbRows: [{ width: 1920, metadata_embedding: Array.from({ length: 100 }, () => 0.1) }],
    });
    const attrs = buildAssetFields(mkAsset(), meta).filter((f) => f.group === "ATTRIBUTES");
    expect(attrs.find((f) => f.label.toLowerCase().includes("embedding"))).toBeUndefined();
    expect(attrs.find((f) => f.label === "Width")?.value).toBe("1920");
  });

  it("ATTRIBUTES group hides $schema/schema_version/generator_version", () => {
    const meta = mkMetadata({
      sidecar: { $schema: "https://x", schema_version: "1.0", generator_version: "1.0", asset_id: "a1" },
    });
    const attrs = buildAssetFields(mkAsset(), meta).filter((f) => f.group === "ATTRIBUTES");
    const labels = attrs.map((f) => f.label);
    expect(labels).not.toContain("$schema");
    expect(labels).not.toContain("Schema Version");
    expect(labels).not.toContain("Generator Version");
    expect(labels).toContain("Asset Id");
  });

  it("flattens sidecar.metadata one level into ATTRIBUTES", () => {
    const meta = mkMetadata({
      sidecar: { asset_id: "x", metadata: { width: 1920, height: 1080 } },
    });
    const attrs = buildAssetFields(mkAsset(), meta).filter((f) => f.group === "ATTRIBUTES");
    expect(attrs.find((f) => f.label === "Width")?.value).toBe("1920");
    expect(attrs.find((f) => f.label === "Height")?.value).toBe("1080");
    expect(attrs.find((f) => f.label === "Asset Id")?.value).toBe("x");
  });

  it("returns FILE-only when no metadata is available", () => {
    const fields = buildAssetFields(mkAsset(), null);
    const groups = new Set(fields.map((f) => f.group));
    expect(groups.has("FILE")).toBe(true);
    expect(groups.has("MEDIA")).toBe(false);
    expect(groups.has("ATTRIBUTES")).toBe(false);
  });
});

describe("groupFields", () => {
  it("preserves insertion order across groups", () => {
    const fields: AssetField[] = [
      { group: "FILE", label: "A", value: "1" },
      { group: "MEDIA", label: "B", value: "2" },
      { group: "FILE", label: "C", value: "3" },
    ];
    const groups = groupFields(fields);
    expect([...groups.keys()]).toEqual(["FILE", "MEDIA"]);
    expect(groups.get("FILE")?.map((f) => f.label)).toEqual(["A", "C"]);
  });
});
