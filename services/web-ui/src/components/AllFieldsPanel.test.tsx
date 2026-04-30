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

const unknownAsset: AssetRow = {
  id: "asset-3",
  jobId: null,
  title: "notes.txt",
  sourceUri: "s3://sergio-spaceharbor/uploads/notes.txt",
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

  it("video pipeline → renders VideoMetadataRenderer with semantic sections", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: videoAsset.id,
      sourceUri: videoAsset.sourceUri,
      fileKind: "video",
      pipeline: { functionName: "video-metadata-extractor", targetSchema: "video_metadata", targetTable: "files", sidecarSchemaId: "video@1" },
      sources: { db: "empty", sidecar: "ok" },
      dbRows: [],
      sidecar: {
        $schema: "https://vastdata.com/schemas/video-metadata-sidecar/v1.json",
        schema_version: "1.0.0",
        metadata: {
          container_format: "MPEG-4",
          width: 640,
          height: 360,
          video_codec: "h264",
          fps: 23.97,
          color_space: "smpte170m",
          audio_codec: "aac",
          audio_channels: 2,
          metadata_embedding: Array.from({ length: 100 }, () => 0.1),
        },
      },
    });

    render(<AllFieldsPanel asset={videoAsset} />);

    await waitFor(() => expect(screen.getByText("File")).toBeInTheDocument());
    // VideoMetadataRenderer surfaces the standard sections. Use unique titles
    // (Audio, Editorial) — "Container" and "Video" appear as both section
    // titles AND field labels.
    expect(screen.getByText("Audio")).toBeInTheDocument();
    // "Editorial" hidden because mock data has no timecode/reel/clip fields,
    // and MetaGroup auto-hides empty sections — that IS the desired behavior.
    expect(screen.queryByText("Editorial")).toBeNull();
    // The big embedding vector must not render as a flat row.
    expect(screen.queryByText(/Metadata Embedding/i)).toBeNull();
  });

  it("frame pipeline → renders FrameMetadataRenderer (Sequence + Color Science) when dbExtras populated", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: { functionName: "frame-metadata-extractor", targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{
        file_id: "abc",
        file_path: "sergio-spaceharbor/uploads/01_beauty_only.exr",
        format: "openexr",
        size_bytes: 6906,
        is_deep: false,
        multipart_count: 1,
      }],
      sidecar: null,
      dbExtras: {
        parts: [{
          part_index: 0,
          width: 256,
          height: 256,
          display_width: 256,
          display_height: 256,
          pixel_aspect_ratio: 1.0,
          compression: "zip",
          color_space: "linear",
          render_software: "OpenImageIO 3.1.11.0 : 0348A2EAAAC75D3D43E735BA40901D3A1841026A",
        }],
        channels: [
          { channel_name: "R", channel_type: "HALF" },
          { channel_name: "G", channel_type: "HALF" },
          { channel_name: "B", channel_type: "HALF" },
        ],
      },
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    await waitFor(() => expect(screen.getByText("File")).toBeInTheDocument());
    expect(screen.getByText("Sequence")).toBeInTheDocument();
    // Resolution from parts[0] — formatResolution uses " × " (with spaces)
    expect(screen.getByText("256 × 256")).toBeInTheDocument();
    // Bit depth derived from channels
    expect(screen.getByText("16-bit half")).toBeInTheDocument();
    // Compression formatted
    expect(screen.getByText("ZIP (lossless)")).toBeInTheDocument();
    // Color Science section visible (has linear from parts[0])
    expect(screen.getByText("Color Science")).toBeInTheDocument();
    expect(screen.getByText("linear")).toBeInTheDocument();
  });

  it("frame pipeline → CG render fallback: surfaces render_software in Camera section when camera.* empty", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: { functionName: "frame-metadata-extractor", targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc", format: "openexr", size_bytes: 6906 }],
      sidecar: null,
      dbExtras: {
        parts: [{
          part_index: 0,
          width: 256,
          height: 256,
          render_software: "OpenImageIO 3.1.11.0 : 0348A2EAAAC75D3D43E735BA40901D3A1841026A",
        }],
      },
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    // formatCameraName trims after " : " — value should be just the version
    // string. This proves the CG-render fallback path resolves render_software
    // when camera.make / camera.model are absent.
    await waitFor(() => expect(screen.getByText("OpenImageIO 3.1.11.0")).toBeInTheDocument());
    // Camera section header IS rendered (since at least one field — the camera_name
    // computed from render_software — has a value).
    const cameraTitles = screen.getAllByText(/^Camera$/);
    expect(cameraTitles.length).toBeGreaterThanOrEqual(1);
  });

  it("frame pipeline with no dbExtras and no sidecar → 'extraction pending' banner", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: { functionName: "frame-metadata-extractor", targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc", format: "openexr" }],
      sidecar: null,
      // no dbExtras
    });

    render(<AllFieldsPanel asset={exrAsset} />);

    await waitFor(() => expect(screen.getByTestId("extraction-pending")).toBeInTheDocument());
    expect(screen.getByText(/extraction pending/i)).toBeInTheDocument();
  });

  it("unknown file kind → File summary only, no semantic renderer", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: unknownAsset.id,
      sourceUri: unknownAsset.sourceUri,
      fileKind: "other",
      pipeline: null,
      sources: { db: "disabled", sidecar: "missing" },
      dbRows: [],
      sidecar: null,
    });

    render(<AllFieldsPanel asset={unknownAsset} />);

    await waitFor(() => expect(screen.getByText("File")).toBeInTheDocument());
    // Only the File group renders; no Sequence / Container / Color Science / etc.
    expect(screen.queryByText("Sequence")).toBeNull();
    expect(screen.queryByText("Container")).toBeNull();
    expect(screen.queryByText("Color Science")).toBeNull();
  });

  it("loading state shows placeholder", () => {
    vi.spyOn(api, "fetchAssetMetadata").mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<AllFieldsPanel asset={exrAsset} />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  it("error state surfaces the error message", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockRejectedValue(new Error("vast unreachable"));
    render(<AllFieldsPanel asset={exrAsset} />);
    await waitFor(() => expect(screen.getByTestId("error")).toBeInTheDocument());
    expect(screen.getByText(/vast unreachable/i)).toBeInTheDocument();
  });
});
