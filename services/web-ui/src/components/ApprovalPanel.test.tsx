import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";

import { ApprovalPanel } from "./ApprovalPanel";

vi.mock("../api");

const mockAsset = {
  id: "a1",
  jobId: "j1",
  title: "Shot_001.exr",
  sourceUri: "/vast/media/shot_001.exr",
  status: "qc_pending" as const,
  metadata: {
    resolution: { width: 1920, height: 1080 },
    frame_range: { start: 1, end: 48 },
    codec: "OpenEXR",
    frame_rate: 24,
    file_size_bytes: 52428800
  }
};

describe("ApprovalPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows empty state when no asset selected", () => {
    render(<ApprovalPanel asset={null} onActionComplete={vi.fn()} />);

    expect(screen.getByText("Select an asset from the queue to view details.")).toBeInTheDocument();
  });

  it("displays asset metadata", () => {
    render(<ApprovalPanel asset={mockAsset} onActionComplete={vi.fn()} />);

    expect(screen.getByText("Shot_001.exr")).toBeInTheDocument();
    expect(screen.getByText("1920 x 1080")).toBeInTheDocument();
    expect(screen.getByText("1 - 48")).toBeInTheDocument();
    expect(screen.getByText("OpenEXR")).toBeInTheDocument();
    expect(screen.getByText("24 fps")).toBeInTheDocument();
    expect(screen.getByText("50.00 MB")).toBeInTheDocument();
  });

  it("calls approveAsset on Approve click", async () => {
    vi.mocked(api.approveAsset).mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(<ApprovalPanel asset={mockAsset} onActionComplete={onComplete} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(api.approveAsset).toHaveBeenCalledWith("a1");
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it("shows reject reason input on first Reject click, submits on second", async () => {
    vi.mocked(api.rejectAsset).mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(<ApprovalPanel asset={mockAsset} onActionComplete={onComplete} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByLabelText("Rejection Reason")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Rejection Reason"), "Bad framing");
    await userEvent.click(screen.getByRole("button", { name: "Confirm Reject" }));

    await waitFor(() => {
      expect(api.rejectAsset).toHaveBeenCalledWith("a1", "Bad framing");
    });
  });

  it("displays error toast on API failure", async () => {
    vi.mocked(api.approveAsset).mockRejectedValue(new Error("Server error"));

    render(<ApprovalPanel asset={mockAsset} onActionComplete={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    });
  });

  it("shows WIP review status badge when reviewStatus is wip", () => {
    render(<ApprovalPanel asset={{ ...mockAsset, reviewStatus: "wip" }} onActionComplete={vi.fn()} />);
    expect(screen.getByTestId("review-status-badge")).toHaveTextContent("WIP");
  });

  it("shows Internal Review badge when reviewStatus is internal_review", () => {
    render(<ApprovalPanel asset={{ ...mockAsset, reviewStatus: "internal_review" }} onActionComplete={vi.fn()} />);
    expect(screen.getByTestId("review-status-badge")).toHaveTextContent("Internal Review");
  });

  it("shows Approved badge when reviewStatus is approved", () => {
    render(<ApprovalPanel asset={{ ...mockAsset, reviewStatus: "approved" }} onActionComplete={vi.fn()} />);
    expect(screen.getByTestId("review-status-badge")).toHaveTextContent("Approved");
  });

  it("shows no review status badge when reviewStatus is absent", () => {
    render(<ApprovalPanel asset={mockAsset} onActionComplete={vi.fn()} />);
    expect(screen.queryByTestId("review-status-badge")).not.toBeInTheDocument();
  });
});
