import { useMemo, useState } from "react";

import type { AssetRow } from "../api";
import {
  preflightBulkReplay,
  runBulkReplay,
  type BulkReplayCandidate,
  type BulkReplayRowOutcome,
  type BulkReplayRunResult,
  type BulkReplaySkipReason
} from "../queue/bulk-replay";
import {
  applyQueueFilters,
  buildSupervisorSummary,
  sortQueueRows,
  toAgingBucketLabel,
  toSupervisorBlockerReasonSummaryItems,
  toSupervisorDependencyReadinessSummaryItems,
  toQueueViewRow,
  toSortedUniqueValues,
  toStatusLabel,
  toSupervisorAgingSummaryItems,
  toSupervisorPrioritySummaryItems,
  toSupervisorStatusSummaryItems
} from "../queue/view-model";

interface SupervisorBoardProps {
  assets: AssetRow[];
  nowMs?: number;
  onReplayJob?: (jobId: string) => Promise<void>;
}

type SelectValue = "all" | string;

function toSkipReasonLabel(reason: BulkReplaySkipReason): string {
  return reason.replaceAll("_", " ");
}

function toBulkReplayCandidate(row: ReturnType<typeof toQueueViewRow>): BulkReplayCandidate {
  return {
    id: row.id,
    title: row.title,
    jobId: row.jobId,
    status: row.status,
    dependencyReadiness: {
      ready: row.dependencyReadiness.ready
    }
  };
}

