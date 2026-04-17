import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetAssetMetadataCacheForTests } from "../hooks/useAssetMetadata";
import { __resetPipelineCacheForTests } from "../hooks/useDataEnginePipelines";
import { MetadataTab } from "./AssetDetailPanel";
import type { AssetRow } from "../types";

/** Matching the seed values for the live cluster — used by every test
 *  that exercises the empty-state copy which names the responsible
 *  function. The MetadataTab uses `findPipelineForFilename` against
 *  this list to decide which function name to show. */
const frameDiscovered: api.DiscoveredPipeline = {
  config: {
    fileKind: "image",
    functionName: "frame-metadata-extractor",
    extensions: [".exr", ".dpx", ".tif", ".tiff", ".png"],
    targetSchema: "frame_metadata",
    targetTable: "files",
    sidecarSchemaId: "frame@1",
  },
  live: null,
  status: "vast-unreachable",
};
const videoDiscovered: api.DiscoveredPipeline = {
  config: {
    fileKind: "video",
    functionName: "video-metadata-extractor",
    extensions: [".mp4", ".mov", ".mxf"],
    targetSchema: "video_metadata",
    targetTable: "files",
    sidecarSchemaId: "video@1",
  },
  live: null,
  status: "vast-unreachable",
};

const imageAsset: AssetRow = {
  id: "asset-exr",
  jobId: null,
  title: "shot_010.0042.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/shot_010.0042.exr",
  status: "pending",
};

function stubPipelinesApi() {
  vi.spyOn(api, "fetchActiveDataEnginePipelines").mockResolvedValue({
    pipelines: [frameDiscovered, videoDiscovered],
  });
}

function stubAssetMetadataApi(resp: Partial<api.AssetMetadataResponse> = {}) {
  vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue({
    assetId: imageAsset.id,
    sourceUri: imageAsset.sourceUri,
    fileKind: "image",
    pipeline: { functionName: "frame-metadata-extractor",
                targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
    sources: { db: "empty", sidecar: "missing" },
    dbRows: [], sidecar: null,
    ...resp,
  });
}

describe("MetadataTab", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
    __resetPipelineCacheForTests();
    stubPipelinesApi();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders source badges + db rows on happy path", async () => {
    stubAssetMetadataApi({
      sources: { db: "ok", sidecar: "missing" },
      dbRows: [{ source_uri: "uploads/shot_010.0042.exr", width: 2048, height: 858, codec: "exr" }],
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/DB · ok/)).toBeInTheDocument());
    expect(screen.getByText(/Sidecar · missing/)).toBeInTheDocument();
    expect(screen.getByText(/width/)).toBeInTheDocument();
    expect(screen.getByText(/2048/)).toBeInTheDocument();
  });

  it("surfaces db unreachable message", async () => {
    stubAssetMetadataApi({
      sources: { db: "unreachable", sidecar: "missing" },
      dbError: "circuit 'vast-trino' is OPEN",
      dbRows: [],
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/DB · unreachable/)).toBeInTheDocument());
    expect(screen.getByText(/circuit 'vast-trino' is OPEN/)).toBeInTheDocument();
  });

  it("names the responsible pipeline function in the empty state when both sources are empty", async () => {
    stubAssetMetadataApi({ sources: { db: "empty", sidecar: "missing" }, dbRows: [], sidecar: null });
    render(<MetadataTab asset={imageAsset} />);
    // The function name appears in both the badge area span and the empty-state paragraph
    await waitFor(() => expect(screen.getAllByText(/frame-metadata-extractor/).length).toBeGreaterThanOrEqual(1));
    // Verify the empty-state paragraph specifically mentions it
    expect(screen.getByText(/No metadata yet — frame-metadata-extractor/)).toBeInTheDocument();
  });

  it("shows sidecar JSON when only sidecar is present", async () => {
    stubAssetMetadataApi({
      sources: { db: "empty", sidecar: "ok" },
      dbRows: [],
      sidecar: { width: 2048, height: 858, codec: "exr" },
    });
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByText(/Sidecar · ok/)).toBeInTheDocument());
    expect(screen.getByText(/"width": 2048/)).toBeInTheDocument();
  });
});
