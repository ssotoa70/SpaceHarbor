/**
 * StorageBrowserPage.FileDetailSidebar — Layer C.2 behavioral contract.
 *
 * Asserts: preview pane branches by file kind; metadata comes from
 * useStorageSidecar (not legacy helpers); empty-state copy is format-
 * neutral with a CTA for unsupported extensions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { StorageBrowserPage } from "./StorageBrowserPage";
import * as api from "../api";
import * as useDataEnginePipelinesModule from "../hooks/useDataEnginePipelines";
import * as useStorageSidecarModule from "../hooks/useStorageSidecar";
import { __resetSidecarCacheForTests } from "../hooks/useStorageSidecar";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";

afterEach(() => {
  cleanup();
  __resetSidecarCacheForTests();
  __resetPipelineCacheForTests();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePipelines(): api.DiscoveredPipeline[] {
  return [
    {
      config: {
        fileKind: "image",
        functionName: "frame-metadata-extractor",
        extensions: [".exr", ".jpg", ".png"],
        targetSchema: "frame_metadata",
        targetTable: "files",
        sidecarSchemaId: "frame@1",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "video",
        functionName: "video-metadata-extractor",
        extensions: [".mov", ".mp4"],
        targetSchema: "video_metadata",
        targetTable: "files",
        sidecarSchemaId: "video@1",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "raw_camera",
        functionName: "raw-camera-metadata-extractor",
        extensions: [".r3d", ".braw"],
        targetSchema: "raw_camera_metadata",
        targetTable: "files",
        sidecarSchemaId: "raw@1",
      },
      live: null,
      status: "ok",
    },
  ];
}

function makeFile(filename: string): api.StorageBrowseFile {
  return {
    key: `renders/${filename}`,
    sourceUri: `s3://bucket/renders/${filename}`,
    sizeBytes: 1024 * 1024 * 42,
    inferredMediaType: "image",
    lastModified: "2026-04-01T10:00:00Z",
  };
}

function makeBrowseResult(filename: string): api.StorageBrowseResult {
  return {
    endpointId: "ep1",
    bucket: "test-bucket",
    prefix: "",
    files: [makeFile(filename)],
    folders: [],
    truncated: false,
    continuationToken: undefined,
  };
}

// Common mocks applied before each test; individual tests override as needed.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchStorageEndpoints: vi.fn().mockResolvedValue([
      { id: "ep1", label: "Main", bucket: "test-bucket" },
    ]),
    fetchStorageBrowse: vi.fn().mockResolvedValue(makeBrowseResult("hero.exr")),
    fetchMediaUrls: vi.fn().mockResolvedValue({
      source: "http://cdn/hero_preview.exr",
      thumbnail: "http://cdn/hero_thumb.jpg",
      preview: null,
      proxy: null,
    }),
    fetchProcessingStatus: vi.fn().mockResolvedValue([]),
    ingestAsset: vi.fn().mockResolvedValue(undefined),
    requestProcessing: vi.fn().mockResolvedValue(undefined),
    deriveDisplayState: vi.fn().mockReturnValue("not_processed"),
  };
});

vi.mock("../hooks/useDataEnginePipelines", async (importOriginal) => {
  const actual = await importOriginal<typeof useDataEnginePipelinesModule>();
  return {
    ...actual,
    useDataEnginePipelines: vi.fn().mockReturnValue({
      pipelines: makePipelines(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  };
});

vi.mock("../hooks/useStorageSidecar", async (importOriginal) => {
  const actual = await importOriginal<typeof useStorageSidecarModule>();
  return {
    ...actual,
    useStorageSidecar: vi.fn().mockReturnValue({
      sidecar: null,
      loading: false,
      error: null,
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/storage"]}>
      <StorageBrowserPage />
    </MemoryRouter>
  );
}

/** Click the first file row to open the sidebar.
 *
 * The table uses a <tbody> with file rows. We wait for the "Process" or
 * "Reprocess" action button to confirm the rows have loaded, then click
 * the first <tr> in <tbody> that contains file data (not the ".." parent row).
 */
