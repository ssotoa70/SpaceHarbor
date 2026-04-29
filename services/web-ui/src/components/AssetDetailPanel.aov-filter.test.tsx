import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { __resetAssetIntegrityCacheForTests } from "../hooks/useAssetIntegrity";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";
import type { AssetRow } from "../types";

const exrAsset: AssetRow = {
  id: "asset-exr-1",
  jobId: null,
  title: "01_beauty.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/01_beauty.exr",
  status: "pending",
};

const exrAssetTwo: AssetRow = {
  ...exrAsset,
  id: "asset-exr-2",
  title: "02_no_aovs.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/02_no_aovs.exr",
};

function stubCommonApis() {
  vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
  vi.spyOn(api, "fetchAssetIntegrity").mockResolvedValue({
    assetId: exrAsset.id,
    sources: { hashes: "empty", keyframes: "n/a" },
    hashes: null,
    keyframes: null,
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
}

describe("AssetDetailPanel AOV pill filter", () => {
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

  it("clicking an AOV pill filters the AOVS-tab table to the matching layer", async () => {
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

    render(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);

    // Wait for the bar to mount with pills
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });

    // Switch to AOVS tab to make the table visible
    fireEvent.click(screen.getByRole("tab", { name: /AOVS/i }));

    // Both layers visible in the table initially (scope assertions to the
    // table — the bar above ALSO shows pill text, but we only care about
    // table-row visibility for filter behavior).
    const table = await screen.findByTestId("aov-layer-map");
    expect(within(table).getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    expect(within(table).getAllByText("normals").length).toBeGreaterThanOrEqual(1);

    // Click the diffuse pill in the bar
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));

    // Table now scopes to diffuse only — normals row disappears from the table
    await waitFor(() => {
      expect(within(table).queryByText("normals")).toBeNull();
    });
    expect(within(table).getAllByText("diffuse").length).toBeGreaterThanOrEqual(1);
    // Pill itself still shows in the bar with pressed state
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("activeAov resets to null when the asset prop changes", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockImplementation(async (id: string) => {
      if (id === exrAsset.id) {
        return {
          assetId: exrAsset.id,
          sourceUri: exrAsset.sourceUri,
          fileKind: "image",
          pipeline: null,
          sources: { db: "ok", sidecar: "missing" },
          dbRows: [{ file_id: "a" }],
          sidecar: null,
          dbExtras: {
            channels: [
              { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
              { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
            ],
          },
        };
      }
      return {
        assetId: exrAssetTwo.id,
        sourceUri: exrAssetTwo.sourceUri,
        fileKind: "image",
        pipeline: null,
        sources: { db: "ok", sidecar: "missing" },
        dbRows: [{ file_id: "b" }],
        sidecar: null,
      };
    });

    const { rerender } = render(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");

    // Switch to a different asset — bar should disappear (no aovs in
    // exrAssetTwo) AND when we switch BACK to exrAsset, activeAov is null.
    rerender(<AssetDetailPanel asset={exrAssetTwo} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /diffuse/ })).toBeNull();
    });

    rerender(<AssetDetailPanel asset={exrAsset} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /diffuse/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "false");
  });
});
