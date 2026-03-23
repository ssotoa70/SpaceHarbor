import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { TimelinePage } from "./TimelinePage";

const MOCK_TIMELINES = vi.hoisted(() => [
  {
    id: "t1",
    name: "edit_v3",
    tracks: [
      {
        name: "V1",
        clips: [
          { id: "c1", name: "sh010_plate_v002", source: "/shots/sh010.exr", startFrame: 1001, endFrame: 1048, conformStatus: "matched", matchedShotId: "sh010" },
          { id: "c2", name: "sh020_plate_v001", source: "/shots/sh020.exr", startFrame: 1048, endFrame: 1120, conformStatus: "matched", matchedShotId: "sh020" },
          { id: "c3", name: "missing_shot", source: "/shots/missing.exr", startFrame: 1120, endFrame: 1200, conformStatus: "unmatched" },
        ],
      },
      {
        name: "V2",
        clips: [
          { id: "c4", name: "overlay_title", source: "/gfx/title.mov", startFrame: 1001, endFrame: 1030, conformStatus: "conflict" },
        ],
      },
    ],
    totalFrames: 200,
  },
]);

vi.mock("../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api")>();
  return {
    ...orig,
    fetchTimelines: vi.fn().mockResolvedValue(MOCK_TIMELINES),
  };
});

describe("TimelinePage", () => {
  it("renders empty state when no timelines returned", async () => {
    const { fetchTimelines } = await import("../api");
    vi.mocked(fetchTimelines).mockResolvedValueOnce([]);
    render(<TimelinePage />);
    await waitFor(() => {
      expect(screen.getByText("No timelines")).toBeInTheDocument();
    });
  });

  it("renders timeline name after loading", async () => {
    render(<TimelinePage />);
    await waitFor(() => {
      expect(screen.getByText("edit_v3")).toBeInTheDocument();
    });
  });

  it("renders track names", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    expect(screen.getAllByText("V1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("V2").length).toBeGreaterThanOrEqual(1);
  });

  it("renders clip blocks", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    expect(screen.getAllByText("sh010_plate_v002").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("sh020_plate_v001").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("missing_shot").length).toBeGreaterThanOrEqual(1);
  });

  it("renders zoom controls", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    expect(screen.getAllByRole("button", { name: "-" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "+" }).length).toBeGreaterThanOrEqual(1);
  });

  it("zooms in on + click", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    const btns = screen.getAllByRole("button", { name: "+" });
    fireEvent.click(btns[0]);
    expect(screen.getByText(/125%/)).toBeInTheDocument();
  });

  it("renders conform status legend", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    expect(screen.getAllByText("matched").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("unmatched").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("conflict").length).toBeGreaterThanOrEqual(1);
  });

  it("opens clip popover on click", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    const clips = screen.getAllByText("sh010_plate_v002");
    fireEvent.click(clips[0]);
    expect(screen.getAllByRole("dialog").length).toBeGreaterThanOrEqual(1);
  });

  it("renders frame ruler", async () => {
    render(<TimelinePage />);
    await waitFor(() => screen.getByText("edit_v3"));
    expect(screen.getAllByLabelText("Frame ruler").length).toBeGreaterThanOrEqual(1);
  });
});
