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
import type { DependencyReadinessReason } from "../queue/dependency-readiness";
import {
  applyQueueFilters,
  sortQueueRows,
  toQueueViewRow,
  toSortedUniqueValues
} from "../queue/view-model";

interface CoordinatorBoardProps {
  assets: AssetRow[];
  nowMs?: number;
  onReplayJob?: (jobId: string) => Promise<void>;
}

type SelectValue = "all" | string;
type ReadinessFilter = "all" | "ready" | "blocked";

function toReasonLabel(reason: DependencyReadinessReason): string {
  return reason.replaceAll("_", " ");
}

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

export function CoordinatorBoard({ assets, nowMs, onReplayJob }: CoordinatorBoardProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SelectValue>("all");
  const [priorityFilter, setPriorityFilter] = useState<SelectValue>("all");
  const [ownerFilter, setOwnerFilter] = useState<SelectValue>("all");
  const [vendorFilter, setVendorFilter] = useState<SelectValue>("all");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  const [blockerReasonFilter, setBlockerReasonFilter] = useState<SelectValue>("all");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [confirmRows, setConfirmRows] = useState<BulkReplayCandidate[] | null>(null);
  const [runResult, setRunResult] = useState<BulkReplayRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const resolvedNowMs = nowMs ?? Date.now();

  const rows = useMemo(() => assets.map((asset) => toQueueViewRow(asset, resolvedNowMs)), [assets, resolvedNowMs]);

  const filteredRows = useMemo(() => {
    const queueFiltered = applyQueueFilters(rows, {
      query: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : (priorityFilter as AssetRow["productionMetadata"]["priority"]),
      owner: ownerFilter === "all" ? undefined : ownerFilter,
      vendor: vendorFilter === "all" ? undefined : vendorFilter
    });

    const readinessFiltered = queueFiltered.filter((row) => {
      if (readinessFilter === "ready" && !row.dependencyReadiness.ready) {
        return false;
      }

      if (readinessFilter === "blocked" && !row.dependencyReadiness.blocked) {
        return false;
      }

      if (
        blockerReasonFilter !== "all" &&
        !row.dependencyReadiness.reasons.includes(blockerReasonFilter as DependencyReadinessReason)
      ) {
        return false;
      }

      return true;
    });

    return sortQueueRows(readinessFiltered);
  }, [blockerReasonFilter, ownerFilter, priorityFilter, query, readinessFilter, rows, statusFilter, vendorFilter]);

  const statusOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.status)), [rows]);
  const ownerOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.productionMetadata.owner)), [rows]);
  const vendorOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.productionMetadata.vendor)), [rows]);
  const blockerReasonOptions = useMemo(
    () =>
      toSortedUniqueValues(rows.flatMap((row) => row.dependencyReadiness.reasons)) as DependencyReadinessReason[],
    [rows]
  );

  const hasActiveFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    ownerFilter !== "all" ||
    vendorFilter !== "all" ||
    readinessFilter !== "all" ||
    blockerReasonFilter !== "all";

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
    setOwnerFilter("all");
    setVendorFilter("all");
    setReadinessFilter("all");
    setBlockerReasonFilter("all");
  }

  const emptyMessage =
    assets.length === 0 ? "No coordinator assets yet." : "No assets match the current filters.";

  return (
    <section className="panel" aria-labelledby="coordinator-heading">
      <h2 id="coordinator-heading">Coordinator Queue</h2>

      <div className="coordinator-filter-bar" aria-label="Coordinator queue filters">
        <label htmlFor="coordinator-search">
          Search queue
          <input
            id="coordinator-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <label htmlFor="coordinator-status-filter">
          Status filter
          <select
            id="coordinator-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">all</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="coordinator-priority-filter">
          Priority filter
          <select
            id="coordinator-priority-filter"
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

        <label htmlFor="coordinator-owner-filter">
          Owner filter
          <select
            id="coordinator-owner-filter"
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
          >
            <option value="all">all</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="coordinator-vendor-filter">
          Vendor filter
          <select
            id="coordinator-vendor-filter"
            value={vendorFilter}
            onChange={(event) => setVendorFilter(event.target.value)}
          >
            <option value="all">all</option>
            {vendorOptions.map((vendor) => (
              <option key={vendor} value={vendor}>
                {vendor}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="coordinator-readiness-filter">
          Readiness filter
          <select
            id="coordinator-readiness-filter"
            value={readinessFilter}
            onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}
          >
            <option value="all">all</option>
            <option value="ready">ready</option>
            <option value="blocked">blocked</option>
          </select>
        </label>

        <label htmlFor="coordinator-blocker-reason-filter">
          Blocker reason filter
          <select
            id="coordinator-blocker-reason-filter"
            value={blockerReasonFilter}
            onChange={(event) => setBlockerReasonFilter(event.target.value)}
          >
            <option value="all">all</option>
            {blockerReasonOptions.map((reason) => (
              <option key={reason} value={reason}>
                {toReasonLabel(reason)}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={resetFilters}>
          Reset all filters
        </button>
      </div>

      {hasActiveFilters ? (
        <div className="coordinator-filter-badges" aria-live="polite" aria-label="Active filters">
          {query.trim() ? <span className="coordinator-filter-badge">search: {query.trim()}</span> : null}
          {statusFilter !== "all" ? <span className="coordinator-filter-badge">status: {statusFilter}</span> : null}
          {priorityFilter !== "all" ? <span className="coordinator-filter-badge">priority: {priorityFilter}</span> : null}
          {ownerFilter !== "all" ? <span className="coordinator-filter-badge">owner: {ownerFilter}</span> : null}
          {vendorFilter !== "all" ? <span className="coordinator-filter-badge">vendor: {vendorFilter}</span> : null}
          {readinessFilter !== "all" ? <span className="coordinator-filter-badge">readiness: {readinessFilter}</span> : null}
          {blockerReasonFilter !== "all" ? (
            <span className="coordinator-filter-badge">blocker: {toReasonLabel(blockerReasonFilter as DependencyReadinessReason)}</span>
          ) : null}
        </div>
      ) : null}

      {hasSelection ? (
        <div className="coordinator-bulk-panel" aria-live="polite">
          <h3>Bulk replay</h3>
          <p className="coordinator-bulk-summary">Selected: {selectedCandidates.length}</p>
          <p className="coordinator-bulk-summary">Eligible: {selectedPreflight.eligible.length}</p>
          <p className="coordinator-bulk-summary">Blocked: {selectedPreflight.blocked.length}</p>
          {!isReplayHandlerAvailable ? (
            <p className="coordinator-bulk-summary">Bulk replay unavailable: replay handler is not configured.</p>
          ) : null}

          <div className="coordinator-bulk-actions">
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
            <div className="coordinator-bulk-confirmation" role="alert">
              <p>
                Confirm replay for {confirmPreflight.eligible.length} eligible row
                {confirmPreflight.eligible.length === 1 ? "" : "s"}?
              </p>
              <div className="coordinator-bulk-actions">
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

          {runResult ? (
            <ul className="coordinator-bulk-results" aria-label="Bulk replay results">
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

      <table>
        <thead>
          <tr>
            <th scope="col">Select</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Owner</th>
            <th scope="col">Vendor</th>
            <th scope="col">Age (min)</th>
            <th scope="col">Dependency readiness</th>
            <th scope="col">Blocker reasons</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td className="coordinator-empty-state" colSpan={9} aria-live="polite">
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
                  <span className={`status status-${row.status}`}>{row.status}</span>
                </td>
                <td>{row.productionMetadata.priority ?? "-"}</td>
                <td>{row.productionMetadata.owner ?? "-"}</td>
                <td>{row.productionMetadata.vendor ?? "-"}</td>
                <td>{row.ageMinutes}</td>
                <td>
                  <span
                    className={`coordinator-readiness coordinator-readiness-${
                      row.dependencyReadiness.blocked ? "blocked" : "ready"
                    }`}
                  >
                    {row.dependencyReadiness.blocked ? "Blocked" : "Ready"}
                  </span>
                </td>
                <td>
                  {row.dependencyReadiness.reasons.length === 0 ? (
                    <span className="coordinator-blocker-reason-none">-</span>
                  ) : (
                    <div className="coordinator-blocker-reasons">
                      {row.dependencyReadiness.reasons.map((reason) => (
                        <span key={reason} className="coordinator-blocker-reason-chip">
                          {toReasonLabel(reason)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
