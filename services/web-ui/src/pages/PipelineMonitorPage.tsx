import { useEffect, useState } from "react";

import { fetchQueueItems, fetchDlqItems } from "../api";
import type { QueueItemData, DlqItemData } from "../api";
import { Badge, Card } from "../design-system";

type MonitorTab = "jobs" | "dlq";

export function PipelineMonitorPage() {
  const [tab, setTab] = useState<MonitorTab>("jobs");
  const [queueItems, setQueueItems] = useState<QueueItemData[]>([]);
  const [dlqItems, setDlqItems] = useState<DlqItemData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([fetchQueueItems(), fetchDlqItems()]).then(([q, d]) => {
      setQueueItems(q);
      setDlqItems(d);
      setLoading(false);
    });
  }, []);

  const statusVariant = (status: QueueItemData["status"]) => {
    switch (status) {
      case "queued": return "default" as const;
      case "processing": return "warning" as const;
      case "completed": return "success" as const;
      case "failed": return "danger" as const;
    }
  };

  const activeJobs = queueItems.filter((i) => i.status === "processing");
  const queuedJobs = queueItems.filter((i) => i.status === "queued");

  return (
    <section aria-label="Pipeline monitor" className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Pipeline Monitor</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{activeJobs.length}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Active Jobs</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{queuedJobs.length}</p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">Queue Depth</p>
        </Card>
        <Card className="p-4 text-center">
          <p className={`text-2xl font-bold ${dlqItems.length > 0 ? "text-[var(--color-ah-danger)]" : ""}`}>
            {dlqItems.length}
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)]">DLQ Items</p>
        </Card>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-2 mb-4 border-b border-[var(--color-ah-border-muted)] pb-2">
        <button
          className={`px-3 py-1 text-sm font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
            tab === "jobs"
              ? "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
              : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          }`}
          onClick={() => setTab("jobs")}
        >
          Jobs ({queueItems.length})
        </button>
        <button
          className={`px-3 py-1 text-sm font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
            tab === "dlq"
              ? "bg-[var(--color-ah-danger)]/15 text-[var(--color-ah-danger)]"
              : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          }`}
          onClick={() => setTab("dlq")}
        >
          DLQ ({dlqItems.length})
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading pipeline data...</p>
      ) : tab === "jobs" ? (
        queueItems.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              No jobs in the pipeline.
            </p>
          </Card>
        ) : (
          <div className="grid gap-1">
            <div className="grid grid-cols-[1fr_120px_100px_80px_140px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
              <span>Asset</span>
              <span>Stage</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Queued At</span>
            </div>
            {queueItems.map((item) => (
              <Card key={item.id} className="grid grid-cols-[1fr_120px_100px_80px_140px] gap-4 items-center px-4 py-2">
                <span className="text-sm truncate">{item.assetTitle}</span>
                <span className="text-xs text-[var(--color-ah-text-muted)]">{item.stage}</span>
                <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                <span className="text-xs">{item.priority}</span>
                <span className="text-xs text-[var(--color-ah-text-muted)]">
                  {new Date(item.queuedAt).toLocaleString()}
                </span>
              </Card>
            ))}
          </div>
        )
      ) : (
        dlqItems.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              DLQ is empty.
            </p>
          </Card>
        ) : (
          <div className="grid gap-1">
            <div className="grid grid-cols-[1fr_120px_1fr_80px_140px] gap-4 px-4 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wide">
              <span>Asset</span>
              <span>Stage</span>
              <span>Error</span>
              <span>Retries</span>
              <span>Last Failed</span>
            </div>
            {dlqItems.map((item) => (
              <Card key={item.id} className="grid grid-cols-[1fr_120px_1fr_80px_140px] gap-4 items-center px-4 py-2">
                <span className="text-sm truncate">{item.assetTitle}</span>
                <span className="text-xs text-[var(--color-ah-text-muted)]">{item.stage}</span>
                <span className="text-xs text-[var(--color-ah-danger)] truncate">{item.errorMessage}</span>
                <span className="text-xs">{item.retryCount}</span>
                <span className="text-xs text-[var(--color-ah-text-muted)]">
                  {new Date(item.lastFailedAt).toLocaleString()}
                </span>
              </Card>
            ))}
          </div>
        )
      )}
    </section>
  );
}
