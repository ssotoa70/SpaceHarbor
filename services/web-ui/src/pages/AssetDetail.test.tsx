import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import { AssetDetail } from "./AssetDetail";

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
});