export function SupervisorBoard({ assets, nowMs, onReplayJob }: SupervisorBoardProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SelectValue>("all");
  const [priorityFilter, setPriorityFilter] = useState<SelectValue>("all");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [confirmRows, setConfirmRows] = useState<BulkReplayCandidate[] | null>(null);
  const [runResult, setRunResult] = useState<BulkReplayRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const resolvedNowMs = nowMs ?? Date.now();

  const rows = useMemo(() => {
    const nextRows = assets.map((asset) => toQueueViewRow(asset, resolvedNowMs));
    return sortQueueRows(nextRows);
  }, [assets, resolvedNowMs]);

  const summary = useMemo(() => buildSupervisorSummary(rows), [rows]);
  const statusSummaryItems = useMemo(() => toSupervisorStatusSummaryItems(summary), [summary]);
  const agingSummaryItems = useMemo(() => toSupervisorAgingSummaryItems(summary), [summary]);
  const prioritySummaryItems = useMemo(() => toSupervisorPrioritySummaryItems(summary), [summary]);
  const dependencyReadinessSummaryItems = useMemo(() => toSupervisorDependencyReadinessSummaryItems(summary), [summary]);
  const blockerReasonSummaryItems = useMemo(() => toSupervisorBlockerReasonSummaryItems(summary), [summary]);
  const statusOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.status)), [rows]);

  const filteredRows = useMemo(() => {
    const filtered = applyQueueFilters(rows, {
      query: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : (priorityFilter as NonNullable<AssetRow["productionMetadata"]>["priority"])
    });

    return sortQueueRows(filtered);
  }, [priorityFilter, query, rows, statusFilter]);

  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const selectedRows = useMemo(
    () => selectedRowIds.map((rowId) => rowById.get(rowId)).filter((row): row is ReturnType<typeof toQueueViewRow> => Boolean(row)),
    [rowById, selectedRowIds]
  );

  const selectedCandidates = useMemo(() => selectedRows.map((row) => toBulkReplayCandidate(row)), [selectedRows]);
  const selectedPreflight = useMemo(() => preflightBulkReplay(selectedCandidates), [selectedCandidates]);
  const failedFromLatestRun = useMemo(() => {
    if (!runResult) {
      return [] as BulkReplayCandidate[];
    }

    return runResult.outcomes
      .filter((outcome) => outcome.outcome === "failed")
      .map((outcome) => outcome.row);
  }, [runResult]);
  const confirmPreflight = useMemo(() => {
    if (!confirmRows) {
      return null;
    }

    return preflightBulkReplay(confirmRows);
  }, [confirmRows]);
  const hasSelection = selectedCandidates.length > 0;
  const isReplayHandlerAvailable = Boolean(onReplayJob);

  function toggleRowSelection(rowId: string): void {
    setSelectedRowIds((previous) => {
      if (previous.includes(rowId)) {
        return previous.filter((id) => id !== rowId);
      }

      return [...previous, rowId];
    });
  }

  function clearSelection(): void {
    setSelectedRowIds([]);
    setConfirmRows(null);
    setRunResult(null);
  }

  async function executeBulkReplay(rowsToRun: BulkReplayCandidate[]): Promise<void> {
    if (!onReplayJob) {
      setConfirmRows(null);
      return;
    }

    setIsRunning(true);
    try {
      const result = await runBulkReplay(rowsToRun, async (row) => {
        if (!row.jobId) {
          return;
        }

        await onReplayJob(row.jobId);
      });
      setRunResult(result);
    } finally {
      setIsRunning(false);
      setConfirmRows(null);
    }
  }

  function resetFilters(): void {
    setQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
  }

  const emptyMessage = assets.length === 0 ? "No supervisor assets yet." : "No supervisor assets match the current filters.";

  return (
    <section className="panel" aria-labelledby="supervisor-heading">
      <h2 id="supervisor-heading">Supervisor Queue</h2>

      <div className="supervisor-filter-bar" aria-label="Supervisor queue filters">
        <label htmlFor="supervisor-search">
          Search queue
          <input id="supervisor-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>

        <label htmlFor="supervisor-status-filter">
          Status filter
          <select
            id="supervisor-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">all</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {toStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="supervisor-priority-filter">
          Priority filter
          <select
            id="supervisor-priority-filter"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">all</option>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>

        <button type="button" onClick={resetFilters}>
          Reset filters
        </button>
      </div>

      <div className="supervisor-summary-grid">
        <article className="supervisor-summary-card" aria-label="Total assets">
          <h3>Total assets</h3>
          <p className="supervisor-summary-value">{summary.total}</p>
        </article>

        <article className="supervisor-summary-card" data-testid="supervisor-summary-status">
          <h3>Status mix</h3>
          <ul className="supervisor-summary-list">
            {statusSummaryItems.map((item) => (
              <li key={item.key}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>
        </article>

        <article className="supervisor-summary-card" data-testid="supervisor-summary-aging">
          <h3>Aging buckets</h3>
          <ul className="supervisor-summary-list">
            {agingSummaryItems.map((item) => (
              <li key={item.key}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>
        </article>

        <article className="supervisor-summary-card" data-testid="supervisor-summary-priority">
          <h3>Priority mix</h3>
          <ul className="supervisor-summary-list">
            {prioritySummaryItems.map((item) => (
              <li key={item.key}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>
        </article>

        <article className="supervisor-summary-card" data-testid="supervisor-summary-dependency-readiness">
          <h3>Dependency readiness</h3>
          <ul className="supervisor-summary-list">
            {dependencyReadinessSummaryItems.map((item) => (
              <li key={item.key}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>

          <p className="supervisor-summary-subheading">Blocker reason distribution</p>
          <ul className="supervisor-summary-list">
            {blockerReasonSummaryItems.map((item) => (
              <li key={item.key}>
                {item.label}: {item.count}
              </li>
            ))}
          </ul>
        </article>
      </div>

      {hasSelection ? (
        <div className="supervisor-bulk-panel" aria-live="polite">
          <h3>Bulk replay</h3>
          <p className="supervisor-bulk-summary">Selected: {selectedCandidates.length}</p>
          <p className="supervisor-bulk-summary">Eligible: {selectedPreflight.eligible.length}</p>
          <p className="supervisor-bulk-summary">Blocked: {selectedPreflight.blocked.length}</p>
          {!isReplayHandlerAvailable ? (
            <p className="supervisor-bulk-summary">Bulk replay unavailable: replay handler is not configured.</p>
          ) : null}

          <div className="supervisor-bulk-actions">
            <button
              type="button"
              onClick={() => {
                setConfirmRows(selectedCandidates);
              }}
              disabled={isRunning || !isReplayHandlerAvailable}
            >
              Run replay for eligible
            </button>
            <button type="button" onClick={clearSelection} disabled={isRunning}>
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRows(failedFromLatestRun);
              }}
              disabled={isRunning || !isReplayHandlerAvailable || failedFromLatestRun.length === 0}
            >
              Retry failed only
            </button>
          </div>

          {confirmRows && confirmPreflight ? (
            <div className="supervisor-bulk-confirmation" role="alert">
              <p>
                Confirm replay for {confirmPreflight.eligible.length} eligible row
                {confirmPreflight.eligible.length === 1 ? "" : "s"}?
              </p>
              <div className="supervisor-bulk-actions">
                <button
                  type="button"
                  onClick={() => {
                    void executeBulkReplay(confirmRows);
                  }}
                  disabled={isRunning || !isReplayHandlerAvailable}
                >
                  Confirm replay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRows(null);
                  }}
                  disabled={isRunning}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {runResult?.haltedReason === "rate_limited" ? (
            <p className="supervisor-bulk-safety-stop">
              Replay stopped after a 429 rate-limit response. Remaining eligible rows were skipped.
            </p>
          ) : null}

          {runResult ? (
            <ul className="supervisor-bulk-results" aria-label="Bulk replay results">
              {runResult.outcomes.map((outcome: BulkReplayRowOutcome) => {
                if (outcome.outcome === "failed") {
                  return (
                    <li key={outcome.row.id}>
                      {outcome.row.title} - failed ({outcome.error})
                    </li>
                  );
                }

                if (outcome.outcome === "skipped") {
                  return (
                    <li key={outcome.row.id}>
                      {outcome.row.title} - skipped ({toSkipReasonLabel(outcome.reason)})
                    </li>
                  );
                }

                return <li key={outcome.row.id}>{outcome.row.title} - replayed</li>;
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <table className="supervisor-compact-table" aria-label="Supervisor compact queue">
        <thead>
          <tr>
            <th scope="col">Select</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Owner</th>
            <th scope="col">Aging</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td colSpan={6} aria-live="polite">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            filteredRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title}`}
                    checked={selectedRowIds.includes(row.id)}
                    onChange={() => {
                      toggleRowSelection(row.id);
                    }}
                  />
                </td>
                <td>{row.title}</td>
                <td>
                  <span className={`status status-${row.status}`}>status: {toStatusLabel(row.status)}</span>
                </td>
                <td>
                  {row.productionMetadata?.priority ? (
                    <span className="supervisor-priority-chip">priority: {row.productionMetadata.priority}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{row.productionMetadata?.owner ?? "-"}</td>
                <td>
                  <span className={`supervisor-aging-chip supervisor-aging-${row.agingBucket}`}>
                    aging: {toAgingBucketLabel(row.agingBucket)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
