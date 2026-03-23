import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ShotBoardPage } from "./ShotBoardPage";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchShotBoard: vi.fn().mockResolvedValue({
      columns: [
        {
          status: "not_started",
          shots: [
            { id: "s-1", code: "SH050", sequenceName: "SEQ_C", status: "not_started", assignee: null, frameRange: { start: 1001, end: 1060 }, latestVersionLabel: null, priority: "normal", updatedAt: "2026-03-13T09:00:00Z" },
          ],
        },
        {
          status: "in_progress",
          shots: [
            { id: "s-2", code: "SH010", sequenceName: "SEQ_A", status: "in_progress", assignee: "alice@studio.com", frameRange: { start: 1001, end: 1120 }, latestVersionLabel: "v003", priority: "high", updatedAt: "2026-03-16T08:30:00Z" },
          ],
        },
        { status: "review", shots: [] },
        { status: "approved", shots: [] },
      ],
    }),
  };
});

// Mock ProjectContext
vi.mock("../contexts/ProjectContext", () => ({
  useProject: () => ({
    project: { id: "proj-1", label: "Project Alpha", type: "project" },
    projects: [],
    loading: false,
    selectProject: vi.fn(),
    refreshProjects: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ShotBoardPage />
    </MemoryRouter>,
  );
}

describe("ShotBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page title", () => {
    renderPage();
    expect(screen.getByText("Shot Board")).toBeDefined();
  });

  it("renders kanban columns", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("shot-board-columns")).toBeDefined();
      expect(screen.getByTestId("board-column-not_started")).toBeDefined();
      expect(screen.getByTestId("board-column-in_progress")).toBeDefined();
    });
  });

  it("renders shot cards with code and assignee", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("SH050")).toBeDefined();
      expect(screen.getByText("SH010")).toBeDefined();
      expect(screen.getByText("alice@studio.com")).toBeDefined();
    });
  });

  it("renders frame range on cards", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText(/1001–1120/)).toBeDefined();
    });
  });

  it("shows version label badge", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("v003")).toBeDefined();
    });
  });

  it("shows project in description", async () => {
    renderPage();
    expect(screen.getByText(/Project Alpha/)).toBeDefined();
  });
});
