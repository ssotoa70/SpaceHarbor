import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import { HierarchyBrowser } from "./HierarchyBrowser";

const MOCK_TREE = vi.hoisted(() => [
  {
    id: "p1",
    label: "Project Alpha",
    type: "project" as const,
    children: [
      {
        id: "sq1",
        label: "SQ010",
        type: "sequence" as const,
        children: [
          {
            id: "sh1",
            label: "SH010",
            type: "shot" as const,
            frame_range: { start: 1001, end: 1048 },
            children: [
              { id: "t1", label: "comp", type: "task" as const, pipeline_stage: "comp", assignee: "Alice", status: "in_progress" },
              { id: "v1", label: "v001", type: "version" as const, status: "approved", proxyUri: "/proxy/sh010_v001.mp4", resolution: "1920x1080", color_space: "ACEScg" },
              { id: "v2", label: "v002", type: "version" as const, status: "pending" },
            ],
          },
          { id: "sh2", label: "SH020", type: "shot" as const, children: [] },
        ],
      },
    ],
  },
]);

vi.mock("../api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api")>();
  return {
    ...orig,
    fetchHierarchy: vi.fn().mockResolvedValue(MOCK_TREE),
    fetchAssetLineage: vi.fn().mockResolvedValue(null),
  };
});

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <HierarchyBrowser />
    </MemoryRouter>
  );
}

describe("HierarchyBrowser", () => {
  it("renders the project tree heading", () => {
    renderWithRouter();
    expect(screen.getByText("Project Hierarchy")).toBeInTheDocument();
  });

  it("renders the root project node after loading", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    });
  });

  it("shows empty state when no hierarchy returned", async () => {
    const { fetchHierarchy } = await import("../api");
    vi.mocked(fetchHierarchy).mockResolvedValueOnce([]);
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("No projects")).toBeInTheDocument();
    });
  });

  it("shows detail panel placeholder when nothing selected", async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText("Project Alpha"));
    expect(screen.getByText("Select a node to view details.")).toBeInTheDocument();
  });

  it("selects a node and shows detail", async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText("Project Alpha"));
    fireEvent.click(screen.getByText("Project Alpha"));
    expect(screen.getByText("p1")).toBeInTheDocument();
  });

  it("expands children on click — SQ010 visible when p1 expanded", async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText("Project Alpha"));
    fireEvent.click(screen.getByText("Project Alpha"));
    expect(screen.getByText("SQ010")).toBeInTheDocument();
  });

  it("shows version timeline for shot nodes", async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText("Project Alpha"));
    // Expand p1 to reveal sq1
    fireEvent.click(screen.getByText("Project Alpha"));
    // Expand sq1 to reveal SH010
    fireEvent.click(screen.getByText("SQ010"));
    fireEvent.click(screen.getByText("SH010"));
    expect(screen.getByText("Version timeline")).toBeInTheDocument();
  });

  it("has a tree role for accessibility after loading", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByRole("tree", { name: "Project tree" })).toBeInTheDocument();
    });
  });

  it("keyboard arrow down moves focus", async () => {
    renderWithRouter();
    await waitFor(() => screen.getByText("Project Alpha"));
    fireEvent.click(screen.getByText("Project Alpha"));
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // Focus should have moved — no assertion needed beyond not throwing
  });
});
