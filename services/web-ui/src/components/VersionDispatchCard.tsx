/**
 * VersionDispatchCard — shows DataEngine dispatch status for a version.
 *
 * Auto-refreshes every 5s while any dispatch is pending. Renders a compact
 * row per expected DataEngine function with current status, proxy/thumb
 * links, and error details.
 *
 * Drop into: AssetDetail, VersionDetail.
 *
 * Usage:
 *   <VersionDispatchCard versionId={version.id} />
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../design-system";
import { listVersionDispatches, type DataEngineDispatch } from "../api";

export interface VersionDispatchCardProps {
  versionId: string;
  className?: string;
}

const REFRESH_MS_WHEN_PENDING = 5_000;
const REFRESH_MS_WHEN_IDLE = 30_000;

export function VersionDispatchCard({ versionId, className }: VersionDispatchCardProps) {
  const [dispatches, setDispatches] = useState<DataEngineDispatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listVersionDispatches(versionId);
      setDispatches(rows);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dispatches");
      setLoaded(true);
    }
  }, [versionId]);

  useEffect(() => {
    void reload();
    // Poll cadence depends on whether anything is pending
    const hasPending = dispatches.some((d) => d.status === "pending");
    const interval = hasPending ? REFRESH_MS_WHEN_PENDING : REFRESH_MS_WHEN_IDLE;
    const timer = setInterval(() => void reload(), interval);
    return () => clearInterval(timer);
  }, [reload, dispatches]);

  if (!loaded) {
    return <div className={className}><div className="text-xs text-[var(--color-ah-text-muted)]">Loading processing status…</div></div>;
  }

  if (error) {
    return (
      <div className={className}>
        <div className="text-xs text-red-400">Processing status unavailable: {error}</div>
      </div>
    );
  }

  if (dispatches.length === 0) {
    return (
      <div className={className}>
        <div className="text-xs text-[var(--color-ah-text-muted)]">
          No DataEngine processing expected for this version.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="grid gap-1.5">
        {dispatches.map((d) => <DispatchRow key={d.id} dispatch={d} />)}
      </div>
    </div>
  );
}

function DispatchRow({ dispatch: d }: { dispatch: DataEngineDispatch }) {
  const statusVariant =
    d.status === "completed" ? "success" :
    d.status === "failed" ? "danger" :
    d.status === "abandoned" ? "warning" : "info";

  return (
    <div className="flex items-center gap-2 text-xs p-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]">
      <Badge variant={statusVariant}>{d.status}</Badge>
      <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]/80">{d.expectedFunction}</span>
      <span className="text-[var(--color-ah-text-subtle)]">·</span>
      <span className="text-[var(--color-ah-text-muted)]">{d.fileRole}</span>
      <span className="text-[var(--color-ah-text-subtle)]">·</span>
      <Badge variant="default">{d.fileKind}</Badge>

      {d.proxyUrl && (
        <a
          href={d.proxyUrl}
          target="_blank" rel="noreferrer"
          className="ml-auto text-[var(--color-ah-accent)] hover:underline"
          title={d.proxyUrl}
        >
          proxy →
        </a>
      )}
      {!d.proxyUrl && d.thumbnailUrl && (
        <a href={d.thumbnailUrl} target="_blank" rel="noreferrer"
          className="ml-auto text-[var(--color-ah-accent)] hover:underline">
          thumb →
        </a>
      )}
      {!d.proxyUrl && !d.thumbnailUrl && d.status === "pending" && (
        <span className="ml-auto text-[var(--color-ah-text-subtle)]">
          polling ({d.pollAttempts}×)…
        </span>
      )}
      {d.lastError && (
        <span className="ml-auto text-red-400 truncate max-w-[260px]" title={d.lastError}>
          {d.lastError}
        </span>
      )}
    </div>
  );
}
