import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchHierarchy } from "../api";
import type { HierarchyNode } from "../api";

/* ── Types ── */

export interface ProjectContextValue {
  /** Currently selected project, or null if none */
  project: HierarchyNode | null;
  /** All available projects */
  projects: HierarchyNode[];
  /** True while the project list is loading */
  loading: boolean;
  /** Select a project by id (persists to localStorage) */
  selectProject: (projectId: string | null) => void;
  /** Refresh the project list from the API */
  refreshProjects: () => void;
}

const STORAGE_KEY = "ah_project";

const ProjectContext = createContext<ProjectContextValue | null>(null);

/* ── Provider ── */

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<HierarchyNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const nodes = await fetchHierarchy();
      const projectNodes = nodes.filter((n) => n.type === "project");
      setProjects(projectNodes);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const selectProject = useCallback((projectId: string | null) => {
    setSelectedId(projectId);
    try {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const project = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  // Auto-select first project when list loads and nothing is selected
  useEffect(() => {
    if (!loading && projects.length > 0 && !project) {
      selectProject(projects[0].id);
    }
  }, [loading, projects, project, selectProject]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      project,
      projects,
      loading,
      selectProject,
      refreshProjects: loadProjects,
    }),
    [project, projects, loading, selectProject, loadProjects],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
