import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { FrameSequenceIntegrity } from "./FrameSequenceIntegrity";
import type { AssetRow } from "../types";

const exrAsset: AssetRow = {
  id: "asset-exr",
  jobId: null,
  title: "frame.0001.exr",
  sourceUri: "s3://bucket/frame.0001.exr",
  status: "pending",
};

const videoAsset: AssetRow = {
  id: "asset-video",
  jobId: null,
  title: "clip.mov",
  sourceUri: "s3://bucket/clip.mov",
  status: "pending",
};

describe("FrameSequenceIntegrity", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders nothing for non-sequence assets (no frame_number, no parts)", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: videoAsset.id,
      sourceUri: videoAsset.sourceUri,
      fileKind: "video",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc" }],
      sidecar: null,
    });
    render(<FrameSequenceIntegrity asset={videoAsset} />);
    // Wait briefly to ensure the metadata resolves; component should
    // remain unmounted (no testid).
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("frame-sequence-integrity")).toBeNull();
  });

  it("renders the placeholder block for sequence assets (parts present)", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: { functionName: "frame-metadata-extractor", targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc", frame_number: 1001 }],
      sidecar: null,
      dbExtras: { parts: [{ part_index: 0, width: 256, height: 256 }] },
    });
    render(<FrameSequenceIntegrity asset={exrAsset} />);
    await waitFor(() => expect(screen.getByTestId("frame-sequence-integrity")).toBeInTheDocument());
    expect(screen.getByText(/Frame Sequence Integrity/i)).toBeInTheDocument();
    expect(screen.getByText(/Not validated/i)).toBeInTheDocument();
    expect(screen.getByTestId("run-integrity-check")).toBeInTheDocument();
  });

  it("clicking the action button hits the stub endpoint and surfaces the 503 not-implemented state", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
      assetId: exrAsset.id,
      sourceUri: exrAsset.sourceUri,
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ file_id: "abc", frame_number: 1001 }],
      sidecar: null,
    });
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ code: "NOT_IMPLEMENTED", message: "Sequence integrity scanner not yet implemented." }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchSpy);

    render(<FrameSequenceIntegrity asset={exrAsset} />);
    await waitFor(() => expect(screen.getByTestId("run-integrity-check")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("run-integrity-check"));

    await waitFor(() => expect(screen.getByTestId("integrity-not-implemented")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/assets\/[^/]+\/sequence-integrity$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
