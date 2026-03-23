import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { FeedbackPage } from "./FeedbackPage";

vi.mock("../api", () => ({
  fetchRejectedFeedback: vi.fn().mockResolvedValue([
    {
      id: "r1",
      title: "shot_030_v001.exr",
      sourceUri: "/var/204/vfx/shot_030/shot_030.exr",
      status: "qc_rejected",
      jobId: "j3",
      rejectionReason: "Motion blur artifacts on frames 45-60",
      rejectedBy: "supervisor",
      rejectedAt: "2026-03-13T10:00:00Z",
      comments: [
        { id: "c1", body: "Fix blur on left edge", frameNumber: 45, timecode: "00:00:01:21", authorId: "supervisor", status: "open", createdAt: "2026-03-13T10:00:00Z" },
      ],
    },
  ]),
  resubmitVersion: vi.fn().mockResolvedValue(undefined),
}));

describe("FeedbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders feedback heading", () => {
    render(<FeedbackPage />);
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  it("renders rejected items after loading", async () => {
    render(<FeedbackPage />);
    expect(await screen.findByText("shot_030_v001.exr")).toBeInTheDocument();
  });

  it("shows rejection reason", async () => {
    render(<FeedbackPage />);
    await screen.findByText("shot_030_v001.exr");
    expect(screen.getByText(/Motion blur artifacts/)).toBeInTheDocument();
  });

  it("renders resubmit button", async () => {
    render(<FeedbackPage />);
    await screen.findByText("shot_030_v001.exr");
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeInTheDocument();
  });

  it("shows rejected badge", async () => {
    render(<FeedbackPage />);
    await screen.findByText("shot_030_v001.exr");
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });
});
