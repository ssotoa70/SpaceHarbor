import { useCallback, useEffect, useState } from "react";

import { fetchAssets, fetchAudit, replayJob, type AssetRow, type AuditRow } from "./api";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { AssetQueue } from "./components/AssetQueue";
import { IngestModal } from "./components/IngestModal";

export function App() {
  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [assetList, auditList] = await Promise.all([fetchAssets(), fetchAudit()]);
      setAllAssets(assetList);
      setAuditRows(auditList);
    } catch {
      setAllAssets([]);
      setAuditRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function triggerRefresh() {
    setRefreshKey((k) => k + 1);
    void refresh();
  }

  async function onReplay(jobId: string) {
    await replayJob(jobId);
    triggerRefresh();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="topbar-title">AssetHarbor</h1>
        <p className="topbar-subtitle">Media Asset Management</p>
        <button
          type="button"
          className="btn btn--primary topbar-ingest"
          onClick={() => setIngestOpen(true)}
        >
          + Ingest Asset
        </button>
      </header>

      <nav className="sidebar" aria-label="Main navigation">
        <ul>
          <li className="sidebar-item sidebar-item--active">Approval Queue</li>
          <li className="sidebar-item">All Assets</li>
          <li className="sidebar-item">Audit Log</li>
        </ul>
      </nav>

      <main className="main-content">
        <AssetQueue
          onSelectAsset={setSelectedAsset}
          selectedAssetId={selectedAsset?.id}
          refreshKey={refreshKey}
        />

        <section className="panel" aria-labelledby="all-assets-heading">
          <h2 id="all-assets-heading">All Assets</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allAssets.length === 0 ? (
                <tr>
                  <td colSpan={4}>No assets yet.</td>
                </tr>
              ) : (
                allAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.title}</td>
                    <td>{asset.sourceUri}</td>
                    <td>
                      <span className={`status status-${asset.status}`}>{asset.status}</span>
                    </td>
                    <td>
                      {asset.status === "failed" && asset.jobId ? (
                        <button type="button" onClick={() => void onReplay(asset.jobId!)}>
                          Replay
                        </button>
                      ) : (
                        <span>-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-labelledby="audit-heading">
          <h2 id="audit-heading">Recent Audit</h2>
          <ul>
            {auditRows.length === 0 ? (
              <li>No audit events yet.</li>
            ) : (
              auditRows.map((row) => (
                <li key={row.id}>
                  <strong>{row.message}</strong> <span>{row.at}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>

      <aside className="detail-panel">
        <ApprovalPanel asset={selectedAsset} onActionComplete={triggerRefresh} />
      </aside>

      <IngestModal
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onSuccess={triggerRefresh}
      />
    </div>
  );
}
