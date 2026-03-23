import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchDeliveryStatus } from "../api";
import type { DeliveryItem, DeliveryStatus } from "../api";
import { useProject } from "../contexts/ProjectContext";


const STATUS_STYLES: Record<DeliveryStatus, { bg: string; label: string }> = {
  not_ready: { bg: "bg-[var(--color-ah-text-subtle)]/20 text-[var(--color-ah-text-subtle)]", label: "Not Ready" },
  in_progress: { bg: "bg-[var(--color-ah-info)]/20 text-[var(--color-ah-info)]", label: "In Progress" },
  ready: { bg: "bg-[var(--color-ah-success)]/20 text-[var(--color-ah-success)]", label: "Ready" },
  delivered: { bg: "bg-[var(--color-ah-accent)]/20 text-[var(--color-ah-accent)]", label: "Delivered" },
  rejected: { bg: "bg-[var(--color-ah-danger)]/20 text-[var(--color-ah-danger)]", label: "Rejected" },
};

export function DeliveryTrackerPage() {
  const { project } = useProject();
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | DeliveryStatus>("all");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchDeliveryStatus(project?.id);
      setItems(result);
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? items : items.filter((i) => i.status === statusFilter)),
    [items, statusFilter],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      counts[i.status] = (counts[i.status] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  return (
    <div data-testid="delivery-tracker-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Delivery Tracker</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Track deliverable status{project ? ` for ${project.label}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | DeliveryStatus)}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text)] border border-[var(--color-ah-border-muted)]"
            data-testid="status-filter"
          >
            <option value="all">All Status</option>
            <option value="not_ready">Not Ready</option>
            <option value="in_progress">In Progress</option>
            <option value="ready">Ready</option>
            <option value="delivered">Delivered</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            onClick={loadItems}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-3 mb-4 flex-wrap" data-testid="delivery-summary">
        {(Object.entries(STATUS_STYLES) as [DeliveryStatus, { bg: string; label: string }][]).map(([status, style]) => (
          <div
            key={status}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${style.bg}`}
          >
            {style.label}: {statusCounts[status] ?? 0}
          </div>
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
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="delivery-error">
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">Unable to load deliveries</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">The API could not be reached. Check your connection and try again.</p>
          <button
            onClick={loadItems}
            className="px-4 py-2 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="delivery-empty">
          <div className="text-4xl mb-4 opacity-40">&#x1F69A;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No deliveries scheduled</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            Delivery items will appear when shots are marked for delivery.
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="delivery-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-4 py-2.5 font-medium">Shot</th>
                <th className="px-4 py-2.5 font-medium">Sequence</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Assignee</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const style = STATUS_STYLES[item.status];
                return (
                  <tr
                    key={item.id}
                    className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                    data-testid={`delivery-row-${item.id}`}
                  >
                    <td className="px-4 py-3 font-[var(--font-ah-mono)] text-xs font-medium">{item.shotCode}</td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">{item.sequenceName}</td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">{item.deliverableType}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style.bg}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ah-text-muted)]">{item.assignee ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ah-text-muted)]">{item.targetDate ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ah-text-subtle)] max-w-[200px] truncate">{item.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
