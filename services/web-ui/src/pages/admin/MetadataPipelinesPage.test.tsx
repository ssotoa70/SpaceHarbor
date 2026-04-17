// services/web-ui/src/pages/admin/MetadataPipelinesPage.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../api";
import { MetadataPipelinesPage } from "./MetadataPipelinesPage";

describe("MetadataPipelinesPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the title while loading", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<MetadataPipelinesPage />);
    expect(screen.getByRole("heading", { name: /metadata pipelines/i })).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders empty-state seed button when no pipelines are configured", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
    render(<MetadataPipelinesPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /seed defaults/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("surfaces a fetch error as a banner", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockRejectedValue(
      new Error("boom"),
    );
    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it("renders a row per configured pipeline with status pills", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
      pipelines: [
        {
          config: {
            fileKind: "image",
            functionName: "frame-metadata-extractor",
            extensions: [".exr", ".dpx"],
            targetSchema: "frame_metadata",
            targetTable: "files",
            sidecarSchemaId: "frame@1",
            enabled: true,
          },
          live: null,
          status: "ok" as api.DiscoveredPipelineStatus,
        },
        {
          config: {
            fileKind: "video",
            functionName: "video-metadata-extractor",
            extensions: [".mov"],
            targetSchema: "video_metadata",
            targetTable: "files",
            sidecarSchemaId: "video@1",
            enabled: false,
          },
          live: null,
          status: "function-not-found" as api.DiscoveredPipelineStatus,
          statusDetail: "no VAST function named 'video-metadata-extractor'",
        },
        {
          config: {
            fileKind: "raw_camera",
            functionName: "video-metadata-extractor",
            extensions: [".r3d"],
            targetSchema: "video_metadata",
            targetTable: "files",
            sidecarSchemaId: "video@1",
            enabled: true,
          },
          live: null,
          status: "vast-unreachable" as api.DiscoveredPipelineStatus,
          statusDetail: "VMS unreachable",
        },
      ],
    });
    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByText("frame-metadata-extractor")).toBeInTheDocument();
    expect(screen.getByText(/frame_metadata\.files/)).toBeInTheDocument();
    expect(screen.getByText(/OK/i)).toBeInTheDocument();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();

    // statusDetail surfaces as a tooltip (title attribute)
    const notFoundPill = screen.getByText(/not found/i);
    expect(notFoundPill.closest("[title]")?.getAttribute("title"))
      .toMatch(/no VAST function named/);
  });
});
