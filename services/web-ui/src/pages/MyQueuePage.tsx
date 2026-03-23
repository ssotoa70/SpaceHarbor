import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchWorkQueue } from "../api";
import type { WorkQueueItem, WorkTaskStatus } from "../api";
import { useProject } from "../contexts/ProjectContext";


type TabFilter = "all" | WorkTaskStatus;

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

const STATUS_COLORS: Record<WorkTaskStatus, string> = {
  pending: "bg-[var(--color-ah-warning)]/20 text-[var(--color-ah-warning)]",
  in_progress: "bg-[var(--color-ah-info)]/20 text-[var(--color-ah-info)]",
  blocked: "bg-[var(--color-ah-danger)]/20 text-[var(--color-ah-danger)]",
  done: "bg-[var(--color-ah-success)]/20 text-[var(--color-ah-success)]",
};

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: "text-[var(--color-ah-danger)]",
  high: "text-[var(--color-ah-warning)]",
  normal: "text-[var(--color-ah-text-muted)]",
  low: "text-[var(--color-ah-text-subtle)]",
};

export function MyQueuePage() {
  const { project } = useProject();
  const [tasks, setTasks] = useState<WorkQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabFilter>("all");

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchWorkQueue(project?.id);
      setTasks(result);
    } catch {
      setTasks([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filtered = useMemo(() => {
    if (tab === "all") return tasks;
    return tasks.filter((t) => t.status === tab);
  }, [tasks, tab]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  return (
    <div data-testid="my-queue-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">My Queue</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Tasks assigned to you{project ? ` in ${project.label}` : ""}
          </p>
        </div>
        <button
          onClick={loadTasks}
          className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--color-ah-border-muted)]" data-testid="queue-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
              tab === t.key
                ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
                : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
            }`}
            data-testid={`queue-tab-${t.key}`}
          >
            {t.label}
            {(tabCounts[t.key] ?? 0) > 0 && (
              <span className="ml-1.5 text-xs opacity-60">({tabCounts[t.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="queue-error">
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">Unable to load tasks</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">The API could not be reached. Check your connection and try again.</p>
          <button
            onClick={loadTasks}
            className="px-4 py-2 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="queue-empty">
          <div className="text-4xl mb-4 opacity-40">&#x2713;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No tasks in your queue</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            {tab !== "all"
              ? `No tasks with status "${tab.replace("_", " ")}".`
              : "Tasks assigned to you will appear here."}
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="queue-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Shot</th>
                <th className="px-4 py-2.5 font-medium">Sequence</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                  data-testid={`queue-row-${task.id}`}
                >
                  <td className="px-4 py-3 font-medium">{task.taskName}</td>
                  <td className="px-4 py-3 font-[var(--font-ah-mono)] text-xs">{task.shotCode}</td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">{task.sequenceName}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}>
                      {task.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-xs font-medium capitalize ${PRIORITY_INDICATORS[task.priority]}`}>
                    {task.priority}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs">
                    {task.dueDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
