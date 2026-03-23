import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MyQueuePage } from "./MyQueuePage";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchWorkQueue: vi.fn().mockResolvedValue([
      { id: "t-1", taskName: "Comp pass", shotCode: "SH010", sequenceName: "SEQ_A", status: "in_progress", priority: "high", assignee: "artist@studio.com", dueDate: "2026-03-20", createdAt: "2026-03-14T10:00:00Z", updatedAt: "2026-03-16T08:30:00Z" },
      { id: "t-2", taskName: "Roto cleanup", shotCode: "SH020", sequenceName: "SEQ_A", status: "pending", priority: "normal", assignee: "artist@studio.com", dueDate: null, createdAt: "2026-03-15T09:00:00Z", updatedAt: "2026-03-15T09:00:00Z" },
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
      <MyQueuePage />
    </MemoryRouter>,
  );
}

describe("MyQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page title", () => {
    renderPage();
    expect(screen.getByText("My Queue")).toBeDefined();
  });

  it("renders status tabs", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("queue-tabs")).toBeDefined();
      expect(screen.getByTestId("queue-tab-all")).toBeDefined();
      expect(screen.getByTestId("queue-tab-pending")).toBeDefined();
      expect(screen.getByTestId("queue-tab-in_progress")).toBeDefined();
    });
  });

  it("renders task table with data", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByTestId("queue-table")).toBeDefined();
      expect(screen.getByText("Comp pass")).toBeDefined();
      expect(screen.getByText("Roto cleanup")).toBeDefined();
    });
  });

  it("filters by tab", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText("Comp pass")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("queue-tab-pending"));
    await vi.waitFor(() => {
      expect(screen.getByText("Roto cleanup")).toBeDefined();
      expect(screen.queryByText("Comp pass")).toBeNull();
    });
  });

  it("shows project name in description", async () => {
    renderPage();
    await vi.waitFor(() => {
      expect(screen.getByText(/Project Alpha/)).toBeDefined();
    });
  });
});
