import { useState, useRef, useEffect } from "react";
import { useProject } from "../contexts/ProjectContext";

/**
 * Dropdown selector for the active project context.
 * Placed at the top of the sidebar, above nav sections.
 */
export function ProjectContextSelector() {
  const { project, projects, loading, selectProject } = useProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (loading) {
    return (
      <div
        className="px-5 py-3 border-b border-[var(--color-ah-border-muted)]"
        data-testid="project-selector-loading"
      >
        <div className="h-8 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] animate-pulse" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div
        className="px-5 py-3 border-b border-[var(--color-ah-border-muted)] text-xs text-[var(--color-ah-text-subtle)]"
        data-testid="project-selector-empty"
      >
        No projects
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative px-5 py-3 border-b border-[var(--color-ah-border-muted)]"
      data-testid="project-selector"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-3 py-1.5 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-sm text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg)] transition-colors cursor-pointer"
        aria-label="Select project"
        data-testid="project-selector-trigger"
      >
        <span className="truncate">{project?.label ?? "Select project"}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-2 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M3 4l2 2 2-2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-5 right-5 mt-1 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] shadow-lg z-50 py-1 max-h-60 overflow-y-auto"
          data-testid="project-selector-dropdown"
        >
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                selectProject(p.id);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                p.id === project?.id
                  ? "text-[var(--color-ah-accent)] bg-[var(--color-ah-accent)]/8"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)]"
              }`}
              data-testid={`project-option-${p.id}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
