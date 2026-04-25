import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { __resetAssetIntegrityCacheForTests } from "../hooks/useAssetIntegrity";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";
import type { AssetRow } from "../types";

const videoAsset: AssetRow = {
  id: "asset-vid-1",
  jobId: null,
  title: "shot_010.mp4",
  sourceUri: "s3://sergio-spaceharbor/uploads/shot_010.mp4",
  status: "pending",
};

function stubCommonApis() {
  vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
  vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
    assetId: videoAsset.id,
    sourceUri: videoAsset.sourceUri,
    fileKind: "video",
    pipeline: null,
    sources: { db: "empty", sidecar: "missing" },
    dbRows: [],
    sidecar: null,
  });
  // useStorageSidecar hits /api/v1/storage/sidecar/lookup — stub fetch
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
}

describe("AssetDetailPanel INTEGRITY tab", () => {
  beforeEach(() => {
    __resetAssetIntegrityCacheForTests();
    __resetAssetMetadataCacheForTests();
    __resetPipelineCacheForTests();
    stubCommonApis();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("INTEGRITY tab renders hash + algorithm + bytes-hashed when populated", async () => {
    vi.spyOn(api, "fetchAssetIntegrity").mockResolvedValue({
      assetId: videoAsset.id,
      sources: { hashes: "ok", keyframes: "empty" },
      hashes: {
        sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        perceptual_hash: null,
        algorithm_version: "sha256-v1",
        bytes_hashed: 1024,
        hashed_at: "2026-04-19T12:00:00Z",
      },
      keyframes: null,
    });

    render(<AssetDetailPanel asset={videoAsset} onClose={() => {}} />);

    const tab = await screen.findByRole("tab", { name: /integrity/i });
    fireEvent.click(tab);

    await waitFor(() =>
      expect(screen.getByText(/SHA-256/)).toBeInTheDocument()
    );
    expect(screen.getByText(/sha256-v1/)).toBeInTheDocument();
    expect(screen.getByText(/1,024/)).toBeInTheDocument();
    // Status pills
    expect(screen.getByText(/HASHES · ok/)).toBeInTheDocument();
    expect(screen.getByText(/KEYFRAMES · empty/)).toBeInTheDocument();
  });
});
