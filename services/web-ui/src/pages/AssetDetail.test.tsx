import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AssetDetail } from "./AssetDetail";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";

vi.mock("../api", () => ({
  fetchAsset: vi.fn().mockResolvedValue({
    id: "test-asset-1",
    jobId: "job-1",
    title: "hero_comp_v003.exr",
    sourceUri: "s3://bucket/hero_comp_v003.exr",
    status: "qc_approved",
    productionMetadata: {},
  }),
  fetchAssetAudit: vi.fn().mockResolvedValue([
    { id: "e1", message: "Asset ingested", at: "2026-03-10T10:00:00Z", signal: null },
    { id: "e2", message: "QC approved", at: "2026-03-10T11:00:00Z", signal: null },
  ]),
  fetchAssetMetadata: vi.fn().mockResolvedValue({
    assetId: "test-asset-1",
    sourceUri: "s3://bucket/hero_comp_v003.exr",
    fileKind: "exr",
    pipeline: null,
    sources: { db: "empty", sidecar: "missing" },
    dbRows: [],
    sidecar: null,
  }),
}));

// Populated metadata fixture for sidecar / EXR card tests
function makePopulatedMetadata() {
  return {
    assetId: "test-asset-1",
    sourceUri: "s3://bucket/hero_comp_v003.exr",
    fileKind: "exr",
    pipeline: {
      functionName: "frame-metadata-extractor",
      targetSchema: "frame_metadata",
      targetTable: "files",
      sidecarSchemaId: "frame@1",
    },
    sources: { db: "ok" as const, sidecar: "ok" as const },
    dbRows: [{
      width: 2048,
      height: 858,
      compression: "zip",
      color_space: "ACES2065-1",
      is_deep: false,
    }],
    sidecar: {
      channels: [
        { channel_name: "R", layer_name: "rgba", channel_type: "FLOAT", part_index: 0 },
        { channel_name: "G", layer_name: "rgba", channel_type: "FLOAT", part_index: 0 },
        { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT", part_index: 0 },
      ],
    },
    dbError: undefined,
  };
}

function renderAtRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/assets/:id" element={<AssetDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AssetDetail", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
  });

  it("renders asset title from route param", async () => {
    renderAtRoute("/assets/test-asset-1");
    expect(await screen.findByText("hero_comp_v003.exr")).toBeInTheDocument();
  });

  it("shows metadata section with status and source", async () => {
    renderAtRoute("/assets/test-asset-1");
    await screen.findByText("hero_comp_v003.exr");
    expect(screen.getByText("qc_approved")).toBeInTheDocument();
    expect(screen.getByText("s3://bucket/hero_comp_v003.exr")).toBeInTheDocument();
  });

  it("displays audit trail entries", async () => {
    renderAtRoute("/assets/test-asset-1");
    expect(await screen.findByText("Asset ingested")).toBeInTheDocument();
    expect(screen.getByText("QC approved")).toBeInTheDocument();
  });

  it("shows not found when asset is null", async () => {
    const api = await import("../api");
    vi.mocked(api.fetchAsset).mockResolvedValueOnce(null);

    renderAtRoute("/assets/nonexistent");
    expect(await screen.findByText("Asset Not Found")).toBeInTheDocument();
  });

  it("renders EXR summary card when dbRows has a row", async () => {
    const api = await import("../api");
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce(makePopulatedMetadata());

    renderAtRoute("/assets/test-asset-1");
    await waitFor(() => expect(screen.getByText(/2048/)).toBeInTheDocument());
    expect(screen.getByText(/compression/i)).toBeInTheDocument();
    expect(screen.getByText(/zip/i)).toBeInTheDocument();
  });

  it("renders AOV channel pills from sidecar.channels with layer prefix logic", async () => {
    const api = await import("../api");
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce(makePopulatedMetadata());

    renderAtRoute("/assets/test-asset-1");
    await waitFor(() => expect(screen.getByText(/AOVs/i)).toBeInTheDocument());
    const pills = document.querySelectorAll(".flex-wrap span");
    expect(pills.length).toBeGreaterThanOrEqual(3);
    // rgba layer channels omit prefix
    expect(Array.from(pills).some((el) => el.textContent === "R")).toBe(true);
    // non-rgba layer channels get "layer." prefix
    expect(Array.from(pills).some((el) => el.textContent === "diffuse.R")).toBe(true);
  });

  it("hides AOV pill section when sidecar.channels is not an array (object map)", async () => {
    const api = await import("../api");
    const malformed = makePopulatedMetadata();
    // Simulate malformed sidecar — channels as object map instead of array
    (malformed.sidecar as Record<string, unknown>).channels = { rgba: ["R", "G", "B"] };
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce(malformed);

    renderAtRoute("/assets/test-asset-1");
    await waitFor(() => expect(screen.getByText("hero_comp_v003.exr")).toBeInTheDocument());
    expect(screen.queryByText(/AOVs/i)).not.toBeInTheDocument();
  });
});
