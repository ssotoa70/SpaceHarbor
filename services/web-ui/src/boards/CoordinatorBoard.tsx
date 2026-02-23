import { useMemo, useState } from "react";

import type { AssetRow } from "../api";
import {
  applyQueueFilters,
  sortQueueRows,
  toQueueViewRow,
  toSortedUniqueValues
} from "../queue/view-model";

interface CoordinatorBoardProps {
  assets: AssetRow[];
  nowMs?: number;
}

type SelectValue = "all" | string;

export function CoordinatorBoard({ assets, nowMs }: CoordinatorBoardProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SelectValue>("all");
  const [priorityFilter, setPriorityFilter] = useState<SelectValue>("all");
  const [ownerFilter, setOwnerFilter] = useState<SelectValue>("all");
  const [vendorFilter, setVendorFilter] = useState<SelectValue>("all");

  const resolvedNowMs = nowMs ?? Date.now();

  const rows = useMemo(() => assets.map((asset) => toQueueViewRow(asset, resolvedNowMs)), [assets, resolvedNowMs]);

  const filteredRows = useMemo(() => {
    const filtered = applyQueueFilters(rows, {
      query: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : (priorityFilter as AssetRow["productionMetadata"]["priority"]),
      owner: ownerFilter === "all" ? undefined : ownerFilter,
      vendor: vendorFilter === "all" ? undefined : vendorFilter
    });

    return sortQueueRows(filtered);
  }, [ownerFilter, priorityFilter, query, rows, statusFilter, vendorFilter]);

  const statusOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.status)), [rows]);
  const ownerOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.productionMetadata.owner)), [rows]);
  const vendorOptions = useMemo(() => toSortedUniqueValues(rows.map((row) => row.productionMetadata.vendor)), [rows]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    ownerFilter !== "all" ||
    vendorFilter !== "all";

  function resetFilters(): void {
    setQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setOwnerFilter("all");
    setVendorFilter("all");
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
        </div>
      ) : null}

      <table>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Owner</th>
            <th scope="col">Vendor</th>
            <th scope="col">Age (min)</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td className="coordinator-empty-state" colSpan={6} aria-live="polite">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>
                  <span className={`status status-${row.status}`}>{row.status}</span>
                </td>
                <td>{row.productionMetadata.priority ?? "-"}</td>
                <td>{row.productionMetadata.owner ?? "-"}</td>
                <td>{row.productionMetadata.vendor ?? "-"}</td>
                <td>{row.ageMinutes}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
