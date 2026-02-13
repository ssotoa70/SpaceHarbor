import { FormEvent, useEffect, useState } from "react";

import { fetchAssets, fetchAudit, ingestAsset, type AssetRow, type AuditRow } from "./api";

export function App() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [title, setTitle] = useState("");
  const [sourceUri, setSourceUri] = useState("");

  async function refresh(): Promise<void> {
    try {
      const [assetList, auditList] = await Promise.all([fetchAssets(), fetchAudit()]);
      setAssets(assetList);
      setAuditRows(auditList);
    } catch {
      setAssets([]);
      setAuditRows([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !sourceUri.trim()) {
      return;
    }

    await ingestAsset({ title, sourceUri });
    setTitle("");
    setSourceUri("");
    await refresh();
  }

  return (
    <main className="layout">
      <header className="hero">
        <h1>AssetHarbor</h1>
        <p>Queue-first media operations for ingest, workflow, and audit visibility.</p>
      </header>

      <section className="panel" aria-labelledby="ingest-heading">
        <h2 id="ingest-heading">Ingest</h2>
        <form onSubmit={onSubmit} className="ingest-form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} name="title" />
          </label>
          <label>
            Source URI
            <input value={sourceUri} onChange={(e) => setSourceUri(e.target.value)} name="sourceUri" />
          </label>
          <button type="submit">Register Asset</button>
        </form>
      </section>

      <section className="panel" aria-labelledby="queue-heading">
        <h2 id="queue-heading">Assets Queue</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td colSpan={3}>No assets yet.</td>
              </tr>
            ) : (
              assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.title}</td>
                  <td>{asset.sourceUri}</td>
                  <td>
                    <span className={`status status-${asset.status}`}>{asset.status}</span>
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
  );
}
