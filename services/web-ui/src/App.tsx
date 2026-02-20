import { FormEvent, useEffect, useState } from "react";

import {
  fetchAssets,
  fetchAudit,
  fetchMetrics,
  ingestAsset,
  replayJob,
  submitWorkflowEvent,
  type AssetRow,
  type AuditRow
} from "./api";
import {
  clearGuidedActions as clearGuidedActionsStorage,
  DEFAULT_GUIDED_ACTIONS,
  loadGuidedActions,
  saveGuidedActions,
  type GuidedActions
} from "./operator/actions";
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
  const [guidedActions, setGuidedActions] = useState<GuidedActions>(() => loadGuidedActions());

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
  const fallbackEventsNow = currentMetrics?.degradedMode.fallbackEvents ?? 0;
  const previousFallbackEvents = previousMetrics?.degradedMode.fallbackEvents ?? 0;
  const fallbackDelta = fallbackEventsNow - previousFallbackEvents;

  let fallbackTrend: "rising" | "stable" | "falling" = "stable";
  if (fallbackDelta > 0) {
    fallbackTrend = "rising";
  } else if (fallbackDelta < 0) {
    fallbackTrend = "falling";
  }

  function updateGuidedActions(update: Partial<Omit<GuidedActions, "updatedAt">>): void {
    const nextActions: GuidedActions = {
      ...guidedActions,
      ...update,
      updatedAt: new Date().toISOString()
    };

    setGuidedActions(nextActions);
    saveGuidedActions(nextActions);
  }

  function resetGuidedActions(): void {
    setGuidedActions(DEFAULT_GUIDED_ACTIONS);
    clearGuidedActionsStorage();
  }

  const guidedUpdatedText =
    guidedActions.updatedAt === null
      ? "Updated: not set"
      : `Updated: ${new Date(guidedActions.updatedAt).toLocaleString()}`;

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

  async function onGateTransition(asset: AssetRow, eventType: Parameters<typeof submitWorkflowEvent>[0]["eventType"]): Promise<void> {
    if (!asset.jobId) {
      return;
    }

    await submitWorkflowEvent({
      assetId: asset.id,
      jobId: asset.jobId,
      eventType,
      producer: "web-ui"
    });
    await refresh();
  }

  function onOpenAnnotationContext(_asset: AssetRow): void {
    // Slice 2 provides metadata hook visibility only.
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
          <p className="health-state-label" role="status" aria-live="polite" aria-atomic="true" aria-label="Health state updates">
            Health state: {health.state}
          </p>
          <p className="health-updated">{lastUpdatedText}</p>
          {isStale ? <p className="health-stale">Stale data</p> : null}
        </div>

        <div className="impact-panel">
          <h3>Fallback events</h3>
          <p className="impact-count">{fallbackEventsNow}</p>
          <p className={`impact-trend trend-${fallbackTrend}`}>Trend: {fallbackTrend}</p>
          <dl className="impact-counters">
            <div>
              <dt>Pending</dt>
              <dd>{currentMetrics?.jobs.pending ?? 0}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{currentMetrics?.jobs.processing ?? 0}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{currentMetrics?.jobs.failed ?? 0}</dd>
            </div>
            <div>
              <dt>DLQ</dt>
              <dd>{currentMetrics?.dlq.total ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="guided-panel">
          <h3>Guided actions</h3>
          <p className="guided-local">Local only: saved in this browser and not shared with backend services.</p>
          <label className="guided-control">
            <input
              type="checkbox"
              checked={guidedActions.acknowledged}
              onChange={(event) => updateGuidedActions({ acknowledged: event.target.checked })}
            />
            Acknowledge incident
          </label>
          <label className="guided-control">
            Incident owner
            <input
              type="text"
              value={guidedActions.owner}
              onChange={(event) => updateGuidedActions({ owner: event.target.value })}
            />
          </label>
          <label className="guided-control">
            <input
              type="checkbox"
              checked={guidedActions.escalated}
              onChange={(event) => updateGuidedActions({ escalated: event.target.checked })}
            />
            Escalate response
          </label>
          <p className="guided-updated">{guidedUpdatedText}</p>
          <button type="button" onClick={resetGuidedActions}>
            Clear guided actions
          </button>
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
                      <p>{asset.thumbnail || asset.proxy ? "Preview metadata available" : "Preview not available"}</p>
                    </td>
                    <td>
                    {asset.annotationHook.enabled ? (
                      <button type="button" onClick={() => onOpenAnnotationContext(asset)}>
                        Open annotation context
                      </button>
                    ) : null}
                    {asset.status === "failed" && asset.jobId ? (
                      <button type="button" onClick={() => void onReplay(asset.jobId)}>
                        Replay
                      </button>
                    ) : null}
                    {asset.status === "completed" && asset.jobId ? (
                      <button type="button" onClick={() => void onGateTransition(asset, "asset.review.qc_pending")}>
                        Send to QC
                      </button>
                    ) : null}
                    {asset.status === "qc_pending" && asset.jobId ? (
                      <button type="button" onClick={() => void onGateTransition(asset, "asset.review.in_review")}>
                        Start review
                      </button>
                    ) : null}
                    {asset.status === "qc_in_review" && asset.jobId ? (
                      <>
                        <button type="button" onClick={() => void onGateTransition(asset, "asset.review.approved")}>
                          Approve
                        </button>
                        <button type="button" onClick={() => void onGateTransition(asset, "asset.review.rejected")}>
                          Reject
                        </button>
                      </>
                    ) : null}
                    {asset.status === "qc_rejected" && asset.jobId ? (
                      <button type="button" onClick={() => void onGateTransition(asset, "asset.processing.replay_requested")}>
                        Mark needs replay
                      </button>
                    ) : null}
                    {!asset.annotationHook.enabled && (!asset.jobId || (asset.status !== "failed" && asset.status !== "completed" && asset.status !== "qc_pending" && asset.status !== "qc_in_review" && asset.status !== "qc_rejected")) ? (
                      <span>-</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-labelledby="audit-heading">
        <h2 id="audit-heading">Recent Audit</h2>
        <ul className="timeline-list">
          {auditRows.length === 0 ? (
            <li className="timeline-item">No audit events yet.</li>
          ) : (
            auditRows.map((row) => {
              const isFallbackCorrelated = row.message.toLowerCase().includes("vast fallback");

              return (
                <li key={row.id} className={`timeline-item${isFallbackCorrelated ? " timeline-fallback" : ""}`}>
                  <div className="timeline-message-row">
                    <strong>{row.message}</strong>
                    {isFallbackCorrelated ? <span className="timeline-label">Fallback correlated</span> : null}
                  </div>
                  <span>{row.at}</span>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </main>
  );
}
