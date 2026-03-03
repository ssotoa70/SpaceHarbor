import { FormEvent, useEffect, useState } from "react";

import {
  createIncidentCoordinationNote,
  fetchAssets,
  fetchAudit,
  fetchIncidentCoordination,
  fetchMetrics,
  ingestAsset,
  replayJob,
  submitWorkflowEvent,
  updateIncidentGuidedActions,
  updateIncidentHandoff,
  type AssetRow,
  type AuditRow,
  type IncidentCoordination,
  type IncidentGuidedActions,
  type IncidentHandoff,
  type IncidentHandoffState
} from "./api";
import { deriveHealthState } from "./operator/health";
import type { MetricsSnapshot } from "./operator/types";

interface HandoffDraft {
  owner: string;
  releaseNotesReady: boolean;
  verificationComplete: boolean;
  commsDraftReady: boolean;
}

function createHandoffDraft(asset: AssetRow): HandoffDraft {
  return {
    owner: asset.handoff.owner ?? "",
    releaseNotesReady: asset.handoffChecklist.releaseNotesReady,
    verificationComplete: asset.handoffChecklist.verificationComplete,
    commsDraftReady: asset.handoffChecklist.commsDraftReady
  };
}

function isHandoffReady(draft: HandoffDraft): boolean {
  return (
    draft.owner.trim().length > 0 &&
    draft.releaseNotesReady &&
    draft.verificationComplete &&
    draft.commsDraftReady
  );
}

const HEALTH_POLL_INTERVAL_MS = 15_000;
const HEALTH_STALE_THRESHOLD_MS = 60_000;
const HEALTH_COOLDOWN_MS = 60_000;
const FALLBACK_SIGNAL_RECENCY_MS = 5 * 60_000;

function isCoordinationConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(": 409");
}

const DEFAULT_INCIDENT_COORDINATION: IncidentCoordination = {
  guidedActions: {
    acknowledged: false,
    owner: "",
    escalated: false,
    nextUpdateEta: null,
    updatedAt: null
  },
  handoff: {
    state: "none",
    fromOwner: "",
    toOwner: "",
    summary: "",
    updatedAt: null
  },
  notes: []
};

