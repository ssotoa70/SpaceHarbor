import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import alexaFixture from "./fixtures/arri-alexa-prores.json";
import { VideoMetadataRenderer } from "./VideoMetadataRenderer";

describe("VideoMetadataRenderer", () => {
  afterEach(() => cleanup());

  it("renders all populated groups from the ARRI Alexa fixture", () => {
    render(<VideoMetadataRenderer payload={alexaFixture} />);
    expect(screen.getByTestId("meta-group-container")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-video")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-color_hdr")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-audio")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-editorial")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-camera")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-production")).toBeInTheDocument();
    expect(screen.getByTestId("meta-group-provenance")).toBeInTheDocument();
  });

  it("formats derived values correctly (fps, file size, bit rate, aperture, iso)", () => {
    render(<VideoMetadataRenderer payload={alexaFixture} />);
    // Timeline fps + sensor fps both render "23.976 fps" → use getAllByText.
    expect(screen.getAllByText("23.976 fps").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("808.0 MB")).toBeInTheDocument();
    expect(screen.getByText("120 Mbps")).toBeInTheDocument();
    expect(screen.getByText("T2.8")).toBeInTheDocument();
    expect(screen.getByText("ISO 800")).toBeInTheDocument();
    expect(screen.getAllByText(/Apple ProRes 4444 XQ/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("3840 × 2160")).toBeInTheDocument();
  });

  it("formats HDR light level fields with units", () => {
    render(<VideoMetadataRenderer payload={alexaFixture} />);
    expect(screen.getByText("1000 nits")).toBeInTheDocument();
    expect(screen.getByText("400 nits")).toBeInTheDocument();
  });

  it("hides a group when every field is absent", () => {
    const minimal = { schema_version: "1.0.0", metadata: { video_codec: "h264", width: 1280, height: 720 } };
    render(<VideoMetadataRenderer payload={minimal} />);
    expect(screen.queryByTestId("meta-group-camera")).toBeNull();
    expect(screen.queryByTestId("meta-group-audio")).toBeNull();
    expect(screen.queryByTestId("meta-group-color_hdr")).toBeNull();
  });

  it("places unknown top-level fields under the Other group", () => {
    const withExtra = {
      schema_version: "1.0.0",
      metadata: {
        video_codec: "h264",
        width: 1920,
        height: 1080,
        experimental_super_codec: "XYZ-42",
      },
    };
    render(<VideoMetadataRenderer payload={withExtra} />);
    const otherGroup = screen.getByTestId("meta-group-other");
    expect(otherGroup).toBeInTheDocument();
    expect(otherGroup.textContent).toContain("experimental_super_codec");
    expect(otherGroup.textContent).toContain("XYZ-42");
  });

  it("renders a friendly message on invalid envelope instead of crashing", () => {
    render(<VideoMetadataRenderer payload={null} />);
    expect(screen.getByTestId("metadata-empty")).toBeInTheDocument();
  });

  it("renders a friendly message on a non-video envelope", () => {
    render(<VideoMetadataRenderer payload={{ schema_version: 1, parts: [] }} />);
    expect(screen.getByTestId("metadata-empty")).toBeInTheDocument();
  });
});
