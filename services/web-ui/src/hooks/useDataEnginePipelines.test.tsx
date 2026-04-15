import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import {
  useDataEnginePipelines,
  findPipelineByFileKind,
  findPipelineBySidecarSchemaId,
  findPipelineForFilename,
  buildExtensionIndex,
  __resetPipelineCacheForTests,
  __setPipelineCacheTtlForTests,
} from "./useDataEnginePipelines";

const framePipeline: api.DiscoveredPipeline = {
  config: {
    fileKind: "image",
    functionName: "frame-metadata-extractor",
    extensions: [".exr", ".dpx", ".tif"],
    targetSchema: "frame_metadata",
    targetTable: "files",
    sidecarSchemaId: "frame@1",
    displayLabel: "Frame Metadata",
  },
  live: null,
  status: "vast-unreachable",
  statusDetail: "VAST not configured",
};

const videoPipeline: api.DiscoveredPipeline = {
  config: {
    fileKind: "video",
    functionName: "video-metadata-extractor",
    extensions: [".mp4", ".mov", ".mxf"],
    targetSchema: "video_metadata",
    targetTable: "files",
    sidecarSchemaId: "video@1",
  },
  live: {
    guid: "abc",
    name: "video-metadata-extractor",
    description: "Rich video metadata extraction",
    owner: { id: "262", name: "Sergio Soto" },
    createdAt: "2026-04-14T22:00:00Z",
    updatedAt: "2026-04-14T22:00:00Z",
    vrn: "vrn",
    lastRevisionNumber: 2,
  },
  status: "ok",
};

interface HookResult {
  pipelines: api.DiscoveredPipeline[];
  loading: boolean;
  error: api.ApiRequestError | null;
}

function Harness({ onUpdate }: { onUpdate: (r: HookResult) => void }) {
  const result = useDataEnginePipelines();
  onUpdate({ pipelines: result.pipelines, loading: result.loading, error: result.error });
  return null;
}

describe("useDataEnginePipelines", () => {
  beforeEach(() => {
    __resetPipelineCacheForTests();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches pipelines on first mount", async () => {
    const spy = vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
      pipelines: [framePipeline, videoPipeline],
    });

    let last: HookResult = { pipelines: [], loading: false, error: null };
    render(<Harness onUpdate={(r) => { last = r; }} />);

    await waitFor(() => expect(last.pipelines.length).toBe(2));
    expect(last.loading).toBe(false);
    expect(last.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("hits the cache on subsequent mounts without re-fetching", async () => {
    const spy = vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
      pipelines: [framePipeline],
    });
    let last: HookResult = { pipelines: [], loading: false, error: null };

    const first = render(<Harness onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.pipelines.length).toBe(1));
    first.unmount();

    render(<Harness onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.pipelines.length).toBe(1));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    __setPipelineCacheTtlForTests(0);
    const spy = vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
      pipelines: [framePipeline],
    });

    let last: HookResult = { pipelines: [], loading: false, error: null };
    const first = render(<Harness onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.pipelines.length).toBe(1));
    first.unmount();

    render(<Harness onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("exposes error on api failure", async () => {
    vi.spyOn(api, "fetchActiveDataEnginePipelines").mockRejectedValue(new api.ApiRequestError(503));
    let last: HookResult = { pipelines: [], loading: false, error: null };
    render(<Harness onUpdate={(r) => { last = r; }} />);
    await waitFor(() => expect(last.error).not.toBeNull());
    expect(last.error?.status).toBe(503);
    expect(last.pipelines).toEqual([]);
  });
});

describe("pure helpers", () => {
  const pipelines = [framePipeline, videoPipeline];

  it("findPipelineByFileKind", () => {
    expect(findPipelineByFileKind(pipelines, "image")?.config.functionName).toBe(
      "frame-metadata-extractor",
    );
    expect(findPipelineByFileKind(pipelines, "video")?.config.functionName).toBe(
      "video-metadata-extractor",
    );
    expect(findPipelineByFileKind(pipelines, "raw_camera")).toBeUndefined();
  });

  it("findPipelineBySidecarSchemaId", () => {
    expect(findPipelineBySidecarSchemaId(pipelines, "frame@1")?.config.fileKind).toBe("image");
    expect(findPipelineBySidecarSchemaId(pipelines, "video@1")?.config.fileKind).toBe("video");
    expect(findPipelineBySidecarSchemaId(pipelines, "unknown@1")).toBeUndefined();
  });

  it("findPipelineForFilename — case insensitive match", () => {
    expect(findPipelineForFilename(pipelines, "shot.0042.EXR")?.config.fileKind).toBe("image");
    expect(findPipelineForFilename(pipelines, "A001C003.mov")?.config.fileKind).toBe("video");
    expect(findPipelineForFilename(pipelines, "notes.pdf")).toBeUndefined();
    expect(findPipelineForFilename(pipelines, "README")).toBeUndefined();
    expect(findPipelineForFilename(pipelines, "")).toBeUndefined();
  });

  it("buildExtensionIndex — all extensions mapped to their fileKind", () => {
    const index = buildExtensionIndex(pipelines);
    expect(index.get(".exr")).toBe("image");
    expect(index.get(".dpx")).toBe("image");
    expect(index.get(".mov")).toBe("video");
    expect(index.get(".mp4")).toBe("video");
    expect(index.size).toBe(6);
  });
});
