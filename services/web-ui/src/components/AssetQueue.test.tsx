import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";

import { AssetQueue } from "./AssetQueue";

vi.mock("../api");

const mockAssets = [
  {
    id: "a1",
    jobId: "j1",
    title: "Shot_001.exr",
    sourceUri: "/vast/media/shot_001.exr",
    status: "qc_pending" as const,
    createdAt: "2026-03-01T10:00:00Z",
    metadata: { resolution: { width: 1920, height: 1080 }, frame_range: { start: 1, end: 48 } }
  },
  {
    id: "a2",
    jobId: "j2",
    title: "Shot_002.exr",
    sourceUri: "/vast/media/shot_002.exr",
    status: "qc_in_review" as const,
    createdAt: "2026-03-02T10:00:00Z"
  }
];

describe("AssetQueue", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders approval queue heading and column headers", async () => {
    vi.mocked(api.fetchApprovalQueue).mockResolvedValue({ assets: [], total: 0 });

    render(<AssetQueue onSelectAsset={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Approval Queue" })).toBeInTheDocument();
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("displays asset rows with metadata", async () => {
    vi.mocked(api.fetchApprovalQueue).mockResolvedValue({ assets: mockAssets, total: 2 });

    render(<AssetQueue onSelectAsset={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Shot_001.exr")).toBeInTheDocument();
    });
    expect(screen.getByText("1920x1080")).toBeInTheDocument();
    expect(screen.getByText("1-48")).toBeInTheDocument();
    expect(screen.getByText("Shot_002.exr")).toBeInTheDocument();
  });

  it("calls onSelectAsset when a row is clicked", async () => {
    vi.mocked(api.fetchApprovalQueue).mockResolvedValue({ assets: mockAssets, total: 2 });
    const onSelect = vi.fn();

    render(<AssetQueue onSelectAsset={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("Shot_001.exr")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Shot_001.exr"));
    expect(onSelect).toHaveBeenCalledWith(mockAssets[0]);
  });

  it("shows empty state when no assets", async () => {
    vi.mocked(api.fetchApprovalQueue).mockResolvedValue({ assets: [], total: 0 });

    render(<AssetQueue onSelectAsset={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No assets in approval queue.")).toBeInTheDocument();
    });
  });
});
