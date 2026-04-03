import { useState, useEffect, useCallback } from "react";
import { Button } from "../../design-system/Button";
import { Badge } from "../../design-system/Badge";
import type { BadgeVariant } from "../../design-system/Badge";
import { Skeleton } from "../../design-system/Skeleton";
import { fetchTraces, fetchTraceTree, fetchLogs } from "../../api/dataengine-proxy";
import type { TelemetryTrace, TraceSpan, TelemetryLog } from "../../types/dataengine";
import { TraceTreeViewer } from "./TraceTreeViewer";

const STATUS_BADGE: Record<string, BadgeVariant> = {
  ok: "success",
  error: "danger",
  unset: "default",
};

const LOG_LEVEL_BADGE: Record<string, BadgeVariant> = {
  TRACE: "default",
  DEBUG: "default",
  INFO: "info",
  WARN: "warning",
  ERROR: "danger",
  FATAL: "danger",
};

const TIME_RANGE_OPTIONS = [
  { label: "Last 1h", value: "1h" },
  { label: "Last 6h", value: "6h" },
  { label: "Last 24h", value: "24h" },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncateId(id: string, len = 12): string {
  return id.length > len ? id.slice(0, len) + "\u2026" : id;
}

type DetailSubTab = "spans" | "logs";

export function TelemetryTab() {
  // ── Traces list state ──
  const [traces, setTraces] = useState<TelemetryTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(true);
  const [tracesError, setTracesError] = useState<string | null>(null);

  // ── Filters ──
  const [filterPipeline, setFilterPipeline] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTimeRange, setFilterTimeRange] = useState("1h");

  // ── Selected trace detail ──
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detailSubTab, setDetailSubTab] = useState<DetailSubTab>("spans");

  // ── Trace spans ──
  const [traceSpans, setTraceSpans] = useState<TraceSpan[]>([]);
  const [spansLoading, setSpansLoading] = useState(false);
  const [spansError, setSpansError] = useState<string | null>(null);

  // ── Trace logs ──
  const [traceLogs, setTraceLogs] = useState<TelemetryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // ── Expanded log messages ──
  const [expandedLogIdx, setExpandedLogIdx] = useState<number | null>(null);

  // ── Load traces ──
  const loadTraces = useCallback(async () => {
    setTracesLoading(true);
    setTracesError(null);
    try {
      const query: Record<string, string> = {};
      if (filterPipeline) query.pipeline = filterPipeline;
      if (filterStatus !== "all") query.status = filterStatus;
      if (filterTimeRange) query.time_range = filterTimeRange;
      const result = await fetchTraces(query);
      setTraces(result);
    } catch (err) {
      setTraces([]);
      setTracesError(err instanceof Error ? err.message : "Failed to load traces");
    } finally {
      setTracesLoading(false);
    }
  }, [filterPipeline, filterStatus, filterTimeRange]);

  useEffect(() => {
    void loadTraces();
  }, [loadTraces]);

  // ── Load spans when selecting trace ──
  const loadTraceSpans = useCallback(async (traceId: string) => {
    setSpansLoading(true);
    setSpansError(null);
    try {
      const result = await fetchTraceTree(traceId);
      setTraceSpans(result);
    } catch (err) {
      setTraceSpans([]);
      setSpansError(err instanceof Error ? err.message : "Failed to load spans");
    } finally {
      setSpansLoading(false);
    }
  }, []);

  // ── Load logs for selected trace ──
  const loadTraceLogs = useCallback(async (traceId: string) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await fetchLogs({ trace_id: traceId });
      setTraceLogs(result);
    } catch (err) {
      setTraceLogs([]);
      setLogsError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // ── Select a trace ──
  function handleSelectTrace(traceId: string) {
    setSelectedTraceId(traceId);
    setDetailSubTab("spans");
    setTraceSpans([]);
    setTraceLogs([]);
    setExpandedLogIdx(null);
    void loadTraceSpans(traceId);
  }

  function handleCloseDetail() {
    setSelectedTraceId(null);
    setTraceSpans([]);
    setTraceLogs([]);
    setExpandedLogIdx(null);
  }

  // ── Switch to logs sub-tab (load on demand) ──
  function handleSubTabChange(tab: DetailSubTab) {
    setDetailSubTab(tab);
    if (tab === "logs" && selectedTraceId && traceLogs.length === 0 && !logsLoading) {
      void loadTraceLogs(selectedTraceId);
    }
  }

  // ── Find the selected trace for header display ──
  const selectedTrace = traces.find((t) => t.trace_id === selectedTraceId);

  return (
    <div data-testid="telemetry-tab" className="flex gap-4 h-full min-h-0">
      {/* ── Left Panel: Traces List ── */}
      <div className={`flex flex-col min-w-0 ${selectedTraceId ? "w-1/2" : "w-full"} transition-all`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)]">
            Traces
          </h2>
          <Button
            variant="ghost"
            onClick={() => void loadTraces()}
            disabled={tracesLoading}
          >
            Refresh
          </Button>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-3" data-testid="telemetry-filters">
          <input
            type="text"
            value={filterPipeline}
            onChange={(e) => setFilterPipeline(e.target.value)}
            placeholder="Filter by pipeline..."
            className="w-48 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
            data-testid="filter-pipeline"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm text-[var(--color-ah-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
            data-testid="filter-status"
          >
            <option value="all">All statuses</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
          <select
            value={filterTimeRange}
            onChange={(e) => setFilterTimeRange(e.target.value)}
            className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm text-[var(--color-ah-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
            data-testid="filter-time-range"
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Traces content */}
        {tracesLoading ? (
          <div className="space-y-3" data-testid="telemetry-loading">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height="3rem" />
            ))}
          </div>
        ) : tracesError ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-center"
            data-testid="telemetry-error"
          >
            <div className="text-4xl mb-4 opacity-40">!</div>
            <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
              Unable to load traces
            </h3>
            <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">
              {tracesError}
            </p>
            <Button variant="primary" onClick={() => void loadTraces()}>
              Retry
            </Button>
          </div>
        ) : traces.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-center"
            data-testid="telemetry-empty"
          >
            <div className="text-4xl mb-4 opacity-40">&sim;</div>
            <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
              No traces found
            </h3>
            <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
              No telemetry traces match your current filters. Try adjusting the time range or filters.
            </p>
          </div>
        ) : (
          <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-sm" data-testid="traces-table">
              <thead>
                <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                  <th className="px-4 py-2.5 font-medium">Trace ID</th>
                  <th className="px-4 py-2.5 font-medium">Pipeline</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Start Time</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((trace) => (
                  <tr
                    key={trace.trace_id}
                    className={`border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors cursor-pointer ${
                      selectedTraceId === trace.trace_id ? "bg-[var(--color-ah-bg-overlay)]" : ""
                    }`}
                    onClick={() => handleSelectTrace(trace.trace_id)}
                    data-testid={`trace-row-${trace.trace_id}`}
                  >
                    <td className="px-4 py-3 font-[var(--font-ah-mono)] text-xs">
                      <span className="truncate block max-w-[120px]" title={trace.trace_id}>
                        {truncateId(trace.trace_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text)]">
                      {trace.pipeline}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[trace.status.toLowerCase()] ?? "default"}>
                        {trace.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)] text-xs whitespace-nowrap">
                      {formatDuration(trace.duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs whitespace-nowrap">
                      {formatTimestamp(trace.start_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Right Panel: Detail ── */}
      {selectedTraceId ? (
        <div
          className="w-1/2 flex flex-col border-l border-[var(--color-ah-border-muted)] pl-4 min-h-0"
          data-testid="trace-detail-panel"
        >
          {/* Detail header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-[var(--color-ah-text)] truncate" title={selectedTraceId}>
              Trace {truncateId(selectedTraceId, 16)}
            </h3>
            <Button variant="ghost" onClick={handleCloseDetail} data-testid="close-detail">
              Close
            </Button>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 mb-3 border-b border-[var(--color-ah-border-muted)]">
            <button
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                detailSubTab === "spans"
                  ? "text-[var(--color-ah-accent)] border-b-2 border-[var(--color-ah-accent)]"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
              }`}
              onClick={() => handleSubTabChange("spans")}
              data-testid="subtab-spans"
            >
              Spans
            </button>
            <button
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                detailSubTab === "logs"
                  ? "text-[var(--color-ah-accent)] border-b-2 border-[var(--color-ah-accent)]"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
              }`}
              onClick={() => handleSubTabChange("logs")}
              data-testid="subtab-logs"
            >
              Logs
            </button>
          </div>

          {/* Sub-tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detailSubTab === "spans" && (
              <>
                {spansLoading ? (
                  <div className="space-y-3" data-testid="spans-loading">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} height="2.5rem" />
                    ))}
                  </div>
                ) : spansError ? (
                  <div className="text-center py-8" data-testid="spans-error">
                    <p className="text-sm text-[var(--color-ah-danger)] mb-2">{spansError}</p>
                    <Button variant="primary" onClick={() => void loadTraceSpans(selectedTraceId)}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <TraceTreeViewer spans={traceSpans} traceId={selectedTraceId} />
                )}
              </>
            )}

            {detailSubTab === "logs" && (
              <>
                {logsLoading ? (
                  <div className="space-y-3" data-testid="logs-loading">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} height="2rem" />
                    ))}
                  </div>
                ) : logsError ? (
                  <div className="text-center py-8" data-testid="logs-error">
                    <p className="text-sm text-[var(--color-ah-danger)] mb-2">{logsError}</p>
                    <Button
                      variant="primary"
                      onClick={() => void loadTraceLogs(selectedTraceId)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : traceLogs.length === 0 ? (
                  <div className="text-center py-8 text-sm text-[var(--color-ah-text-subtle)]" data-testid="logs-empty">
                    No logs found for this trace.
                  </div>
                ) : (
                  <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
                    <table className="w-full text-sm" data-testid="logs-table">
                      <thead>
                        <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                          <th className="px-4 py-2.5 font-medium">Timestamp</th>
                          <th className="px-4 py-2.5 font-medium">Level</th>
                          <th className="px-4 py-2.5 font-medium">Scope</th>
                          <th className="px-4 py-2.5 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traceLogs.map((log, idx) => (
                          <tr
                            key={idx}
                            className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors cursor-pointer"
                            onClick={() => setExpandedLogIdx(expandedLogIdx === idx ? null : idx)}
                            data-testid={`log-row-${idx}`}
                          >
                            <td className="px-4 py-2 text-[var(--color-ah-text-muted)] text-xs whitespace-nowrap">
                              {formatTimestamp(log.timestamp)}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant={LOG_LEVEL_BADGE[log.level] ?? "default"}>
                                {log.level}
                              </Badge>
                            </td>
                            <td className="px-4 py-2 text-[var(--color-ah-text-muted)] text-xs">
                              {log.scope}
                            </td>
                            <td className="px-4 py-2 text-[var(--color-ah-text)]">
                              {expandedLogIdx === idx ? (
                                <span className="whitespace-pre-wrap break-all">{log.message}</span>
                              ) : (
                                <span className="truncate block max-w-xs" title={log.message}>
                                  {log.message}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* No trace selected — placeholder */
        !selectedTraceId && traces.length > 0 && !tracesLoading && !tracesError && (
          <div
            className="w-1/2 flex items-center justify-center border-l border-[var(--color-ah-border-muted)] pl-4"
            data-testid="detail-placeholder"
          >
            <p className="text-sm text-[var(--color-ah-text-subtle)]">
              Select a trace to view details
            </p>
          </div>
        )
      )}
    </div>
  );
}
