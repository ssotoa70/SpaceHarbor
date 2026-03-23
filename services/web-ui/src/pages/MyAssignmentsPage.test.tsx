import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MyAssignmentsPage } from "./MyAssignmentsPage";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchWorkAssignments: vi.fn().mockResolvedValue([
      { id: "a-1", entityType: "shot", entityId: "shot-010", label: "SH010 — Hero", shotCode: "SH010", sequenceName: "SEQ_A", status: "in_progress", frameRange: { start: 1001, end: 1120 }, assignee: "artist@studio.com", updatedAt: "2026-03-16T08:30:00Z" },
      { id: "a-2", entityType: "version", entityId: "ver-021", label: "SH020_comp_v003", shotCode: "SH020", sequenceName: "SEQ_A", status: "pending_review", frameRange: null, assignee: "artist@studio.com", updatedAt: "2026-03-15T17:00:00Z" },
    ]),
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
      <MyAssignmentsPage />
    </MemoryRouter>,
  );
}

describe("MyAssignmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page title", () => {
    renderPage();
    expect(screen.getByText("My Assignments")).toBeDefined();
  });

  it("renders assignment cards", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("assignments-list")).toBeDefined();
      expect(screen.getByText("SH010 — Hero")).toBeDefined();
      expect(screen.getByText("SH020_comp_v003")).toBeDefined();
    });
  });

  it("filters by entity type", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("SH010 — Hero")).toBeDefined();
    });

    fireEvent.change(screen.getByTestId("type-filter"), { target: { value: "version" } });
    await vi.waitFor(() => {
      expect(screen.getByText("SH020_comp_v003")).toBeDefined();
      expect(screen.queryByText("SH010 — Hero")).toBeNull();
    });
  });

  it("shows project context in description", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText(/Project Alpha/)).toBeDefined();
    });
  });

  it("shows type badges", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("Shot")).toBeDefined();
      expect(screen.getByText("Version")).toBeDefined();
    });
  });
});
