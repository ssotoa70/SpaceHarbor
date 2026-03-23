import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApprovalQueuePage } from "./ApprovalQueuePage";

vi.mock("../api", () => ({
  fetchApprovalQueue: vi.fn().mockResolvedValue({
    assets: [
      { id: "a1", title: "shot_010_v003.exr", status: "qc_pending", sourceUri: "/review/shot010.mov", jobId: "j1" },
      { id: "a2", title: "shot_020_v001.exr", status: "qc_pending", sourceUri: "/review/shot020.mov", jobId: "j2" },
    ],
    total: 2,
  }),
  approveAsset: vi.fn().mockResolvedValue(undefined),
  rejectAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/RejectDialog", () => ({
  RejectDialog: () => <div data-testid="reject-dialog">Reject Dialog</div>,
}));

describe("ApprovalQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders approval queue heading", () => {
    render(<ApprovalQueuePage />);
    expect(screen.getByText("Approval Queue")).toBeInTheDocument();
  });

  it("renders queue items after loading", async () => {
    render(<ApprovalQueuePage />);
    expect(await screen.findByText("shot_010_v003.exr")).toBeInTheDocument();
    expect(screen.getByText("shot_020_v001.exr")).toBeInTheDocument();
  });

  it("renders approve, hold, and reject buttons per item", async () => {
    render(<ApprovalQueuePage />);
    await screen.findByText("shot_010_v003.exr");
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Reject" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /Hold/ }).length).toBe(2);
  });

  it("renders checkboxes for bulk selection", async () => {
    render(<ApprovalQueuePage />);
    await screen.findByText("shot_010_v003.exr");
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
  });
});