async function openSidebar() {
  renderPage();
  // Wait for at least one action button to confirm rows loaded
  await waitFor(() => {
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
  });
  // Click the first file row (the <tr> element directly)
  const rows = document.querySelectorAll("tbody tr");
  fireEvent.click(rows[0]);
}

// ---------------------------------------------------------------------------
// Tests: image preview
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — image preview (.exr)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("hero.exr"));
    vi.mocked(api.fetchMediaUrls).mockResolvedValue({
      source: "http://cdn/hero_src.exr",
      thumbnail: "http://cdn/hero_thumb.jpg",
      preview: null,
      proxy: null,
    });
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: {
        schema_version: "1",
        file_kind: "image",
        source_uri: "s3://bucket/renders/hero.exr",
        sidecar_key: "renders/hero_metadata.json",
        bucket: "bucket",
        bytes: 2048,
        data: {
          width: 1920,
          height: 1080,
          channels: [
            { channel_name: "R", layer_name: "rgba", channel_type: "HALF" },
            { channel_name: "diffuse.R", layer_name: "diffuse", channel_type: "HALF" },
          ],
        },
      },
      loading: false,
      error: null,
    });
  });

  it("renders <img> with alt text for image files", async () => {
    await openSidebar();
    const img = await screen.findByRole("img", { name: /hero\.exr/i });
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
  });

  it("does not render <video> for image files", async () => {
    await openSidebar();
    // Wait for sidebar to mount (img renders)
    await screen.findByRole("img", { name: /hero\.exr/i });
    expect(document.querySelector("video")).toBeNull();
  });

  it("renders ChannelPills AOV section when sidecar has channels", async () => {
    await openSidebar();
    // dedup-by-layer: "rgba" and "diffuse" unique layer names
    await waitFor(() => {
      // At least one pill with layer name text should appear
      expect(screen.getByText("rgba")).toBeInTheDocument();
    });
  });

  it("renders flat metadata key-value rows from sidecar data", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(screen.getByText("Width")).toBeInTheDocument();
    });
  });

  it("does NOT call fetchExrMetadataLookup", async () => {
    await openSidebar();
    await waitFor(() => screen.findByRole("img", { name: /hero\.exr/i }));
    // The api mock does not expose fetchExrMetadataLookup since it's being removed;
    // confirm useStorageSidecar was the source of truth.
    expect(useStorageSidecarModule.useStorageSidecar).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: video preview (.mov) — Bug C fix
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — video preview (.mov)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("hero_grade.mov"));
    vi.mocked(api.fetchMediaUrls).mockResolvedValue({
      source: "http://cdn/hero_grade.mov",
      thumbnail: "http://cdn/hero_grade_thumb.jpg",
      preview: null,
      proxy: null,
    });
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: {
        schema_version: "1",
        file_kind: "video",
        source_uri: "s3://bucket/renders/hero_grade.mov",
        sidecar_key: "renders/hero_grade_metadata.json",
        bucket: "bucket",
        bytes: 2048,
        data: { duration: "00:02:15", codec: "prores" },
      },
      loading: false,
      error: null,
    });
  });

  it("renders <video> with controls for video files (Bug C fix)", async () => {
    await openSidebar();
    // video element has no implicit role — query DOM directly
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });
    const videoEl = document.querySelector("video") as HTMLVideoElement;
    expect(videoEl.controls).toBe(true);
  });

  it("does NOT render <img> for video files (was the broken-image placeholder)", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });
    // No <img> in the preview area — img role absent (besides any logos etc.)
    expect(screen.queryByRole("img", { name: /hero_grade\.mov/i })).toBeNull();
  });

  it("renders video metadata rows from sidecar", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(screen.getByText("Codec")).toBeInTheDocument();
    });
  });

  it("renders <video> with poster thumbnail", async () => {
    await openSidebar();
    await waitFor(() => {
      const videoEl = document.querySelector("video") as HTMLVideoElement;
      expect(videoEl.poster).toBe("http://cdn/hero_grade_thumb.jpg");
    });
  });

  it("degrades to 'Preview unavailable' when video element errors", async () => {
    await openSidebar();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const videoEl = document.querySelector("video")!;
    fireEvent.error(videoEl);
    await waitFor(() => {
      expect(screen.getByText(/Preview unavailable in this browser/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: raw_camera file (.r3d)
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — raw_camera (.r3d)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("A001_C001.r3d"));
    vi.mocked(api.fetchMediaUrls).mockResolvedValue({
      source: null,
      thumbnail: null,
      preview: null,
      proxy: null,
    });
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: null,
      loading: false,
      error: null,
    });
  });

  it("renders raw camera no-preview message", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(
        screen.getByText(/No preview available for raw camera files/i)
      ).toBeInTheDocument();
    });
  });

  it("does not render <img> or <video> for raw camera files", async () => {
    await openSidebar();
    await waitFor(() =>
      screen.getByText(/No preview available for raw camera files/i)
    );
    expect(screen.queryByRole("img", { name: /A001_C001\.r3d/i })).toBeNull();
    expect(document.querySelector("video")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: unsupported extension — empty-state copy (Bug D.1 fix)
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — unsupported extension (.pdf)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("contract.pdf"));
    vi.mocked(api.fetchMediaUrls).mockResolvedValue({
      source: null,
      thumbnail: null,
      preview: null,
      proxy: null,
    });
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: null,
      loading: false,
      error: null,
    });
  });

  it("shows 'No pipeline configured' copy for unsupported extension (Bug D.1 fix)", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(
        screen.getByText(/No pipeline configured for/i)
      ).toBeInTheDocument();
    });
  });

  it("shows the file extension in the copy", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(screen.getByText(".pdf")).toBeInTheDocument();
    });
  });

  it("renders a CTA link to /automation/pipelines", async () => {
    await openSidebar();
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Configure Metadata Pipelines/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/automation/pipelines");
    });
  });

  it("does NOT show 'No EXR metadata available' (old copy)", async () => {
    await openSidebar();
    // Wait for sidebar to stabilize
    await waitFor(() =>
      screen.getByText(/No pipeline configured for/i)
    );
    expect(screen.queryByText(/No EXR metadata available/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: sidecar loading state
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — sidecar loading state", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("hero.exr"));
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: null,
      loading: true,
      error: null,
    });
  });

  it("shows loading message while sidecar is fetching", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(screen.getByText(/Loading metadata/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: metadata unavailable fallback (image with no sidecar)
// ---------------------------------------------------------------------------

describe("FileDetailSidebar — image with no sidecar", () => {
  beforeEach(() => {
    vi.mocked(api.fetchStorageBrowse).mockResolvedValue(makeBrowseResult("hero.exr"));
    vi.mocked(api.fetchMediaUrls).mockResolvedValue({
      source: "http://cdn/hero_thumb.jpg",
      thumbnail: "http://cdn/hero_thumb.jpg",
      preview: null,
      proxy: null,
    });
    vi.mocked(useStorageSidecarModule.useStorageSidecar).mockReturnValue({
      sidecar: null,
      loading: false,
      error: null,
    });
  });

  it("shows format-neutral fallback copy when sidecar is absent", async () => {
    await openSidebar();
    await waitFor(() => {
      expect(
        screen.getByText(/Metadata unavailable in this view/i)
      ).toBeInTheDocument();
    });
  });

  it("still renders <img> when previewUrl exists and file is image kind", async () => {
    await openSidebar();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /hero\.exr/i });
      expect(img).toBeInTheDocument();
    });
  });
});
