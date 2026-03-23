import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { TranscodingPage } from "./TranscodingPage";

vi.mock("../api", () => ({
  fetchAssets: vi.fn().mockResolvedValue([
    { id: "a1", title: "shot_010_v003.exr", status: "processing", sourceUri: "/data/shot010.exr", jobId: "j1", metadata: { codec: "h264" } },
    { id: "a2", title: "shot_020_v001.exr", status: "completed", sourceUri: "/data/shot020.exr", jobId: "j2", proxy: { uri: "/proxy/shot020.mp4", durationSeconds: 10, codec: "h264", generatedAt: "2026-03-15T10:00:00Z" } },
    { id: "a3", title: "shot_030_v001.exr", status: "completed", sourceUri: "/data/shot030.exr", jobId: "j3" },
  ]),
}));

describe("TranscodingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders transcoding heading", () => {
    render(<TranscodingPage />);
    expect(screen.getByText("Transcoding")).toBeInTheDocument();
  });

  it("renders summary cards after loading", async () => {
    render(<TranscodingPage />);
    expect(await screen.findByText("Active Encodes")).toBeInTheDocument();
    expect(screen.getByText("Proxies Ready")).toBeInTheDocument();
    // "Missing Proxies" appears both as summary card label and as section heading
    expect(screen.getAllByText("Missing Proxies").length).toBeGreaterThanOrEqual(1);
  });

  it("shows processing assets as active encodes", async () => {
    render(<TranscodingPage />);
    expect(await screen.findByText("shot_010_v003.exr")).toBeInTheDocument();
  });

  it("shows assets without proxies", async () => {
    render(<TranscodingPage />);
    expect(await screen.findByText("shot_030_v001.exr")).toBeInTheDocument();
  });
});
