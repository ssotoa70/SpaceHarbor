import { useState, useCallback, useMemo } from "react";
import { Badge } from "../../design-system/Badge";
import type { BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Skeleton } from "../../design-system/Skeleton";
import { fetchSpanLogs } from "../../api/dataengine-proxy";
import type { TraceSpan, TelemetryLog } from "../../types/dataengine";

const STATUS_BADGE: Record<string, BadgeVariant> = {
  ok: "success",
  unset: "success",
  error: "danger",
};

const LOG_LEVEL_BADGE: Record<string, BadgeVariant> = {
  TRACE: "default",
  DEBUG: "default",
  INFO: "info",
  WARN: "warning",
  ERROR: "danger",
  FATAL: "danger",
};

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

/**
 * Compute the earliest start time and total duration across all root-level spans.
 */
function computeRootMetrics(spans: TraceSpan[]): {
  rootStart: number;
  rootDuration: number;
} {
  if (spans.length === 0) return { rootStart: 0, rootDuration: 1 };

  let earliest = Infinity;
  let latest = -Infinity;

  for (const span of spans) {
    const start = new Date(span.started_at).getTime();
    const end = start + span.duration_ms;
    if (start < earliest) earliest = start;
    if (end > latest) latest = end;
  }

  const rootDuration = latest - earliest;
  return { rootStart: earliest, rootDuration: rootDuration || 1 };
}

interface SpanRowProps {
  span: TraceSpan;
  depth: number;
  rootStart: number;
  rootDuration: number;
  traceId: string;
}

function SpanRow({ span, depth, rootStart, rootDuration, traceId }: SpanRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [spanLogs, setSpanLogs] = useState<TelemetryLog[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const spanStart = new Date(span.started_at).getTime();
  const offsetPercent = ((spanStart - rootStart) / rootDuration) * 100;
  const widthPercent = (span.duration_ms / rootDuration) * 100;

  const statusVariant = STATUS_BADGE[span.status.toLowerCase()] ?? "default";

  const handleViewLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const logs = await fetchSpanLogs(traceId, span.span_id);
      setSpanLogs(logs);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Failed to load span logs");
    } finally {
      setLogsLoading(false);
    }
  }, [traceId, span.span_id]);

  const attributes = useMemo(
    () => Object.entries(span.attributes),
    [span.attributes],
  );

  return (
    <div data-testid={`span-row-${span.span_id}`}>
      {/* Span header row */}
      <div
        className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)] px-2 transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        {/* Connector indicator */}
        {depth > 0 && (
          <span
            className="border-l-2 border-[var(--color-ah-border-muted)] h-4 mr-1"
            aria-hidden="true"
          />
        )}

        {/* Expand/collapse indicator */}
        <span className="text-xs text-[var(--color-ah-text-subtle)] w-4 flex-shrink-0">
          {(attributes.length > 0 || span.children.length > 0) ? (expanded ? "\u25BC" : "\u25B6") : "\u00B7"}
        </span>

        {/* Operation name */}
        <span className="font-semibold text-sm text-[var(--color-ah-text)] truncate max-w-[200px]" title={span.operation_name}>
          {span.operation_name}
        </span>

        {/* Service name */}
        <span className="text-xs text-[var(--color-ah-text-muted)] truncate max-w-[140px]" title={span.service_name}>
          {span.service_name}
        </span>

        {/* Status badge */}
        <Badge variant={statusVariant}>{span.status}</Badge>

        {/* Duration */}
        <span className="text-xs text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)] whitespace-nowrap">
          {formatDuration(span.duration_ms)}
        </span>

        {/* Waterfall bar */}
        <div className="flex-1 min-w-[80px] h-3 relative ml-2">
          <div className="absolute inset-0 bg-[var(--color-ah-border-muted)] rounded-sm opacity-30" />
          <div
            className={`absolute h-full rounded-sm ${
              span.status.toLowerCase() === "error"
                ? "bg-[var(--color-ah-danger)]"
                : "bg-[var(--color-ah-accent)]"
            }`}
            style={{
              left: `${Math.min(offsetPercent, 100)}%`,
              width: `${Math.max(Math.min(widthPercent, 100 - offsetPercent), 1)}%`,
            }}
          />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          className="ml-6 mb-2 text-xs"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {/* Span ID */}
          <div className="text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] mb-1">
            span: {span.span_id}
          </div>

          {/* Attributes */}
          {attributes.length > 0 && (
            <div
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-overlay)] p-2 mb-2"
              data-testid={`span-attributes-${span.span_id}`}
            >
              <div className="text-[var(--color-ah-text-subtle)] font-semibold mb-1">Attributes</div>
              <div className="space-y-0.5">
                {attributes.map(([key, value]) => (
                  <div key={key} className="flex gap-2 font-[var(--font-ah-mono)]">
                    <span className="text-[var(--color-ah-text-muted)]">{key}:</span>
                    <span className="text-[var(--color-ah-text)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View Span Logs button */}
          <div className="flex items-center gap-2 mb-1">
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                void handleViewLogs();
              }}
              disabled={logsLoading}
              className="text-xs px-2 py-0.5"
              data-testid={`span-view-logs-${span.span_id}`}
            >
              {logsLoading ? "Loading..." : "View Span Logs"}
            </Button>
          </div>

          {/* Span logs (inline) */}
          {logsError && (
            <div className="text-[var(--color-ah-danger)] text-xs mb-1">{logsError}</div>
          )}
          {logsLoading && <Skeleton height="2rem" />}
          {spanLogs !== null && spanLogs.length === 0 && (
            <div className="text-[var(--color-ah-text-subtle)] italic">No logs for this span.</div>
          )}
          {spanLogs !== null && spanLogs.length > 0 && (
            <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden mt-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                    <th className="px-2 py-1 font-medium">Time</th>
                    <th className="px-2 py-1 font-medium">Level</th>
                    <th className="px-2 py-1 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {spanLogs.map((log, idx) => (
                    <tr key={idx} className="border-t border-[var(--color-ah-border-muted)]">
                      <td className="px-2 py-1 text-[var(--color-ah-text-muted)] whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant={LOG_LEVEL_BADGE[log.level] ?? "default"}>
                          {log.level}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-[var(--color-ah-text)] truncate max-w-xs" title={log.message}>
                        {log.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {span.children.map((child) => (
        <SpanRow
          key={child.span_id}
          span={child}
          depth={depth + 1}
          rootStart={rootStart}
          rootDuration={rootDuration}
          traceId={traceId}
        />
      ))}
    </div>
  );
}

export function TraceTreeViewer({
  spans,
  traceId,
}: {
  spans: TraceSpan[];
  traceId: string;
}) {
  const { rootStart, rootDuration } = useMemo(
    () => computeRootMetrics(spans),
    [spans],
  );

  if (spans.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 text-center"
        data-testid="trace-tree-empty"
      >
        <div className="text-[var(--color-ah-text-subtle)] text-sm">
          No spans found for this trace.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="trace-tree-viewer" className="space-y-0.5">
      {spans.map((span) => (
        <SpanRow
          key={span.span_id}
          span={span}
          depth={0}
          rootStart={rootStart}
          rootDuration={rootDuration}
          traceId={traceId}
        />
      ))}
    </div>
  );
}