export function App() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([]);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<number | null>(null);
  const [lastDegradedAt, setLastDegradedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [title, setTitle] = useState("");
  const [sourceUri, setSourceUri] = useState("");
  const [coordination, setCoordination] = useState<IncidentCoordination>(DEFAULT_INCIDENT_COORDINATION);
  const [noteMessage, setNoteMessage] = useState("");
  const [noteCorrelationId, setNoteCorrelationId] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("");
  const [handoffDraft, setHandoffDraft] = useState<IncidentHandoff>(DEFAULT_INCIDENT_COORDINATION.handoff);
  const [handoffDrafts, setHandoffDrafts] = useState<Record<string, HandoffDraft>>({});
  const [releaseReadyAssetIds, setReleaseReadyAssetIds] = useState<Record<string, boolean>>({});

  async function refresh(): Promise<void> {
    try {
      const [assetList, auditList, metricsSnapshot, coordinationState] = await Promise.all([
        fetchAssets(),
        fetchAudit(),
        fetchMetrics(),
        fetchIncidentCoordination()
      ]);
      setAssets(assetList);
      setAuditRows(auditList);
      if (metricsSnapshot) {
        setMetricsHistory((previous) => [...previous.slice(-1), metricsSnapshot]);
      }

      if (coordinationState) {
        setCoordination(coordinationState);
        setHandoffDraft(coordinationState.handoff);
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

  useEffect(() => {
    setHandoffDrafts((previous) => {
      const next = { ...previous };
      for (const asset of assets) {
        if (!next[asset.id]) {
          next[asset.id] = createHandoffDraft(asset);
        }
      }
      return next;
    });
  }, [assets]);

  const currentMetrics = metricsHistory[metricsHistory.length - 1] ?? null;
  const previousMetrics = metricsHistory[metricsHistory.length - 2] ?? null;
  const healthEvaluationNow = lastSuccessfulRefreshAt ?? now;
  const recentFallbackSignal = auditRows.some((row) => {
    if (row.signal?.code !== "VAST_FALLBACK") {
      return false;
    }

    return healthEvaluationNow - new Date(row.at).getTime() < FALLBACK_SIGNAL_RECENCY_MS;
  });

  const health = deriveHealthState({
    current: currentMetrics,
    previous: previousMetrics,
    recentFallbackSignal,
    now: healthEvaluationNow,
    lastDegradedAt,
    cooldownMs: HEALTH_COOLDOWN_MS
  });

  useEffect(() => {
    if (health.state === "degraded") {
      setLastDegradedAt(healthEvaluationNow);
    }
  }, [health.state, healthEvaluationNow]);

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

  async function updateGuidedActions(update: Partial<Omit<IncidentGuidedActions, "updatedAt">>): Promise<void> {
    const nextActions = {
      ...coordination.guidedActions,
      ...update
    };

    try {
      const guidedActions = await updateIncidentGuidedActions({
        acknowledged: nextActions.acknowledged,
        owner: nextActions.owner,
        escalated: nextActions.escalated,
        nextUpdateEta: nextActions.nextUpdateEta,
        expectedUpdatedAt: coordination.guidedActions.updatedAt
      });

      setCoordination((previous) => ({
        ...previous,
        guidedActions
      }));
    } catch (error) {
      if (isCoordinationConflictError(error)) {
        await refresh();
        return;
      }

      throw error;
    }
  }

  async function resetGuidedActions(): Promise<void> {
    try {
      const guidedActions = await updateIncidentGuidedActions({
        acknowledged: false,
        owner: "",
        escalated: false,
        nextUpdateEta: null,
        expectedUpdatedAt: coordination.guidedActions.updatedAt
      });

      setCoordination((previous) => ({
        ...previous,
        guidedActions
      }));
    } catch (error) {
      if (isCoordinationConflictError(error)) {
        await refresh();
        return;
      }

      throw error;
    }
  }

  const guidedUpdatedText =
    coordination.guidedActions.updatedAt === null
      ? "Updated: not set"
      : `Updated: ${new Date(coordination.guidedActions.updatedAt).toLocaleString()}`;

  async function onCreateNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const message = noteMessage.trim();
    const correlationId = noteCorrelationId.trim();
    const author = noteAuthor.trim();
    if (!message || !correlationId || !author) {
      return;
    }

    const note = await createIncidentCoordinationNote({
      message,
      correlationId,
      author
    });

    setCoordination((previous) => ({
      ...previous,
      notes: [note, ...previous.notes]
    }));
    setNoteMessage("");
    setNoteCorrelationId("");
    setNoteAuthor("");
  }

  async function onSaveHandoff(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    try {
      const handoff = await updateIncidentHandoff({
        state: handoffDraft.state,
        fromOwner: handoffDraft.fromOwner,
        toOwner: handoffDraft.toOwner,
        summary: handoffDraft.summary,
        expectedUpdatedAt: coordination.handoff.updatedAt
      });

      setCoordination((previous) => ({
        ...previous,
        handoff
      }));
      setHandoffDraft(handoff);
    } catch (error) {
      if (isCoordinationConflictError(error)) {
        await refresh();
        return;
      }

      throw error;
    }
  }

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

  function updateHandoffDraft(assetId: string, patch: Partial<HandoffDraft>): void {
    setHandoffDrafts((previous) => {
      const current = previous[assetId] ?? {
        owner: "",
        releaseNotesReady: false,
        verificationComplete: false,
        commsDraftReady: false
      };
      return {
        ...previous,
        [assetId]: {
          ...current,
          ...patch
        }
      };
    });
  }

  function markReleaseReady(assetId: string): void {
    setReleaseReadyAssetIds((previous) => ({
      ...previous,
      [assetId]: true
    }));
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
          <p className="guided-shared">Shared coordination state for all operators and services.</p>
          <label className="guided-control">
            <input
              type="checkbox"
              checked={coordination.guidedActions.acknowledged}
              onChange={(event) => {
                void updateGuidedActions({ acknowledged: event.target.checked });
              }}
            />
            Acknowledge incident
          </label>
          <label className="guided-control">
            Incident owner
            <input
              type="text"
              value={coordination.guidedActions.owner}
              onChange={(event) => {
                void updateGuidedActions({ owner: event.target.value });
              }}
            />
          </label>
          <label className="guided-control">
            <input
              type="checkbox"
              checked={coordination.guidedActions.escalated}
              onChange={(event) => {
                void updateGuidedActions({ escalated: event.target.checked });
              }}
            />
            Escalate response
          </label>
          <p className="guided-updated">{guidedUpdatedText}</p>
          <button
            type="button"
            onClick={() => {
              void resetGuidedActions();
            }}
          >
            Clear guided actions
          </button>

          <div className="coordination-block" aria-labelledby="notes-heading">
            <h4 id="notes-heading">Incident notes</h4>
            <form className="coordination-form" onSubmit={onCreateNote}>
              <label>
                Note message
                <input type="text" value={noteMessage} onChange={(event) => setNoteMessage(event.target.value)} />
              </label>
              <label>
                Correlation ID
                <input
                  type="text"
                  value={noteCorrelationId}
                  onChange={(event) => setNoteCorrelationId(event.target.value)}
                />
              </label>
              <label>
                Note author
                <input type="text" value={noteAuthor} onChange={(event) => setNoteAuthor(event.target.value)} />
              </label>
              <button type="submit">Add note</button>
            </form>
            <ul className="coordination-list">
              {coordination.notes.length === 0 ? (
                <li>No notes yet.</li>
              ) : (
                coordination.notes.map((note) => (
                  <li key={note.id}>
                    <strong>{note.message}</strong>
                    <span>
                      {note.author} - {note.correlationId}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="coordination-block" aria-labelledby="handoff-heading">
            <h4 id="handoff-heading">Operator handoff</h4>
            <form className="coordination-form" onSubmit={onSaveHandoff}>
              <label>
                Handoff state
                <select
                  value={handoffDraft.state}
                  onChange={(event) =>
                    setHandoffDraft((previous) => ({
                      ...previous,
                      state: event.target.value as IncidentHandoffState
                    }))
                  }
                >
                  <option value="none">none</option>
                  <option value="handoff_requested">handoff_requested</option>
                  <option value="handoff_accepted">handoff_accepted</option>
                </select>
              </label>
              <label>
                Handoff from owner
                <input
                  type="text"
                  value={handoffDraft.fromOwner}
                  onChange={(event) =>
                    setHandoffDraft((previous) => ({
                      ...previous,
                      fromOwner: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Handoff to owner
                <input
                  type="text"
                  value={handoffDraft.toOwner}
                  onChange={(event) =>
                    setHandoffDraft((previous) => ({
                      ...previous,
                      toOwner: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Handoff summary
                <input
                  type="text"
                  value={handoffDraft.summary}
                  onChange={(event) =>
                    setHandoffDraft((previous) => ({
                      ...previous,
                      summary: event.target.value
                    }))
                  }
                />
              </label>
              <button type="submit">Save handoff</button>
            </form>
          </div>
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
                    {asset.status === "qc_approved" ? (
                      <div>
                        <p>Coordinator handoff checklist</p>
                        <label>
                          <input
                            type="checkbox"
                            checked={(handoffDrafts[asset.id] ?? createHandoffDraft(asset)).releaseNotesReady}
                            onChange={(event) =>
                              updateHandoffDraft(asset.id, { releaseNotesReady: event.target.checked })
                            }
                          />
                          Release notes ready
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={(handoffDrafts[asset.id] ?? createHandoffDraft(asset)).verificationComplete}
                            onChange={(event) =>
                              updateHandoffDraft(asset.id, { verificationComplete: event.target.checked })
                            }
                          />
                          Verification complete
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={(handoffDrafts[asset.id] ?? createHandoffDraft(asset)).commsDraftReady}
                            onChange={(event) =>
                              updateHandoffDraft(asset.id, { commsDraftReady: event.target.checked })
                            }
                          />
                          Comms draft ready
                        </label>
                        <label>
                          Handoff owner
                          <input
                            type="text"
                            value={(handoffDrafts[asset.id] ?? createHandoffDraft(asset)).owner}
                            onChange={(event) => updateHandoffDraft(asset.id, { owner: event.target.value })}
                          />
                        </label>
                        {isHandoffReady(handoffDrafts[asset.id] ?? createHandoffDraft(asset)) ? (
                          <p>Handoff ready for release.</p>
                        ) : (
                          <p>Blocked: complete checklist and assign handoff owner.</p>
                        )}
                        <button
                          type="button"
                          disabled={!isHandoffReady(handoffDrafts[asset.id] ?? createHandoffDraft(asset))}
                          onClick={() => markReleaseReady(asset.id)}
                        >
                          Mark release-ready
                        </button>
                        {releaseReadyAssetIds[asset.id] ? <p>Release-ready marked.</p> : null}
                      </div>
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
                    {!asset.annotationHook.enabled &&
                    asset.status !== "qc_approved" &&
                    (!asset.jobId ||
                      (asset.status !== "failed" &&
                        asset.status !== "completed" &&
                        asset.status !== "qc_pending" &&
                        asset.status !== "qc_in_review" &&
                        asset.status !== "qc_rejected")) ? (
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
              const isFallbackCorrelated = row.signal?.code === "VAST_FALLBACK";

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
