import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import alexaFixture from "./metadata/fixtures/arri-alexa-prores.json";
import { AssetMetadataPanel } from "./AssetMetadataPanel";
import type { AssetRow } from "../types";

const videoAsset: AssetRow = {
  id: "asset-1",
  jobId: null,
  title: "A001C003_240213.mov",
  sourceUri: "s3://sergio-spaceharbor/footage/shot_010/A001C003_240213.mov",
  status: "completed",
};

const imageAsset: AssetRow = {
  id: "asset-2",
  jobId: null,
  title: "shot_010.0042.exr",
  sourceUri: "s3://sergio-spaceharbor/footage/shot_010/shot_010.0042.exr",
  status: "completed",
  metadata: {
    codec: "OpenEXR",
    resolution: { width: 3840, height: 2160 },
  },
};

describe("AssetMetadataPanel dispatcher", () => {
  afterEach(() => cleanup());

  it("renders dynamic VideoMetadataRenderer when asset is video and sidecar is a video@1 envelope", () => {
    render(<AssetMetadataPanel asset={videoAsset} sidecar={alexaFixture} />);
    expect(screen.getByTestId("asset-metadata-panel-video-dynamic")).toBeInTheDocument();
    expect(screen.getByTestId("video-metadata-renderer")).toBeInTheDocument();
    // Dynamic renderer should show the codec profile from the fixture
    expect(screen.getAllByText(/Apple ProRes 4444 XQ/).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the legacy File Info section when asset is an image", () => {
    render(<AssetMetadataPanel asset={imageAsset} />);
    expect(screen.queryByTestId("asset-metadata-panel-video-dynamic")).toBeNull();
    expect(screen.getByText("File Info")).toBeInTheDocument();
  });

  it("falls back to legacy when sidecar is missing even for video assets", () => {
    render(<AssetMetadataPanel asset={videoAsset} />);
    expect(screen.queryByTestId("asset-metadata-panel-video-dynamic")).toBeNull();
    expect(screen.getByText("File Info")).toBeInTheDocument();
  });

  it("falls back to legacy when sidecar is not a video@1 envelope", () => {
    render(
      <AssetMetadataPanel
        asset={videoAsset}
        sidecar={{ schema_version: 1, parts: [] }}
      />,
    );
    expect(screen.queryByTestId("asset-metadata-panel-video-dynamic")).toBeNull();
    expect(screen.getByText("File Info")).toBeInTheDocument();
  });
});
