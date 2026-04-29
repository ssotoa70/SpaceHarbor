import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { AllFieldsPanel } from "./AllFieldsPanel";
import type { AssetRow } from "../types";

const videoAsset: AssetRow = {
  id: "asset-1",
  jobId: null,
  title: "lola-vfx-480-v2.mov",
  sourceUri: "s3://sergio-spaceharbor/uploads/lola-vfx-480-v2.mov",
  status: "pending",
};

const exrAsset: AssetRow = {
  id: "asset-2",
  jobId: null,
  title: "01_beauty_only.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/01_beauty_only.exr",
  status: "pending",
};

describe("AllFieldsPanel", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders FILE / MEDIA / ATTRIBUTES sections for a video with sidecar", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: videoAsset.id,
      sourceUri: videoAsset.sourceUri,
      fileKind: "video",
      pipeline: { functionName: "video-metadata-extractor", targetSchema: "video_metadata", targetTable: "files", sidecarSchemaId: "video@1" },
      sources: { db: "empty", sidecar: "ok" },
      dbRows: [],
      sidecar: {
        asset_id: videoAsset.id,
        s3_key: "uploads/lola-vfx-480-v2.mov",
        s3_bucket: "sergio-spaceharbor",
        metadata: {
          width: 640,
          height: 360,
          video_codec: "h264",
          duration_seconds: 94.7,
          fps: 23.97,
          color_space: "smpte170m",
          audio_channels: 2,
          metadata_embedding: Array.from({ length: 100 }, () => 0.1),
        },
      },
    });

    render(<AllFieldsPanel asset={videoAsset} />);

    await waitFor(() => expect(screen.getByText("FILE")).toBeInTheDocument());

    expect(screen.getByText("FILE")).toBeInTheDocument();
    expect(screen.getByText("MEDIA")).toBeInTheDocument();
    expect(screen.getByText("ATTRIBUTES")).toBeInTheDocument();

    // FILE
    expect(screen.getByText("Filename")).toBeInTheDocument();
    // Title appears in panel header AND as FILE/Filename value
    expect(screen.getAllByText("lola-vfx-480-v2.mov").length).toBeGreaterThanOrEqual(2);

    // MEDIA — derived video summary
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("640x360")).toBeInTheDocument();
    expect(screen.getByText("Codec")).toBeInTheDocument();
    // h264 appears in both MEDIA (Codec) and ATTRIBUTES (Video Codec) — at least once.
    expect(screen.getAllByText("h264").length).toBeGreaterThanOrEqual(1);

    // metadata_embedding must NOT render
    expect(screen.queryByText(/Metadata Embedding/)).toBeNull();
  });

  it("hides MEDIA group when no media-summary fields are present", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [
        {
          file_id: "abc",
          file_path: "sergio-spaceharbor/uploads/01_beauty_only.exr",
          // no resolution / compression / channel_count → MEDIA group gets nothing
        },
      ],
      sidecar: null,
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    await waitFor(() => expect(screen.getByText("FILE")).toBeInTheDocument());

    expect(screen.getByText("FILE")).toBeInTheDocument();
    expect(screen.getByText("ATTRIBUTES")).toBeInTheDocument();
    expect(screen.queryByText("MEDIA")).toBeNull();
  });

  it("renders 'All Fields ({count})' header reflecting total field count", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ format: "openexr", header_hash: "abc123" }],
      sidecar: null,
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    // FILE (Filename + Source) = 2, MEDIA (Format) = 1, ATTRIBUTES (Format + Header Hash) = 2 → 5 total
    await waitFor(() => expect(screen.getByText(/All Fields \(\d+\)/)).toBeInTheDocument());
    const header = screen.getByText(/All Fields \(\d+\)/).textContent;
    expect(header).toMatch(/All Fields \(5\)/);
  });

  it("filters numeric vector fields (embeddings) from ATTRIBUTES", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{
        format: "openexr",
        metadata_embedding: Array.from({ length: 768 }, (_, i) => i * 0.001),
      }],
      sidecar: null,
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    await waitFor(() => expect(screen.getByText(/All Fields/)).toBeInTheDocument());
    expect(screen.queryByText(/Metadata Embedding/i)).toBeNull();
    // The numeric values should not appear inline
    expect(screen.queryByText(/0\.001, 0\.002/)).toBeNull();
  });

  it("shows loading state while metadata is fetched", () => {
    vi.spyOn(api, "fetchAssetMetadata").mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<AllFieldsPanel asset={exrAsset} />);
    expect(screen.getByText(/Loading metadata/i)).toBeInTheDocument();
  });
});
