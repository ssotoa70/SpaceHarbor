/**
 * Dispatches admin page — DataEngine auto-trigger ledger.
 *
 * Surfaces the ingest → proxy-gen feedback loop: one row per expected
 * DataEngine function run, with current status, artifact URLs, and
 * error details. The Sweep button manually triggers the poller for
 * incident response.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  listDispatches, sweepDispatches,
  type DataEngineDispatch, type DispatchStatus,
} from "../../api";

const AUTO_REFRESH_MS = 10_000;

export function DispatchesPage() {
  const [dispatches, setDispatches] = useState<DataEngineDispatch[]>([]);
  const [statusFilter, setStatusFilter] = useState<DispatchStatus | "all">("all");
  const [versionFilter, setVersionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const reload = useCallback(async (cursor?: string | null) => {
    try {
      const r = await listDispatches({
        status: statusFilter === "all" ? undefined : statusFilter,
        versionId: versionFilter.trim() || undefined,
        cursor: cursor ?? undefined,
        limit: 50,
      });
      setDispatches(r.dispatches);
      setNextCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, versionFilter]);

  useEffect(() => {
    setCursors([]); void reload(null);
    const timer = setInterval(() => void reload(null), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const handleSweep = useCallback(async () => {
    setSweeping(true); setSweepResult(null);
    try {
      const r = await sweepDispatches();
      setSweepResult(`polled ${r.polled}, completed ${r.completed}, abandoned ${r.abandoned}`);
      await reload(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }, [reload]);

  return (
    <section aria-label="DataEngine Dispatches" className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">DataEngine Dispatches</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            One row per expected DataEngine function run. Poller sweeps pending rows every
            15 s on the worker replica.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sweepResult && <span className="text-xs text-[var(--color-ah-text-muted)]">{sweepResult}</span>}
          <Button variant="primary" onClick={() => void handleSweep()} disabled={sweeping}>
            {sweeping ? "Sweeping…" : "Sweep Now"}
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-[var(--color-ah-text-muted)]">Status:</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DispatchStatus | "all")}
            className="px-2 py-1 rounded border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)]">
            <option value="all">All</option>
            <option value="pending">pending</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="abandoned">abandoned</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-[var(--color-ah-text-muted)]">Version ID:</span>
          <input type="text" value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}
            placeholder="uuid"
            className="px-2 py-1 rounded border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-xs w-64" />
        </label>
      </div>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2 text-left font-medium">Version</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Kind</th>
              <th className="px-3 py-2 text-left font-medium">Function</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Polls</th>
              <th className="px-3 py-2 text-left font-medium">Output</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>}
            {!loading && dispatches.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No dispatches match the current filters.
              </td></tr>
            )}
            {dispatches.map((d) => (
              <tr key={d.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">{new Date(d.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{d.versionId.slice(0, 8)}…</td>
                <td className="px-3 py-2 text-xs">{d.fileRole}</td>
                <td className="px-3 py-2"><Badge variant="default">{d.fileKind}</Badge></td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{d.expectedFunction}</td>
                <td className="px-3 py-2">
                  <Badge variant={
                    d.status === "completed" ? "success" :
                    d.status === "failed" ? "danger" :
                    d.status === "abandoned" ? "warning" : "info"
                  }>{d.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right font-[var(--font-ah-mono)] text-xs">{d.pollAttempts}</td>
                <td className="px-3 py-2 text-xs">
                  {d.proxyUrl && <div className="text-[var(--color-ah-accent)]">proxy ✓</div>}
                  {d.thumbnailUrl && <div className="text-[var(--color-ah-accent)]">thumb ✓</div>}
                  {d.lastError && <div className="text-red-400 truncate max-w-[200px]" title={d.lastError}>{d.lastError}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={cursors.length === 0} onClick={() => {
          const prev = cursors[cursors.length - 1] ?? null;
          setCursors(cursors.slice(0, -1));
          void reload(prev);
        }}>← Prev</Button>
        <Button variant="ghost" disabled={!nextCursor} onClick={() => {
          if (nextCursor) {
            setCursors([...cursors, nextCursor]);
            void reload(nextCursor);
          }
        }}>Next →</Button>
      </div>
    </section>
  );
}
