import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { __resetSidecarCacheForTests } from "../hooks/useStorageSidecar";
import { MetadataTab } from "./AssetDetailPanel";
import type { AssetRow } from "../types";

const videoAsset: AssetRow = {
  id: "asset-video",
  jobId: null,
  title: "lola-vfx-480.mov",
  sourceUri: "s3://sergio-spaceharbor/uploads/lola-vfx-480.mov",
  status: "pending",
};

const imageAsset: AssetRow = {
  id: "asset-exr",
  jobId: null,
  title: "shot_010.0042.exr",
  sourceUri: "s3://sergio-spaceharbor/uploads/shot_010.0042.exr",
  status: "pending",
};

const audioAsset: AssetRow = {
  id: "asset-audio",
  jobId: null,
  title: "narration.wav",
  sourceUri: "s3://sergio-spaceharbor/audio/narration.wav",
  status: "pending",
};

function videoSidecarResponse(): api.StorageMetadataResponse {
  return {
    schema_version: "1.0.0",
    file_kind: "video",
    source_uri: videoAsset.sourceUri,
    sidecar_key: "uploads/.proxies/lola-vfx-480_metadata.json",
    bucket: "sergio-spaceharbor",
    bytes: 2216,
    data: {
      $schema: "https://vastdata.com/schemas/video-metadata-sidecar/v1.json",
      schema_version: "1.0.0",
      metadata: {
        container_format: "MPEG-4",
        file_size_bytes: 27426798,
        video_codec: "h264",
        video_codec_profile: "Main@L3",
        width: 640,
        height: 360,
        fps_num: 24000,
        fps_den: 1001,
        fps: 23.976,
        duration_seconds: 94.719,
        audio_codec: "aac",
        audio_channels: 2,
        audio_sample_rate_hz: 48000,
      },
    },
  };
}

describe("MetadataTab", () => {
  beforeEach(() => {
    __resetSidecarCacheForTests();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the dynamic VideoMetadataRenderer when a video sidecar is available", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(videoSidecarResponse());
    render(<MetadataTab asset={videoAsset} />);
    await waitFor(() => expect(screen.getByTestId("metadata-tab")).toBeInTheDocument());
    // Video@1 detected → groups rendered
    expect(screen.getByTestId("meta-group-container")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-video")).toBeInTheDocument();
    // Specific formatted values
    expect(screen.getAllByText(/Main@L3/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("640 × 360").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("23.976 fps").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the empty state naming the correct function when the sidecar is missing", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(null);
    render(<MetadataTab asset={imageAsset} />);
    await waitFor(() => expect(screen.getByTestId("metadata-tab-empty")).toBeInTheDocument());
    expect(screen.getByText(/frame-metadata-extractor/)).toBeInTheDocument();
  });

  it("names video-metadata-extractor in the empty state for unprocessed videos", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(null);
    render(<MetadataTab asset={videoAsset} />);
    await waitFor(() => expect(screen.getByTestId("metadata-tab-empty")).toBeInTheDocument());
    expect(screen.getByText(/video-metadata-extractor/)).toBeInTheDocument();
  });

  it("shows 'not processed by any metadata function' for audio files", async () => {
    const spy = vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue(null);
    render(<MetadataTab asset={audioAsset} />);
    // audio is ineligible — hook shouldn't fetch
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId("metadata-tab-empty")).toBeInTheDocument();
    expect(screen.getByText(/not processed by any metadata function/i)).toBeInTheDocument();
  });

  it("renders an error state when the API throws", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockRejectedValue(new api.ApiRequestError(503));
    render(<MetadataTab asset={videoAsset} />);
    await waitFor(() => expect(screen.getByTestId("metadata-tab-error")).toBeInTheDocument());
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it("falls through to a raw JSON view for unknown sidecar schemas", async () => {
    vi.spyOn(api, "fetchStorageMetadata").mockResolvedValue({
      schema_version: null,
      file_kind: "video",
      source_uri: videoAsset.sourceUri,
      sidecar_key: "k",
      bucket: "b",
      bytes: 10,
      data: { totally_unknown_field: "foo" },
    });
    render(<MetadataTab asset={videoAsset} />);
    await waitFor(() => expect(screen.getByTestId("metadata-tab")).toBeInTheDocument());
    expect(screen.getByText(/Raw sidecar/)).toBeInTheDocument();
    expect(screen.getByText(/totally_unknown_field/)).toBeInTheDocument();
  });
});
