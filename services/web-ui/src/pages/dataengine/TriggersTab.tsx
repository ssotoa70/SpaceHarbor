import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Badge, Button, Skeleton } from "../../design-system";
import { fetchVastTriggers, deleteVastTrigger } from "../../api/dataengine-proxy";
import type { VastTrigger } from "../../types/dataengine";
import { TriggerCreateModal } from "./TriggerCreateModal";

/* ── Helpers ── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function typeBadgeVariant(type: string) {
  return type === "schedule" ? ("orange" as const) : ("info" as const);
}

function typeLabel(type: string) {
  return type === "schedule" ? "Schedule" : "Element";
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "active":
    case "enabled":
      return "success" as const;
    case "disabled":
    case "paused":
      return "warning" as const;
    case "error":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

const inputClass =
  "w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)]";

/* ── Component ── */

export function TriggersTab() {
  const [triggers, setTriggers] = useState<VastTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const loadTriggers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVastTriggers();
      setTriggers(result);
    } catch (err) {
      setTriggers([]);
      setError(err instanceof Error ? err.message : "Failed to load triggers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTriggers();
  }, [loadTriggers]);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return triggers;
    const q = debouncedSearch.toLowerCase();
    return triggers.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        (t.topic ?? "").toLowerCase().includes(q),
    );
  }, [triggers, debouncedSearch]);

  const handleDelete = useCallback(
    async (guid: string) => {
      setDeleting(true);
      try {
        await deleteVastTrigger(guid);
        setDeleteTarget(null);
        await loadTriggers();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete trigger",
        );
      } finally {
        setDeleting(false);
      }
    },
    [loadTriggers],
  );

  return (
    <div data-testid="triggers-tab">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Triggers</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Manage VAST DataEngine event and schedule triggers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search triggers..."
            className={`${inputClass} max-w-[220px]`}
            data-testid="triggers-search"
          />
          <Button variant="ghost" onClick={loadTriggers} data-testid="triggers-refresh">
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            data-testid="triggers-create-btn"
          >
            Create Trigger
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3" data-testid="triggers-loading">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height="3rem" className="w-full" />
          ))}
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="triggers-error"
        >
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            Unable to load triggers
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">
            {error}
          </p>
          <Button variant="primary" onClick={loadTriggers} data-testid="triggers-retry">
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="triggers-empty"
        >
          <div className="text-4xl mb-4 opacity-40">&#x26A1;</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            No triggers found
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            {search
              ? "No triggers match your search. Try a different query."
              : "Create your first trigger to start event-driven processing."}
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="triggers-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Source / Schedule</th>
                <th className="px-4 py-2.5 font-medium">Topic</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((trigger) => (
                <tr
                  key={trigger.guid}
                  className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                  data-testid={`trigger-row-${trigger.guid}`}
                >
                  <td className="px-4 py-3 font-medium">{trigger.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={typeBadgeVariant(trigger.type)} data-testid={`trigger-type-${trigger.guid}`}>
                      {typeLabel(trigger.type)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(trigger.status)}>
                      {trigger.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)] text-xs">
                    {trigger.type === "schedule"
                      ? trigger.schedule_expression ?? "--"
                      : trigger.source_view ?? "--"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)] text-xs">
                    {trigger.topic ?? "--"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs">
                    {formatDate(trigger.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {deleteTarget === trigger.guid ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-[var(--color-ah-text-muted)]">
                          Delete?
                        </span>
                        <Button
                          variant="destructive"
                          disabled={deleting}
                          onClick={() => void handleDelete(trigger.guid)}
                          data-testid={`trigger-confirm-delete-${trigger.guid}`}
                        >
                          {deleting ? "..." : "Yes"}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setDeleteTarget(null)}
                          data-testid={`trigger-cancel-delete-${trigger.guid}`}
                        >
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => setDeleteTarget(trigger.guid)}
                        data-testid={`trigger-delete-${trigger.guid}`}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      <TriggerCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void loadTriggers();
        }}
      />
    </div>
  );
}
