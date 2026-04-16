/**
 * Circuit Breakers admin page.
 *
 * Auto-refreshes every 5 seconds so ops can watch a circuit open/close
 * during an incident. Reset button force-closes a breaker (admin override).
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import { listBreakers, resetBreaker, type CircuitBreakerStats } from "../../api";

const REFRESH_MS = 5_000;

export function BreakersPage() {
  const [breakers, setBreakers] = useState<CircuitBreakerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listBreakers();
      setBreakers(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const handleReset = useCallback(async (name: string) => {
    if (!confirm(`Force-close the "${name}" circuit breaker? This is an admin override — only use if you know the downstream dependency is healthy.`)) return;
    try {
      await resetBreaker(name);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }, [reload]);

  return (
    <section aria-label="Circuit Breakers" className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold">Circuit Breakers</h1>
        <p className="text-sm text-[var(--color-ah-text-muted)]">
          Short-circuit wrappers around VAST DB, S3, and Kafka. Auto-refreshes every 5 s.
          When a breaker is <Badge variant="danger">open</Badge>, every call to that downstream
          fast-fails until the timeout expires.
        </p>
      </header>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">State</th>
              <th className="px-3 py-2 text-right font-medium">Failures</th>
              <th className="px-3 py-2 text-right font-medium">Successes</th>
              <th className="px-3 py-2 text-left font-medium">Last Failure</th>
              <th className="px-3 py-2 text-left font-medium">Opened At</th>
              <th className="px-3 py-2 text-left font-medium">Next Attempt</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>}
            {!loading && breakers.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No breakers registered.
              </td></tr>
            )}
            {breakers.map((b) => (
              <tr key={b.name} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-sm">{b.name}</td>
                <td className="px-3 py-2">
                  <Badge variant={
                    b.state === "closed" ? "success" :
                    b.state === "half-open" ? "warning" : "danger"
                  }>{b.state}</Badge>
                </td>
                <td className="px-3 py-2 text-right font-[var(--font-ah-mono)] text-xs">{b.failureCount}</td>
                <td className="px-3 py-2 text-right font-[var(--font-ah-mono)] text-xs">{b.successCount}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {b.lastFailureAt ? new Date(b.lastFailureAt).toLocaleTimeString() : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {b.openedAt ? new Date(b.openedAt).toLocaleTimeString() : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {b.nextAttemptAt ? new Date(b.nextAttemptAt).toLocaleTimeString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {b.state !== "closed" && (
                    <Button variant="ghost" onClick={() => void handleReset(b.name)}>Force close</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
