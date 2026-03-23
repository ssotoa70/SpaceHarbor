import { useState, useEffect, useCallback } from "react";
import { fetchWorkAssignments } from "../api";
import type { WorkAssignment } from "../api";
import { useProject } from "../contexts/ProjectContext";


const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-[var(--color-ah-text-subtle)]/20 text-[var(--color-ah-text-subtle)]",
  in_progress: "bg-[var(--color-ah-info)]/20 text-[var(--color-ah-info)]",
  pending_review: "bg-[var(--color-ah-warning)]/20 text-[var(--color-ah-warning)]",
  approved: "bg-[var(--color-ah-success)]/20 text-[var(--color-ah-success)]",
  final: "bg-[var(--color-ah-accent)]/20 text-[var(--color-ah-accent)]",
};

const TYPE_LABELS: Record<string, string> = {
  shot: "Shot",
  version: "Version",
};

export function MyAssignmentsPage() {
  const { project } = useProject();
  const [assignments, setAssignments] = useState<WorkAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "shot" | "version">("all");

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchWorkAssignments(project?.id);
      setAssignments(result);
    } catch {
      setAssignments([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const filtered =
    typeFilter === "all"
      ? assignments
      : assignments.filter((a) => a.entityType === typeFilter);

  return (
    <div data-testid="my-assignments-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">My Assignments</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Shots and versions owned by you{project ? ` in ${project.label}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | "shot" | "version")}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text)] border border-[var(--color-ah-border-muted)]"
            data-testid="type-filter"
          >
            <option value="all">All Types</option>
            <option value="shot">Shots</option>
            <option value="version">Versions</option>
          </select>
          <button
            onClick={loadAssignments}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-overlay)] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="assignments-error">
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">Unable to load assignments</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">The API could not be reached. Check your connection and try again.</p>
          <button
            onClick={loadAssignments}
            className="px-4 py-2 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="assignments-empty">
          <div className="text-4xl mb-4 opacity-40">&#x1F4CB;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No assignments</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            Shot and version assignments will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="assignments-list">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-4 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] hover:border-[var(--color-ah-border)] transition-colors"
              data-testid={`assignment-${item.id}`}
            >
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)]">
                  {TYPE_LABELS[item.entityType] ?? item.entityType}
                </span>
                <div>
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5">
                    <span className="font-[var(--font-ah-mono)]">{item.shotCode}</span>
                    <span className="mx-1.5 text-[var(--color-ah-border)]">/</span>
                    {item.sequenceName}
                    {item.frameRange && (
                      <>
                        <span className="mx-1.5 text-[var(--color-ah-border)]">|</span>
                        {item.frameRange.start}–{item.frameRange.end}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] ?? STATUS_COLORS.not_started}`}>
                  {item.status.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-[var(--color-ah-text-subtle)]">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
