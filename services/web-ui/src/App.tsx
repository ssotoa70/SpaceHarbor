import { FormEvent, useEffect, useState } from "react";

import { fetchAssets, fetchAudit, fetchMetrics, ingestAsset, replayJob, type AssetRow, type AuditRow } from "./api";
import { deriveHealthState } from "./operator/health";
import type { MetricsSnapshot } from "./operator/types";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const HEALTH_STALE_THRESHOLD_MS = 60_000;
const HEALTH_COOLDOWN_MS = 60_000;

export function App() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([]);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<number | null>(null);
  const [lastDegradedAt, setLastDegradedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [title, setTitle] = useState("");
  const [sourceUri, setSourceUri] = useState("");

  async function refresh(): Promise<void> {
    try {
      const [assetList, auditList, metricsSnapshot] = await Promise.all([fetchAssets(), fetchAudit(), fetchMetrics()]);
      setAssets(assetList);
      setAuditRows(auditList);
      if (metricsSnapshot) {
        setMetricsHistory((previous) => [...previous.slice(-1), metricsSnapshot]);
      }

      const refreshedAt = Date.now();
      setLastSuccessfulRefreshAt(refreshedAt);
      setNow(refreshedAt);
    } catch {
      setNow(Date.now());
    }
  }

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, HEALTH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const currentMetrics = metricsHistory[metricsHistory.length - 1] ?? null;
  const previousMetrics = metricsHistory[metricsHistory.length - 2] ?? null;
  const recentFallbackAudit = auditRows.some((row) => row.message.toLowerCase().includes("vast fallback"));

  const health = deriveHealthState({
    current: currentMetrics,
    previous: previousMetrics,
    recentFallbackAudit,
    now,
    lastDegradedAt,
    cooldownMs: HEALTH_COOLDOWN_MS
  });

  useEffect(() => {
    if (health.state === "degraded") {
      setLastDegradedAt(now);
    }
  }, [health.state, now]);

  const isStale = lastSuccessfulRefreshAt !== null && now - lastSuccessfulRefreshAt >= HEALTH_STALE_THRESHOLD_MS;
  const lastUpdatedText =
    lastSuccessfulRefreshAt === null
      ? "Last updated: unavailable"
      : `Last updated: ${new Date(lastSuccessfulRefreshAt).toLocaleString()}`;

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

  async function onReplay(jobId: string): Promise<void> {
    await replayJob(jobId);
    await refresh();
  }

  return (
    <main className="layout">
      <header className="hero">
        <h1>AssetHarbor</h1>
        <p>Queue-first media operations for ingest, workflow, and audit visibility.</p>
      </header>

      <section className="panel" aria-labelledby="health-heading">
        <h2 id="health-heading">Operational Health</h2>
        <div className={`health-strip health-${health.state}`}>
          <p className="health-state-label">Status: {health.state}</p>
          <p className="health-updated">{lastUpdatedText}</p>
          {isStale ? <p className="health-stale">Stale data</p> : null}
        </div>
      </section>

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
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td colSpan={4}>No assets yet.</td>
              </tr>
            ) : (
              assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.title}</td>
                  <td>{asset.sourceUri}</td>
                  <td>
                    <span className={`status status-${asset.status}`}>{asset.status}</span>
                  </td>
                  <td>
                    {asset.status === "failed" && asset.jobId ? (
                      <button type="button" onClick={() => void onReplay(asset.jobId)}>
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
  );
}
