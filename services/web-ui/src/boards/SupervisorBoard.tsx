import { useMemo, useState } from "react";

import type { AssetRow } from "../api";
import {
  applyQueueFilters,
  buildSupervisorSummary,
  sortQueueRows,
  toAgingBucketLabel,
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
}

type SelectValue = "all" | string;

export function SupervisorBoard({ assets, nowMs }: SupervisorBoardProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SelectValue>("all");
  const [priorityFilter, setPriorityFilter] = useState<SelectValue>("all");

  const resolvedNowMs = nowMs ?? Date.now();

  const rows = useMemo(() => {
    const nextRows = assets.map((asset) => toQueueViewRow(asset, resolvedNowMs));
    return sortQueueRows(nextRows);
  }, [assets, resolvedNowMs]);

  const summary = useMemo(() => buildSupervisorSummary(rows), [rows]);
  const statusSummaryItems = useMemo(() => toSupervisorStatusSummaryItems(summary), [summary]);
  const agingSummaryItems = useMemo(() => toSupervisorAgingSummaryItems(summary), [summary]);
  const prioritySummaryItems = useMemo(() => toSupervisorPrioritySummaryItems(summary), [summary]);
  const statusOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.status)), [rows]);

  const filteredRows = useMemo(() => {
    const filtered = applyQueueFilters(rows, {
      query: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : (priorityFilter as AssetRow["productionMetadata"]["priority"])
    });

    return sortQueueRows(filtered);
  }, [priorityFilter, query, rows, statusFilter]);

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
      </div>

      <table className="supervisor-compact-table" aria-label="Supervisor compact queue">
        <thead>
          <tr>
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
              <td colSpan={5} aria-live="polite">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>
                  <span className={`status status-${row.status}`}>status: {toStatusLabel(row.status)}</span>
                </td>
                <td>
                  {row.productionMetadata.priority ? (
                    <span className="supervisor-priority-chip">priority: {row.productionMetadata.priority}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{row.productionMetadata.owner ?? "-"}</td>
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
