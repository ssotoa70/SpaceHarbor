import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import * as api from "../api";
import { useAssetMetadata, __resetAssetMetadataCacheForTests } from "./useAssetMetadata";

const sampleResponse: api.AssetMetadataResponse = {
  assetId: "asset-1",
  sourceUri: "s3://sergio-spaceharbor/uploads/x.exr",
  fileKind: "image",
  pipeline: {
    functionName: "frame-metadata-extractor",
    targetSchema: "frame_metadata",
    targetTable: "files",
    sidecarSchemaId: "frame@1",
  },
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [{ width: 2048 }],
  sidecar: null,
};

describe("useAssetMetadata", () => {
  beforeEach(() => {
    __resetAssetMetadataCacheForTests();
    vi.restoreAllMocks();
  });

  it("starts in loading, transitions to ready with data", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue(sampleResponse);
    const { result } = renderHook(() => useAssetMetadata("asset-1"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data?.sources.db).toBe("ok");
  });

  it("reuses cache for the same assetId within TTL", async () => {
    const spy = vi.spyOn(api, "fetchAssetMetadata").mockResolvedValue(sampleResponse);
    const { result: r1 } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(r1.current.status).toBe("ready"));
    const { result: r2 } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(r2.current.status).toBe("ready"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces error status when fetch throws", async () => {
    vi.spyOn(api, "fetchAssetMetadata").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAssetMetadata("asset-1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/boom/);
  });

  it("returns idle for null assetId", () => {
    const { result } = renderHook(() => useAssetMetadata(null));
    expect(result.current.status).toBe("idle");
  });
});
