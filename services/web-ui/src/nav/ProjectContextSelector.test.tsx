import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectContextSelector } from "./ProjectContextSelector";

// Mock the ProjectContext hook
const mockSelectProject = vi.fn();
const mockProjectContext = {
  project: { id: "proj-1", label: "Project Alpha", type: "project" as const, children: [] },
  projects: [
    { id: "proj-1", label: "Project Alpha", type: "project" as const, children: [] },
    { id: "proj-2", label: "Project Beta", type: "project" as const, children: [] },
  ],
  loading: false,
  selectProject: mockSelectProject,
  refreshProjects: vi.fn(),
};

vi.mock("../contexts/ProjectContext", () => ({
  useProject: () => mockProjectContext,
}));

describe("ProjectContextSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectContext.loading = false;
    mockProjectContext.projects = [
      { id: "proj-1", label: "Project Alpha", type: "project" as const, children: [] },
      { id: "proj-2", label: "Project Beta", type: "project" as const, children: [] },
    ];
    mockProjectContext.project = mockProjectContext.projects[0];
  });

  it("renders the selector with current project", () => {
    render(<ProjectContextSelector />);
    expect(screen.getByTestId("project-selector")).toBeDefined();
    expect(screen.getByText("Project Alpha")).toBeDefined();
  });

  it("shows loading state", () => {
    mockProjectContext.loading = true;
    render(<ProjectContextSelector />);
    expect(screen.getByTestId("project-selector-loading")).toBeDefined();
  });

  it("shows empty state when no projects", () => {
    mockProjectContext.projects = [];
    mockProjectContext.project = null;
    render(<ProjectContextSelector />);
    expect(screen.getByTestId("project-selector-empty")).toBeDefined();
    expect(screen.getByText("No projects")).toBeDefined();
  });

  it("opens dropdown on click", () => {
    render(<ProjectContextSelector />);
    fireEvent.click(screen.getByTestId("project-selector-trigger"));
    expect(screen.getByTestId("project-selector-dropdown")).toBeDefined();
    expect(screen.getByTestId("project-option-proj-1")).toBeDefined();
    expect(screen.getByTestId("project-option-proj-2")).toBeDefined();
  });

  it("selects a project from the dropdown", () => {
    render(<ProjectContextSelector />);
    fireEvent.click(screen.getByTestId("project-selector-trigger"));
    fireEvent.click(screen.getByTestId("project-option-proj-2"));
    expect(mockSelectProject).toHaveBeenCalledWith("proj-2");
  });
});
