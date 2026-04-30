import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetHeaderBar } from "./AssetHeaderBar";
import type { AssetMetadataResponse } from "../api";

const baseMetadata: AssetMetadataResponse = {
  assetId: "asset-1",
  sourceUri: "s3://bucket/01_beauty.exr",
  fileKind: "image",
  pipeline: null,
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [{}],
  sidecar: null,
};

describe("<AssetHeaderBar /> empty-state", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when metadata is null", () => {
    const { container } = render(<AssetHeaderBar metadata={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when frame_number, timecode, and AOV rows are all empty", () => {
    const { container } = render(<AssetHeaderBar metadata={baseMetadata} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("<AssetHeaderBar /> slot rendering", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the frame counter when frame_number is set", () => {
    render(
      <AssetHeaderBar
        metadata={{ ...baseMetadata, dbRows: [{ frame_number: 1001 }] }}
      />,
    );
    expect(screen.getByText(/Frame 1001/)).toBeInTheDocument();
  });

  it("renders frame 0 (zero is a valid frame, not a missing value)", () => {
    render(
      <AssetHeaderBar
        metadata={{ ...baseMetadata, dbRows: [{ frame_number: 0 }] }}
      />,
    );
    expect(screen.getByText(/Frame 0/)).toBeInTheDocument();
  });

  it("renders the timecode when timecode_value is present (via dbExtras.timecode)", () => {
    render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbRows: [{}],
          dbExtras: { timecode: [{ value: "01:00:04:01", rate: 24 }] },
        }}
      />,
    );
    expect(screen.getByText("01:00:04:01")).toBeInTheDocument();
  });

  it("renders one pill per AOV layer with a color dot", () => {
    const { container } = render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbRows: [{}],
          dbExtras: {
            channels: [
              { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
              { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("diffuse")).toBeInTheDocument();
    expect(screen.getByText("normals")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-testid='asset-header-bar-pill-dot']")).toHaveLength(2);
  });

  it("hides the frame counter slot when frame_number is undefined but timecode is present", () => {
    render(
      <AssetHeaderBar
        metadata={{
          ...baseMetadata,
          dbExtras: { timecode: [{ value: "01:00:04:01" }] },
        }}
      />,
    );
    expect(screen.queryByText(/Frame /)).toBeNull();
    expect(screen.getByText("01:00:04:01")).toBeInTheDocument();
  });
});

describe("<AssetHeaderBar /> pill interactivity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const aovMetadata: AssetMetadataResponse = {
    ...baseMetadata,
    dbRows: [{}],
    dbExtras: {
      channels: [
        { channel_name: "R", layer_name: "diffuse", channel_type: "FLOAT" },
        { channel_name: "X", layer_name: "normals", channel_type: "FLOAT" },
      ],
    },
  };

  it("renders pills as non-interactive when onAovChange is not provided", () => {
    render(<AssetHeaderBar metadata={aovMetadata} />);
    const pills = screen.getAllByText(/diffuse|normals/);
    for (const pill of pills) {
      const closestRole = pill.closest("[role='button']");
      expect(closestRole).toBeNull();
    }
  });

  it("renders pills as buttons when onAovChange is provided", () => {
    render(<AssetHeaderBar metadata={aovMetadata} onAovChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("calls onAovChange with the layer name on click", () => {
    const onAovChange = vi.fn();
    render(<AssetHeaderBar metadata={aovMetadata} onAovChange={onAovChange} />);
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(onAovChange).toHaveBeenCalledWith("diffuse");
  });

  it("clicking the active pill calls onAovChange(null) (single-select toggle)", () => {
    const onAovChange = vi.fn();
    render(
      <AssetHeaderBar
        metadata={aovMetadata}
        activeAov="diffuse"
        onAovChange={onAovChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /diffuse/ }));
    expect(onAovChange).toHaveBeenCalledWith(null);
  });

  it("the active pill has aria-pressed='true'; others have aria-pressed='false'", () => {
    render(
      <AssetHeaderBar
        metadata={aovMetadata}
        activeAov="diffuse"
        onAovChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /diffuse/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /normals/ })).toHaveAttribute("aria-pressed", "false");
  });
});
