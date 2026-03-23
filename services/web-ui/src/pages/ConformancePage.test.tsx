import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ConformancePage } from "./ConformancePage";

vi.mock("../api", () => ({
  fetchTimelines: vi.fn().mockResolvedValue([
    {
      id: "tl1",
      name: "Episode 01 Edit",
      totalFrames: 2400,
      tracks: [
        {
          name: "V1",
          clips: [
            { id: "c1", name: "shot_010", source: "src", startFrame: 0, endFrame: 100, conformStatus: "matched" },
            { id: "c2", name: "shot_020", source: "src", startFrame: 100, endFrame: 200, conformStatus: "unmatched" },
            { id: "c3", name: "shot_030", source: "src", startFrame: 200, endFrame: 300, conformStatus: "conflict" },
          ],
        },
      ],
    },
  ]),
}));

describe("ConformancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders conformance heading", () => {
    render(<ConformancePage />);
    expect(screen.getByText("Conformance")).toBeInTheDocument();
  });

  it("renders summary cards after loading", async () => {
    render(<ConformancePage />);
    expect(await screen.findByText("Total Clips")).toBeInTheDocument();
    // "Matched", "Unmatched", "Conflicts" appear as both card labels and table headers
    expect(screen.getAllByText("Matched").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Unmatched").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Conflicts").length).toBeGreaterThanOrEqual(1);
  });

  it("renders timeline name", async () => {
    render(<ConformancePage />);
    expect(await screen.findByText("Episode 01 Edit")).toBeInTheDocument();
  });

  it("shows correct clip counts in summary", async () => {
    render(<ConformancePage />);
    await screen.findByText("Episode 01 Edit");
    // Total clips = 3, appears in summary and in table row
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
  });
});
