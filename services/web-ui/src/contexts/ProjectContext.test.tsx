import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProjectProvider, useProject } from "./ProjectContext";

// Mock API
vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    fetchHierarchy: vi.fn().mockResolvedValue([
      { id: "proj-1", label: "Project Alpha", type: "project", children: [] },
      { id: "proj-2", label: "Project Beta", type: "project", children: [] },
    ]),
  };
});

// In-memory localStorage mock
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

function TestConsumer() {
  const { project, projects, loading, selectProject } = useProject();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="project-count">{projects.length}</span>
      <span data-testid="selected">{project?.label ?? "none"}</span>
      <button data-testid="select-beta" onClick={() => selectProject("proj-2")}>
        Select Beta
      </button>
      <button data-testid="clear" onClick={() => selectProject(null)}>
        Clear
      </button>
    </div>
  );
}

describe("ProjectContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("throws when useProject is used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useProject must be used within ProjectProvider",
    );
    spy.mockRestore();
  });

  it("loads projects and auto-selects first", async () => {
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("project-count").textContent).toBe("2");
    });

    expect(screen.getByTestId("selected").textContent).toBe("Project Alpha");
  });

  it("persists selection to localStorage", async () => {
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("project-count").textContent).toBe("2");
    });

    await act(async () => {
      screen.getByTestId("select-beta").click();
    });

    expect(screen.getByTestId("selected").textContent).toBe("Project Beta");
    expect(localStorageMock.setItem).toHaveBeenCalledWith("ah_project", "proj-2");
  });

  it("restores selection from localStorage", async () => {
    store["ah_project"] = "proj-2";

    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("selected").textContent).toBe("Project Beta");
    });
  });

  it("clears selection", async () => {
    render(
      <ProjectProvider>
        <TestConsumer />
      </ProjectProvider>,
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("project-count").textContent).toBe("2");
    });

    await act(async () => {
      screen.getByTestId("clear").click();
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith("ah_project");
  });
});
