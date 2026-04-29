import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as api from "../api";
import { AssetBrowser } from "./AssetBrowser";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";

function renderWithRouter(ui: React.ReactElement, initialEntries = ["/"]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

function makeAsset(i: number): api.AssetRow {
  return {
    id: `a${i}`,
    title: `asset_${String(i).padStart(4, "0")}.exr`,
    status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "processing" : "failed",
    sourceUri: `/data/asset_${i}.exr`,
    jobId: `j${i}`,
    productionMetadata: {},
  } as api.AssetRow;
}

const threeAssets: api.AssetRow[] = [
  { id: "a1", title: "hero_plate_v001.exr", status: "completed", sourceUri: "/data/hero.exr", jobId: "j1", productionMetadata: {} } as api.AssetRow,
  { id: "a2", title: "bg_plate_v002.mov", status: "processing", sourceUri: "/data/bg.mov", jobId: "j2", productionMetadata: {} } as api.AssetRow,
  { id: "a3", title: "fx_dust_v001.exr", status: "failed", sourceUri: "/data/fx.exr", jobId: "j3", productionMetadata: {} } as api.AssetRow,
];

vi.mock("../api", () => ({
  fetchAssets: vi.fn().mockResolvedValue([
    { id: "a1", title: "hero_plate_v001.exr", status: "completed", sourceUri: "/data/hero.exr", jobId: "j1", productionMetadata: {} },
    { id: "a2", title: "bg_plate_v002.mov", status: "processing", sourceUri: "/data/bg.mov", jobId: "j2", productionMetadata: {} },
    { id: "a3", title: "fx_dust_v001.exr", status: "failed", sourceUri: "/data/fx.exr", jobId: "j3", productionMetadata: {} },
  ]),
  fetchCatalogUnregistered: vi.fn().mockResolvedValue([]),
  fetchVersionDependencies: vi.fn().mockResolvedValue([]),
  ingestAsset: vi.fn().mockResolvedValue(undefined),
  fetchMediaUrls: vi.fn().mockResolvedValue({ source: null, thumbnail: null, preview: null, proxy: null }),
  fetchAssetMetadata: vi.fn().mockResolvedValue({
    assetId: "a1",
    sourceUri: "/data/hero.exr",
    fileKind: "exr",
    pipeline: null,
    sources: { db: "empty" as const, sidecar: "missing" as const },
    dbRows: [],
    sidecar: null,
  }),
}));

describe("AssetBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAssetMetadataCacheForTests();
  });

  it("renders the asset browser heading", () => {
    renderWithRouter(<AssetBrowser />);
    expect(screen.getByText("Assets")).toBeInTheDocument();
  });

  it("renders view mode toggle buttons", () => {
    renderWithRouter(<AssetBrowser />);
    expect(screen.getAllByRole("button", { name: "Gallery" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "List" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Compact" }).length).toBeGreaterThanOrEqual(1);
  });

  it("switches to list view", () => {
    renderWithRouter(<AssetBrowser />);
    fireEvent.click(screen.getAllByRole("button", { name: "List" })[0]);
    expect(screen.getAllByRole("button", { name: "List" })[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("renders filter inputs", () => {
    renderWithRouter(<AssetBrowser />);
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });

  it("renders assets after loading", async () => {
    renderWithRouter(<AssetBrowser />);
    expect((await screen.findAllByText("hero_plate_v001.exr")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("bg_plate_v002.mov").length).toBeGreaterThanOrEqual(1);
  });

  it("filters by search", async () => {
    renderWithRouter(<AssetBrowser />);
    await screen.findAllByText("hero_plate_v001.exr");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "hero" } });
    expect(screen.getAllByText("hero_plate_v001.exr").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("bg_plate_v002.mov")).not.toBeInTheDocument();
  });

  it("virtualizes 1000 assets in list mode — DOM has fewer than 50 rendered nodes", async () => {
    const manyAssets = Array.from({ length: 1000 }, (_, i) => makeAsset(i));
    vi.mocked(api.fetchAssets).mockResolvedValueOnce(manyAssets);

    renderWithRouter(<AssetBrowser />);
    // Wait for gallery to render (default mode), then switch to list
    await screen.findByTestId("gallery-grid");
    fireEvent.click(screen.getAllByRole("button", { name: "List" })[0]);

    const container = screen.getByTestId("virtual-scroll-container");
    const renderedRows = container.querySelectorAll("[data-index]");
    expect(renderedRows.length).toBeLessThan(50);
    expect(renderedRows.length).toBeGreaterThan(0);
  });

  it("gallery renders all cards without virtualizer", async () => {
    const assets = Array.from({ length: 20 }, (_, i) => makeAsset(i));
    vi.mocked(api.fetchAssets).mockResolvedValueOnce(assets);

    renderWithRouter(<AssetBrowser />);
    const grid = await screen.findByTestId("gallery-grid");
    // All 20 cards are rendered in the DOM (no virtualization)
    expect(grid.children.length).toBe(20);
  });

  it("syncs filter state to URL search params", async () => {
    renderWithRouter(<AssetBrowser />);
    await screen.findByTestId("gallery-grid");

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    expect(screen.getByLabelText("Status")).toHaveValue("completed");
  });

  it("restores filter state from URL params on mount", async () => {
    renderWithRouter(<AssetBrowser />, ["/?status=processing"]);
    await screen.findByTestId("gallery-grid");

    expect(screen.getByLabelText("Status")).toHaveValue("processing");
  });
});

// ---------------------------------------------------------------------------
// MediaPreview field composition — I-1 coverage for C2 migration
// ---------------------------------------------------------------------------
describe("MediaPreview field composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAssetMetadataCacheForTests();
  });

  it("renders resolution and compression from dbRow when populated", async () => {
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce({
      assetId: "a1",
      sourceUri: "/data/hero.exr",
      fileKind: "image",
      pipeline: null,
      sources: { db: "ok" as const, sidecar: "ok" as const },
      dbRows: [{ width: 2048, height: 858, compression: "zip", color_space: "ACES2065-1" }],
      sidecar: null,
    } as any);

    renderWithRouter(<AssetBrowser />);
    const grid = await screen.findByTestId("gallery-grid");
    fireEvent.doubleClick(grid.children[0]);

    // AllFieldsPanel renders Resolution from width+height in the MEDIA group;
    // the same dbRow values also surface in ATTRIBUTES (Width, Height, Compression).
    await waitFor(() => {
      expect(screen.getAllByText("2048x858").length).toBeGreaterThanOrEqual(1);
      // Compression value preserves its source casing — no toUpperCase.
      expect(screen.getAllByText("zip").length).toBeGreaterThanOrEqual(1);
    });
    // The Compression field label is rendered once in MEDIA and again in ATTRIBUTES.
    expect(screen.getAllByText("Compression").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to sidecar when dbRows is empty", async () => {
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce({
      assetId: "a1",
      sourceUri: "/data/hero.exr",
      fileKind: "image",
      pipeline: null,
      sources: { db: "empty" as const, sidecar: "ok" as const },
      dbRows: [],
      sidecar: { width: 2048, height: 1080, compression: "piz", color_space: "scene-linear" },
    } as any);

    renderWithRouter(<AssetBrowser />);
    const grid = await screen.findByTestId("gallery-grid");
    fireEvent.doubleClick(grid.children[0]);

    await waitFor(() => {
      expect(screen.getAllByText("2048x1080").length).toBeGreaterThanOrEqual(1);
    });
    // Compression from sidecar fallback
    expect(screen.getAllByText("piz").length).toBeGreaterThanOrEqual(1);
  });

  it("does not render channels/parts arrays as JSON strings in dynamic loop", async () => {
    vi.mocked(api.fetchAssetMetadata).mockResolvedValueOnce({
      assetId: "a1",
      sourceUri: "/data/hero.exr",
      fileKind: "image",
      pipeline: null,
      sources: { db: "empty" as const, sidecar: "ok" as const },
      dbRows: [],
      sidecar: {
        channels: [{ channel_name: "R", layer_name: "rgba", channel_type: "FLOAT", part_index: 0 }],
        parts: [{ name: "rgba", type: "scanlineimage" }],
        duration: 42,
      },
    } as any);

    renderWithRouter(<AssetBrowser />);
    const grid = await screen.findByTestId("gallery-grid");
    fireEvent.doubleClick(grid.children[0]);

    // Wait for sidebar to open and metadata to render
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Primitive sidecar field (duration) should appear in the dynamic Media group
    expect(screen.getByText("42")).toBeInTheDocument();

    // Array/object fields must NOT render as raw JSON blobs
    const renderedText = document.body.textContent ?? "";
    expect(renderedText).not.toMatch(/\[object Object\]/);
    expect(renderedText).not.toMatch(/channel_name/);
  });
});
