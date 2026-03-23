import { useState, useCallback, useRef, useEffect } from "react";
import { executeQuery, fetchQueryHistory, cancelQuery } from "../api";
import type { QueryResult, QueryHistoryEntry } from "../api";

/* ── SQL syntax highlighting (regex tokenizer) ── */

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP|BY|ORDER|ASC|DESC|LIMIT|OFFSET|HAVING|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|LIKE|BETWEEN|EXISTS|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|INTO|VALUES|SET|SHOW|DESCRIBE|EXPLAIN|WITH|COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|TIMESTAMP)\b/gi;
const SQL_STRINGS = /'[^']*'/g;
const SQL_NUMBERS = /\b\d+(\.\d+)?\b/g;
const SQL_COMMENTS = /--.*/g;

function highlightSql(sql: string): string {
  let result = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  result = result.replace(SQL_COMMENTS, '<span style="color:var(--color-ah-text-subtle)">$&</span>');
  result = result.replace(SQL_STRINGS, '<span style="color:var(--color-ah-success)">$&</span>');
  result = result.replace(SQL_NUMBERS, '<span style="color:var(--color-ah-warning)">$&</span>');
  result = result.replace(SQL_KEYWORDS, '<span style="color:var(--color-ah-accent);font-weight:600">$&</span>');

  return result;
}

/* ── CSV/JSON export ── */

