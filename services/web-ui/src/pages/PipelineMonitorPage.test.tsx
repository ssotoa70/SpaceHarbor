import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PipelineMonitorPage } from "./PipelineMonitorPage";

vi.mock("../api", () => ({
  fetchQueueItems: vi.fn().mockResolvedValue([
    { id: "q1", jobId: "j1", assetId: "a1", assetTitle: "shot_010_v003.exr", status: "processing", stage: "transcode", priority: 1, queuedAt: "2026-03-15T10:00:00Z", startedAt: "2026-03-15T10:01:00Z", completedAt: null },
    { id: "q2", jobId: "j2", assetId: "a2", assetTitle: "shot_020_v001.exr", status: "queued", stage: "metadata", priority: 2, queuedAt: "2026-03-15T10:02:00Z", startedAt: null, completedAt: null },
  ]),
  fetchDlqItems: vi.fn().mockResolvedValue([
    { id: "d1", jobId: "j3", assetId: "a3", assetTitle: "broken_file.exr", stage: "transcode", errorMessage: "Unsupported codec", retryCount: 3, firstFailedAt: "2026-03-14T08:00:00Z", lastFailedAt: "2026-03-15T08:00:00Z" },
  ]),
}));

describe("PipelineMonitorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pipeline monitor heading", () => {
    render(<PipelineMonitorPage />);
    expect(screen.getByText("Pipeline Monitor")).toBeInTheDocument();
  });

  it("renders summary cards after loading", async () => {
    render(<PipelineMonitorPage />);
    // Active Jobs
    expect(await screen.findByText("Active Jobs")).toBeInTheDocument();
    // Queue Depth
    expect(screen.getByText("Queue Depth")).toBeInTheDocument();
    // DLQ Items
    expect(screen.getByText("DLQ Items")).toBeInTheDocument();
  });

  it("renders job items in the jobs tab", async () => {
    render(<PipelineMonitorPage />);
    expect(await screen.findByText("shot_010_v003.exr")).toBeInTheDocument();
    expect(screen.getByText("shot_020_v001.exr")).toBeInTheDocument();
  });

  it("shows Jobs and DLQ tabs", async () => {
    render(<PipelineMonitorPage />);
    await screen.findByText("shot_010_v003.exr");
    // Tab labels include counts like "Jobs (2)" and "DLQ (1)"
    expect(screen.getByText(/Jobs \(/)).toBeInTheDocument();
    expect(screen.getByText(/DLQ \(/)).toBeInTheDocument();
  });
});
