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

  it("inline toggle saves the full mutated array", async () => {
    const initial: api.DiscoveredPipeline[] = [
      {
        config: {
          fileKind: "image", functionName: "fn-img", extensions: [".exr"],
          targetSchema: "s", targetTable: "t", sidecarSchemaId: "frame@1",
          enabled: true,
        },
        live: null, status: "ok",
      },
      {
        config: {
          fileKind: "video", functionName: "fn-vid", extensions: [".mov"],
          targetSchema: "s2", targetTable: "t2", sidecarSchemaId: "video@1",
          enabled: true,
        },
        live: null, status: "ok",
      },
    ];
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: initial });
    const saveSpy = vi.spyOn(api, "saveMetadataPipelines").mockResolvedValue();

    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByText("fn-img")).toBeInTheDocument());

    const imgToggle = screen.getByRole("switch", { name: /toggle image/i });
    fireEvent.click(imgToggle);

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const arg = saveSpy.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg.find((p) => p.fileKind === "image")?.enabled).toBe(false);
    expect(arg.find((p) => p.fileKind === "video")?.enabled).toBe(true);
  });

  it("rolls back the toggle when save fails", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
      pipelines: [{
        config: { fileKind: "image", functionName: "fn", extensions: [".exr"],
                  targetSchema: "s", targetTable: "t", sidecarSchemaId: "frame@1",
                  enabled: true },
        live: null, status: "ok",
      }],
    });
    vi.spyOn(api, "saveMetadataPipelines").mockRejectedValue(new Error("PUT failed"));

    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByRole("switch", { name: /toggle image/i })).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /toggle image/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);

    // After rollback, toggle returns to true and error banner appears
    await waitFor(() => expect(screen.getByText(/PUT failed/)).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: /toggle image/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("refresh button re-fetches with force=true", async () => {
    const fetchSpy = vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy.mock.calls[1][0]).toEqual({ force: true });
  });

  it("seed-defaults fetches defaults, PUTs, then force-reloads", async () => {
    const seedList: api.DataEnginePipelineConfig[] = [
      { fileKind: "image", functionName: "fn", extensions: [".exr"],
        targetSchema: "s", targetTable: "t", sidecarSchemaId: "frame@1" },
      { fileKind: "video", functionName: "fn2", extensions: [".mov"],
        targetSchema: "s2", targetTable: "t2", sidecarSchemaId: "video@1" },
    ];
    const fetchSpy = vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
    vi.spyOn(api, "fetchMetadataPipelineDefaults").mockResolvedValue(seedList);
    const saveSpy = vi.spyOn(api, "saveMetadataPipelines").mockResolvedValue();

    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /seed defaults/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /seed defaults/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(saveSpy.mock.calls[0][0]).toEqual(seedList);
    // After seed, a force-reload happens
    await waitFor(() => expect(fetchSpy.mock.calls.some((c) => c[0]?.force === true)).toBe(true));
  });

  it("seed-defaults disabled + banner after loader failure", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: [] });
    vi.spyOn(api, "fetchMetadataPipelineDefaults").mockRejectedValue(new Error("seed boom"));

    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /seed defaults/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /seed defaults/i }));

    await waitFor(() => expect(screen.getByText(/seed boom/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /seed defaults/i })).toBeDisabled();
  });

  it("shows 'seed missing' banner + appends only missing kinds", async () => {
    // 1 kind configured (image), 2 missing (video + raw_camera)
    const existing: api.DiscoveredPipeline[] = [
      {
        config: { fileKind: "image", functionName: "fn", extensions: [".exr"],
                  targetSchema: "s", targetTable: "t", sidecarSchemaId: "frame@1",
                  enabled: true },
        live: null, status: "ok",
      },
    ];
    const fullDefaults: api.DataEnginePipelineConfig[] = [
      { fileKind: "image", functionName: "fn-d-img", extensions: [".exr"],
        targetSchema: "sd", targetTable: "td", sidecarSchemaId: "frame@1" },
      { fileKind: "video", functionName: "fn-d-vid", extensions: [".mov"],
        targetSchema: "sd", targetTable: "td", sidecarSchemaId: "video@1" },
      { fileKind: "raw_camera", functionName: "fn-d-raw", extensions: [".r3d"],
        targetSchema: "sd", targetTable: "td", sidecarSchemaId: "video@1" },
    ];
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({ pipelines: existing });
    vi.spyOn(api, "fetchMetadataPipelineDefaults").mockResolvedValue(fullDefaults);
    const saveSpy = vi.spyOn(api, "saveMetadataPipelines").mockResolvedValue();

    render(<MetadataPipelinesPage />);
    await waitFor(() => expect(screen.getByText(/missing pipelines for: video, raw_camera/i))
      .toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /seed missing/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const arg = saveSpy.mock.calls[0][0];
    // Preserves existing image config; appends the two missing kinds from defaults
    expect(arg).toHaveLength(3);
    expect(arg.find((p) => p.fileKind === "image")?.functionName).toBe("fn");
    expect(arg.find((p) => p.fileKind === "video")?.functionName).toBe("fn-d-vid");
    expect(arg.find((p) => p.fileKind === "raw_camera")?.functionName).toBe("fn-d-raw");
  });
});