function exportCsv(columns: string[], rows: unknown[][]): void {
  const header = columns.join(",");
  const body = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-result.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson(columns: string[], rows: unknown[][]): void {
  const data = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-result.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Page states ── */

type QueryState = "idle" | "running" | "results" | "error";

const ROWS_PER_PAGE = 50;

export function QueryConsolePage() {
  const [sql, setSql] = useState("SELECT * FROM assets LIMIT 100");
  const [state, setState] = useState<QueryState>("idle");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setState("running");
    setError(null);
    setResult(null);
    setPage(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await executeQuery(sql, controller.signal);
      setResult(res);
      setState("results");
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setState("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    } finally {
      abortRef.current = null;
    }
  }, [sql]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    if (result?.queryId) {
      void cancelQuery(result.queryId);
    }
    setState("idle");
  }, [result]);

  const handleClear = useCallback(() => {
    setSql("");
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  const loadHistory = useCallback(async () => {
    const h = await fetchQueryHistory();
    setHistory(h);
    setShowHistory(true);
  }, []);

  // Cmd+Enter shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void runQuery();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [runQuery]);

  const totalPages = result ? Math.ceil(result.rows.length / ROWS_PER_PAGE) : 0;
  const pagedRows = result?.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE) ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* ── SQL Editor (top 40%) ── */}
      <div className="flex-[4] min-h-0 flex flex-col border-b border-[var(--color-ah-border-muted)]">
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-ah-bg-raised)] border-b border-[var(--color-ah-border-muted)]">
          <h1 className="text-sm font-[var(--font-ah-display)] font-semibold mr-auto">SQL Query Console</h1>
          {state === "running" ? (
            <button onClick={handleCancel} className="px-3 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-danger)] text-white hover:opacity-90">
              Cancel
            </button>
          ) : (
            <button onClick={runQuery} className="px-3 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-accent)] text-white hover:opacity-90">
              Run
            </button>
          )}
          <button onClick={loadHistory} className="px-3 py-1 text-xs rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
            History
          </button>
          <button onClick={handleClear} className="px-3 py-1 text-xs rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
            Clear
          </button>
          {result && (
            <>
              <button onClick={() => exportCsv(result.columns, result.rows)} className="px-3 py-1 text-xs rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                CSV
              </button>
              <button onClick={() => exportJson(result.columns, result.rows)} className="px-3 py-1 text-xs rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                JSON
              </button>
            </>
          )}
        </div>
        <div className="flex-1 relative overflow-hidden">
          <pre
            className="absolute inset-0 p-4 font-[var(--font-ah-mono)] text-sm leading-6 whitespace-pre-wrap pointer-events-none overflow-auto"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightSql(sql) + "\n" }}
          />
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="absolute inset-0 p-4 font-[var(--font-ah-mono)] text-sm leading-6 bg-transparent text-transparent caret-[var(--color-ah-text)] resize-none outline-none w-full h-full"
            spellCheck={false}
            placeholder="Enter SQL query..."
            aria-label="SQL editor"
          />
        </div>
        <div className="px-4 py-1.5 bg-[var(--color-ah-bg-raised)] border-t border-[var(--color-ah-border-muted)] flex items-center gap-4 text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
          <span>Cmd+Enter to run</span>
          {state === "running" && <span className="text-[var(--color-ah-warning)]">Running...</span>}
          {state === "results" && result && (
            <span>{result.rowCount} rows in {result.durationMs}ms</span>
          )}
        </div>
      </div>

      {/* ── Results (bottom 60%) ── */}
      <div className="flex-[6] min-h-0 overflow-auto">
        {state === "idle" && (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-ah-text-subtle)]">
            Run a query to see results
          </div>
        )}

        {state === "running" && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-[var(--color-ah-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-[var(--color-ah-text-muted)] mt-3">Executing query...</p>
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="p-4">
            <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/5 p-4">
              <h3 className="text-sm font-medium text-[var(--color-ah-danger)] mb-1">Query Error</h3>
              <pre className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] whitespace-pre-wrap">{error}</pre>
            </div>
          </div>
        )}

        {state === "results" && result && (
          <div className="flex flex-col h-full">
            {result.truncated && (
              <div className="px-4 py-2 bg-[var(--color-ah-warning)]/10 border-b border-[var(--color-ah-warning)]/20 text-xs text-[var(--color-ah-warning)]">
                Results truncated to {result.rowCount.toLocaleString()} rows (server limit: 10,000)
              </div>
            )}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs font-[var(--font-ah-mono)]">
                <thead className="sticky top-0 bg-[var(--color-ah-bg-raised)] z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--color-ah-text-subtle)] font-medium border-b border-[var(--color-ah-border-muted)]">#</th>
                    {result.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[var(--color-ah-text-subtle)] font-medium border-b border-[var(--color-ah-border-muted)]">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--color-ah-bg-overlay)] transition-colors">
                      <td className="px-3 py-1.5 text-[var(--color-ah-text-subtle)] border-b border-[var(--color-ah-border-muted)]">
                        {page * ROWS_PER_PAGE + i + 1}
                      </td>
                      {(row as unknown[]).map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 text-[var(--color-ah-text)] border-b border-[var(--color-ah-border-muted)] max-w-[300px] truncate">
                          {cell === null ? <span className="text-[var(--color-ah-text-subtle)] italic">NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-ah-bg-raised)] border-t border-[var(--color-ah-border-muted)]">
                <span className="text-xs text-[var(--color-ah-text-subtle)]">
                  Page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border-muted)] disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border-muted)] disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* History dropdown */}
        {showHistory && (
          <div className="absolute top-16 right-4 w-96 max-h-80 overflow-auto rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] shadow-lg z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-ah-border-muted)]">
              <span className="text-xs font-medium">Query History</span>
              <button onClick={() => setShowHistory(false)} className="text-xs text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]">Close</button>
            </div>
            {history.length === 0 ? (
              <p className="p-3 text-xs text-[var(--color-ah-text-subtle)]">No history</p>
            ) : (
              history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => { setSql(h.sqlText); setShowHistory(false); }}
                  className="w-full text-left px-3 py-2 border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                >
                  <div className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text)] truncate">{h.sqlText}</div>
                  <div className="flex gap-3 mt-0.5 text-[10px] text-[var(--color-ah-text-subtle)]">
                    <span className={h.status === "success" ? "text-[var(--color-ah-success)]" : "text-[var(--color-ah-danger)]"}>{h.status}</span>
                    {h.durationMs != null && <span>{h.durationMs}ms</span>}
                    {h.rowCount != null && <span>{h.rowCount} rows</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
