import { FormEvent, useEffect, useRef, useState } from "react";

import {
  createIncidentCoordinationNote,
  fetchAssets,
  fetchAudit,
  fetchIncidentCoordination,
  fetchMetrics,
  ingestAsset,
  replayJob,
  updateIncidentGuidedActions,
  updateIncidentHandoff,
  type AssetRow,
  type AuditRow,
  type IncidentCoordination,
  type IncidentGuidedActions,
  type IncidentHandoff,
  type IncidentHandoffState
} from "./api";
import { CoordinatorBoard } from "./boards/CoordinatorBoard";
import { OperatorBoard } from "./boards/OperatorBoard";
import { SupervisorBoard } from "./boards/SupervisorBoard";
import { deriveHealthState } from "./operator/health";
import type { MetricsSnapshot } from "./operator/types";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const HEALTH_STALE_THRESHOLD_MS = 60_000;
const HEALTH_COOLDOWN_MS = 60_000;
const FALLBACK_SIGNAL_RECENCY_MS = 5 * 60_000;
const ROLE_QUERY_PARAM = "role";

type AppRole = "operator" | "coordinator" | "supervisor";
const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "operator", label: "Operator" },
  { value: "coordinator", label: "Coordinator" },
  { value: "supervisor", label: "Supervisor" }
];

function isAppRole(value: string | null): value is AppRole {
  return value === "operator" || value === "coordinator" || value === "supervisor";
}

function roleFromSearch(search: string): AppRole {
  const role = new URLSearchParams(search).get(ROLE_QUERY_PARAM);
  return isAppRole(role) ? role : "operator";
}

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
  const [selectedRole, setSelectedRole] = useState<AppRole>(() => roleFromSearch(window.location.search));
  const handoffDraftDirtyRef = useRef(false);
  const guidedUpdateRequestIdRef = useRef(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    query.set(ROLE_QUERY_PARAM, selectedRole);

    const search = query.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [selectedRole]);

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
        if (!handoffDraftDirtyRef.current) {
          setHandoffDraft(coordinationState.handoff);
        }
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
    const requestId = guidedUpdateRequestIdRef.current + 1;
    guidedUpdateRequestIdRef.current = requestId;

    try {
      const guidedActions = await updateIncidentGuidedActions({
        acknowledged: nextActions.acknowledged,
        owner: nextActions.owner,
        escalated: nextActions.escalated,
        nextUpdateEta: nextActions.nextUpdateEta,
        expectedUpdatedAt: coordination.guidedActions.updatedAt
      });

      if (requestId !== guidedUpdateRequestIdRef.current) {
        return;
      }

      setCoordination((previous) => ({
        ...previous,
        guidedActions
      }));
    } catch (error) {
      if (isCoordinationConflictError(error)) {
        if (requestId !== guidedUpdateRequestIdRef.current) {
          return;
        }

        await refresh();
        return;
      }

      throw error;
    }
  }

  async function resetGuidedActions(): Promise<void> {
    const requestId = guidedUpdateRequestIdRef.current + 1;
    guidedUpdateRequestIdRef.current = requestId;

    try {
      const guidedActions = await updateIncidentGuidedActions({
        acknowledged: false,
        owner: "",
        escalated: false,
        nextUpdateEta: null,
        expectedUpdatedAt: coordination.guidedActions.updatedAt
      });

      if (requestId !== guidedUpdateRequestIdRef.current) {
        return;
      }

      setCoordination((previous) => ({
        ...previous,
        guidedActions
      }));
    } catch (error) {
      if (isCoordinationConflictError(error)) {
        if (requestId !== guidedUpdateRequestIdRef.current) {
          return;
        }

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
      handoffDraftDirtyRef.current = false;
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

  return (
    <div className="appshell">
      <header className="appshell__topbar">
        <span className="appshell__brand">AssetHarbor</span>
        <span
          className={`appshell__health appshell__health--${health.state}`}
          aria-label={`Health: ${health.state}`}
        >
          &#9679;
        </span>
      </header>

      <aside className="appshell__sidebar">
        <fieldset className="role-selector" role="radiogroup" aria-label="Role view">
          <legend className="visually-hidden">Role view</legend>
          <div className="role-selector-options">
            {roleOptions.map((roleOption) => (
              <label
                key={roleOption.value}
                className={`appshell__nav-item${selectedRole === roleOption.value ? " appshell__nav-item--active" : ""}`}
                aria-current={selectedRole === roleOption.value ? "page" : undefined}
              >
                <input
                  type="radio"
                  name="role-view"
                  value={roleOption.value}
                  checked={selectedRole === roleOption.value}
                  onChange={() => setSelectedRole(roleOption.value)}
                  className="visually-hidden"
                />
                {roleOption.label}
              </label>
            ))}
          </div>
        </fieldset>
      </aside>

      <main className="appshell__main">
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
                  onChange={(event) => {
                    handoffDraftDirtyRef.current = true;
                    setHandoffDraft((previous) => ({
                      ...previous,
                      state: event.target.value as IncidentHandoffState
                    }));
                  }}
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
                  onChange={(event) => {
                    handoffDraftDirtyRef.current = true;
                    setHandoffDraft((previous) => ({
                      ...previous,
                      fromOwner: event.target.value
                    }));
                  }}
                />
              </label>
              <label>
                Handoff to owner
                <input
                  type="text"
                  value={handoffDraft.toOwner}
                  onChange={(event) => {
                    handoffDraftDirtyRef.current = true;
                    setHandoffDraft((previous) => ({
                      ...previous,
                      toOwner: event.target.value
                    }));
                  }}
                />
              </label>
              <label>
                Handoff summary
                <input
                  type="text"
                  value={handoffDraft.summary}
                  onChange={(event) => {
                    handoffDraftDirtyRef.current = true;
                    setHandoffDraft((previous) => ({
                      ...previous,
                      summary: event.target.value
                    }));
                  }}
                />
              </label>
              <button type="submit">Save handoff</button>
            </form>
          </div>
        </div>
      </section>

      {selectedRole === "operator" ? (
        <OperatorBoard
          title={title}
          sourceUri={sourceUri}
          assets={assets}
          onTitleChange={setTitle}
          onSourceUriChange={setSourceUri}
          onSubmit={onSubmit}
          onReplay={(jobId) => {
            void onReplay(jobId);
          }}
        />
      ) : null}

      {selectedRole === "coordinator" ? (
        <CoordinatorBoard
          assets={assets}
          onReplayJob={async (jobId) => {
            await onReplay(jobId);
          }}
        />
      ) : null}

      {selectedRole === "supervisor" ? (
        <SupervisorBoard
          assets={assets}
          onReplayJob={async (jobId) => {
            await onReplay(jobId);
          }}
        />
      ) : null}

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
    </div>
  );
}
