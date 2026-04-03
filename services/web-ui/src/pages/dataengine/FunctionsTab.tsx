import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "../../design-system/Button";
import { Skeleton } from "../../design-system/Skeleton";
import { fetchVastFunctions, deleteVastFunction } from "../../api/dataengine-proxy";
import type { VastFunction } from "../../types/dataengine";
import { FunctionCreateModal } from "./FunctionCreateModal";
import { FunctionRevisionsPanel } from "./FunctionRevisionsPanel";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

export function FunctionsTab() {
  const [functions, setFunctions] = useState<VastFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expandedGuid, setExpandedGuid] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VastFunction | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const loadFunctions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVastFunctions();
      setFunctions(result);
    } catch (err) {
      setFunctions([]);
      setError(err instanceof Error ? err.message : "Failed to load functions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFunctions();
  }, [loadFunctions]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return functions;
    const q = debouncedQuery.toLowerCase();
    return functions.filter(
      (fn) =>
        fn.name.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q),
    );
  }, [functions, debouncedQuery]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteVastFunction(deleteTarget.guid);
      setDeleteTarget(null);
      if (expandedGuid === deleteTarget.guid) setExpandedGuid(null);
      await loadFunctions();
    } catch {
      // Keep modal open on failure — user can retry
    }
  }

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

  return (
    <div data-testid="functions-tab">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-ah-text)]">
          Functions
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search functions..."
            className="w-64 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
            data-testid="functions-search"
          />
          <Button
            variant="ghost"
            onClick={loadFunctions}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => setCreateModalOpen(true)}
          >
            Create Function
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3" data-testid="functions-loading">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height="3rem" />
          ))}
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="functions-error"
        >
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            Unable to load functions
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">
            {error}
          </p>
          <Button variant="primary" onClick={loadFunctions}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="functions-empty"
        >
          <div className="text-4xl mb-4 opacity-40">f(x)</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            {debouncedQuery ? "No matching functions" : "No functions yet"}
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            {debouncedQuery
              ? "Try a different search term."
              : "Create your first DataEngine function to get started."}
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="functions-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Revisions</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((fn) => (
                <Fragment key={fn.guid}>
                  <tr
                    className={`border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors cursor-pointer ${
                      expandedGuid === fn.guid ? "bg-[var(--color-ah-bg-overlay)]" : ""
                    }`}
                    onClick={() =>
                      setExpandedGuid((prev) => (prev === fn.guid ? null : fn.guid))
                    }
                    data-testid={`function-row-${fn.guid}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{fn.name}</div>
                      {fn.description && (
                        <div className="text-xs text-[var(--color-ah-text-subtle)] mt-0.5 truncate max-w-xs">
                          {fn.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">
                      {fn.owner || "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">
                      {fn.revision_count}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs">
                      {formatDate(fn.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(fn);
                        }}
                        className="text-[var(--color-ah-danger)] hover:text-[var(--color-ah-danger)]"
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                  {expandedGuid === fn.guid && (
                    <tr>
                      <td colSpan={5}>
                        <FunctionRevisionsPanel functionGuid={fn.guid} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <FunctionCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={loadFunctions}
      />

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="Delete Function"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ""}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

