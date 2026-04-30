import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { AovLayerMapTable, buildLayerRows } from "./AovLayerMapTable";
import type { AssetRow } from "../types";

const exrAsset: AssetRow = {
  id: "asset-exr",
  jobId: null,
  title: "01_beauty_only.exr",
  sourceUri: "s3://bucket/01_beauty_only.exr",
  status: "pending",
};

describe("buildLayerRows", () => {
  it("returns empty array for null metadata", () => {
    expect(buildLayerRows(null)).toEqual([]);
  });

  it("returns empty array when neither aovs nor channels are present", () => {
    expect(buildLayerRows({ dbExtras: {} })).toEqual([]);
  });

  it("groups channels by layer_name (single layer = beauty)", () => {
    const rows = buildLayerRows({
      dbExtras: {
        channels: [
          { channel_name: "R", component_name: "R", channel_type: "HALF" },
          { channel_name: "G", component_name: "G", channel_type: "HALF" },
          { channel_name: "B", component_name: "B", channel_type: "HALF" },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("(root)");
    expect(rows[0].channels).toBe("RGB");
    expect(rows[0].depth).toBe("16f");
  });

  it("multi-layer: each unique layer_name → one row, depth derived", () => {
    const rows = buildLayerRows({
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "B", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Y", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Z", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === "diffuse")?.channels).toBe("RGB");
    expect(rows.find((r) => r.name === "diffuse")?.depth).toBe("32f");
    expect(rows.find((r) => r.name === "normals")?.channels).toBe("XYZ");
  });

  it("mixed precision rolls up to 'mixed' label", () => {
    const rows = buildLayerRows({
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "beauty", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "beauty", channel_type: "HALF" },
          { channel_name: "B", layer_name: "beauty", channel_type: "HALF" },
        ],
      },
    });
    // Dominant is HALF (2 of 3); label "16f (mixed)".
    expect(rows[0].depth).toContain("mixed");
  });

  it("prefers aovs[] over channels[] when populated", () => {
    const rows = buildLayerRows({
      dbExtras: {
        aovs: [
          { name: "beauty", components: "RGBA", depth_label: "32f", uncompressed_bytes: 2_700_000_000, category: "beauty" },
          { name: "depth", components: "Z", depth_label: "32f", uncompressed_bytes: 900_000_000, category: "data" },
        ],
        channels: [
          // Should be ignored when aovs[] is present
          { channel_name: "R", layer_name: "ignored", channel_type: "HALF" },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("beauty");
    expect(rows[0].sizeBytes).toBe(2_700_000_000);
    expect(rows[0].category).toBe("beauty");
    expect(rows[1].name).toBe("depth");
  });
});

describe("<AovLayerMapTable />", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders 'no data' state when channels and aovs are absent", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
    });
    render(<AovLayerMapTable asset={exrAsset} />);
    await screen.findByTestId("aov-empty");
    expect(screen.getByText(/hasn'?t produced channels/i)).toBeInTheDocument();
  });

  it("renders the layer map with rows when channels are present", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "B", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Y", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Z", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} />);
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("normals").length).toBeGreaterThanOrEqual(1);
    // Header counts 2 layers
    expect(screen.getByText(/2 LAYERS/)).toBeInTheDocument();
  });

  it("shows category badge when aovs[] populated", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        aovs: [
          { name: "beauty", components: "RGB", depth_label: "32f", category: "beauty", uncompressed_bytes: 1_000_000 },
          { name: "z_depth", components: "Z", depth_label: "32f", category: "data", uncompressed_bytes: 500_000 },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} />);
    await screen.findByTestId("aov-layer-map");
    // Category renders in uppercase per the styling
    expect(screen.getAllByText(/beauty/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/data/i).length).toBeGreaterThanOrEqual(1);
  });

  it("filters rows to only the matching layer when activeAov is set", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "G", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "B", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Y", layer_name: "normals", channel_type: "FLOAT" },
          { channel_name: "Z", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov="diffuse" />);
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("normals")).toBeNull();
    // Header still reflects the filtered count
    expect(screen.getByText(/1 LAYER/)).toBeInTheDocument();
  });

  it("renders all rows when activeAov is null (regression guard)", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
          { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov={null} />);
    await screen.findByTestId("aov-layer-map");
    expect(screen.getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("normals").length).toBeGreaterThanOrEqual(1);
  });

  it("renders an empty state when activeAov does not match any row", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
      dbExtras: {
        channels: [
          { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
        ],
      },
    });
    render(<AovLayerMapTable asset={exrAsset} activeAov="not-a-real-layer" />);
    await screen.findByTestId("aov-empty");
  });
});
