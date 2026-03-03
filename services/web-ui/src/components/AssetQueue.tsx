import { useCallback, useEffect, useState } from "react";

import { fetchApprovalQueue } from "../api";
import type { AssetRow, SortDirection, SortField } from "../types";

interface AssetQueueProps {
  onSelectAsset: (asset: AssetRow) => void;
  selectedAssetId?: string;
  refreshKey?: number;
}

export function AssetQueue({ onSelectAsset, selectedAssetId, refreshKey }: AssetQueueProps) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(false);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchApprovalQueue(sortField, sortDir, page, pageSize);
      setAssets(result.assets);
      setTotal(result.total);
    } catch {
      setAssets([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [sortField, sortDir, page, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="panel asset-queue" aria-labelledby="queue-heading">
      <h2 id="queue-heading">Approval Queue</h2>

      {loading && <p className="loading-text" aria-live="polite">Loading...</p>}

      <table>
        <thead>
          <tr>
            <th scope="col">
              <button
                type="button"
                className="sort-btn"
                onClick={() => toggleSort("name")}
                aria-label={`Sort by name${sortIndicator("name")}`}
              >
                Name{sortIndicator("name")}
              </button>
            </th>
            <th scope="col">Resolution</th>
            <th scope="col">Duration</th>
            <th scope="col">Status</th>
            <th scope="col">
              <button
                type="button"
                className="sort-btn"
                onClick={() => toggleSort("created_at")}
                aria-label={`Sort by created${sortIndicator("created_at")}`}
              >
                Created{sortIndicator("created_at")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.length === 0 && !loading ? (
            <tr>
              <td colSpan={5}>No assets in approval queue.</td>
            </tr>
          ) : (
            assets.map((asset) => {
              const resolution = asset.metadata?.resolution
                ? `${asset.metadata.resolution.width}x${asset.metadata.resolution.height}`
                : "-";
              const duration = asset.metadata?.frame_range
                ? `${asset.metadata.frame_range.start}-${asset.metadata.frame_range.end}`
                : "-";
              const created = asset.createdAt
                ? new Date(asset.createdAt).toLocaleDateString()
                : "-";

              return (
                <tr
                  key={asset.id}
                  className={`queue-row${selectedAssetId === asset.id ? " queue-row--selected" : ""}`}
                  onClick={() => onSelectAsset(asset)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectAsset(asset);
                    }
                  }}
                  aria-selected={selectedAssetId === asset.id}
                >
                  <td>{asset.title}</td>
                  <td>{resolution}</td>
                  <td>{duration}</td>
                  <td>
                    <span className={`status status-${asset.status}`}>{asset.status}</span>
                  </td>
                  <td>{created}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <nav className="pagination" aria-label="Queue pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
