import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchAnalyticsAssets,
  fetchAnalyticsPipeline,
  fetchAnalyticsStorage,
  fetchAnalyticsRender,
} from "../api";
import type {
  AnalyticsAssetsData,
  AnalyticsPipelineData,
  AnalyticsStorageData,
  AnalyticsRenderData,
} from "../api";
import {
  DashboardCard,
  StatCard,
  VerticalBarChart,
  HorizontalBarChart,
  DonutChart,
  LineChart,
  formatBytes,
  formatHours,
  formatDuration,
} from "../components/charts";

const RANGES = ["24h", "7d", "30d", "90d"] as const;

const STATUS_COLORS: Record<string, string> = {
  approved: "var(--color-ah-success)",
  pending_review: "var(--color-ah-warning)",
  in_progress: "var(--color-ah-accent)",
  rejected: "var(--color-ah-danger)",
  completed: "var(--color-ah-success)",
  failed: "var(--color-ah-danger)",
  retrying: "var(--color-ah-warning)",
  pending: "var(--color-ah-info)",
};

const MEDIA_COLORS: Record<string, string> = {
  exr: "var(--color-ah-accent)",
  mov: "var(--color-ah-purple)",
  abc: "var(--color-ah-success)",
  usd: "var(--color-ah-warning)",
  mtlx: "var(--color-ah-orange)",
};

const ENGINE_COLORS: Record<string, string> = {
  Arnold: "var(--color-ah-accent)",
  Karma: "var(--color-ah-purple)",
  RenderMan: "var(--color-ah-warning)",
  "V-Ray": "var(--color-ah-success)",
};

function getColor(key: string, map: Record<string, string>): string {
  return map[key] ?? "var(--color-ah-accent-muted)";
}

type Tab = "assets" | "pipeline" | "storage" | "render";

export function AnalyticsDashboard() {
  const [tab, setTab] = useState<Tab>("assets");
  const [range, setRange] = useState("7d");
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<AnalyticsAssetsData | null>(null);
  const [pipeline, setPipeline] = useState<AnalyticsPipelineData | null>(null);
  const [storage, setStorage] = useState<AnalyticsStorageData | null>(null);
  const [render, setRender] = useState<AnalyticsRenderData | null>(null);
  const [countdown, setCountdown] = useState(300);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [a, p, s, r] = await Promise.allSettled([
      fetchAnalyticsAssets(range),
      fetchAnalyticsPipeline(range),
      fetchAnalyticsStorage(range),
      fetchAnalyticsRender(range),
    ]);
    setAssets(a.status === "fulfilled" ? a.value : null);
    setPipeline(p.status === "fulfilled" ? p.value : null);
    setStorage(s.status === "fulfilled" ? s.value : null);
    setRender(r.status === "fulfilled" ? r.value : null);
    setLoading(false);
    setCountdown(300);
  }, [range]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-refresh countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void loadData();
          return 300;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loadData]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "assets", label: "Assets" },
    { key: "pipeline", label: "Pipeline" },
    { key: "storage", label: "Storage" },
    { key: "render", label: "Render Farm" },
  ];

  if (loading && !assets && !pipeline && !storage && !render) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">Analytics</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[280px] rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">Analytics</h1>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
            Refresh in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
          </span>
          <div className="flex rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs font-[var(--font-ah-mono)] transition-colors ${
                  range === r
                    ? "bg-[var(--color-ah-accent)] text-white"
                    : "text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--color-ah-border-muted)]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
                : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === "assets" && (
        <AssetsPanel data={assets} />
      )}
      {tab === "pipeline" && (
        <PipelinePanel data={pipeline} />
      )}
      {tab === "storage" && (
        <StoragePanel data={storage} />
      )}
      {tab === "render" && (
        <RenderPanel data={render} />
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <DashboardCard title={label}>
      <div className="text-center py-8">
        <p className="text-sm text-[var(--color-ah-text-subtle)]">No data available</p>
        <p className="text-xs text-[var(--color-ah-text-subtle)] mt-1">Configure your VAST connection to see real analytics</p>
      </div>
    </DashboardCard>
  );
}

function AssetsPanel({ data }: { data: AnalyticsAssetsData | null }) {
  if (!data) return <EmptyState label="Asset Metrics" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Assets" value={data.totalAssets.toLocaleString()} />
        <StatCard label="Approved" value={String(data.byStatus.find((s) => s.status === "approved")?.count ?? 0)} />
        <StatCard label="Pending Review" value={String(data.byStatus.find((s) => s.status === "pending_review")?.count ?? 0)} />
        <StatCard label="Media Types" value={String(data.byMediaType.length)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DashboardCard title="Assets by Status">
          <DonutChart
            segments={data.byStatus.map((s) => ({ label: s.status, value: s.count, color: getColor(s.status, STATUS_COLORS) }))}
          />
          <div className="mt-3 space-y-1">
            {data.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(s.status, STATUS_COLORS) }} />
                  <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{s.status}</span>
                </div>
                <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">{s.count}</span>
              </div>
            ))}
          </div>
        </DashboardCard>
        <DashboardCard title="Top Accessed Assets">
          <div className="space-y-2">
            {data.topAccessed.map((a, i) => (
              <div key={a.assetId} className="flex items-center justify-between py-1.5 border-b border-[var(--color-ah-border-muted)] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)] w-4">{i + 1}</span>
                  <span className="text-sm font-[var(--font-ah-mono)] text-[var(--color-ah-text)] truncate max-w-[200px]">{a.name}</span>
                </div>
                <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]">{a.accessCount} views</span>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}

function PipelinePanel({ data }: { data: AnalyticsPipelineData | null }) {
  if (!data) return <EmptyState label="Pipeline Metrics" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Completion Rate" value={`${data.completionRate.toFixed(1)}%`} />
        <StatCard label="Throughput/hr" value={data.throughputPerHour.toFixed(1)} />
        <StatCard label="DLQ Size" value={String(data.dlqSize)} />
        <StatCard label="Retry Success" value={`${data.retrySuccessRate.toFixed(1)}%`} />
      </div>
      <DashboardCard title="Jobs by Status">
        <VerticalBarChart
          data={data.jobsByStatus.map((j) => ({ label: j.status, value: j.count, color: getColor(j.status, STATUS_COLORS) }))}
        />
      </DashboardCard>
    </div>
  );
}

function StoragePanel({ data }: { data: AnalyticsStorageData | null }) {
  if (!data) return <EmptyState label="Storage Metrics" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Storage" value={formatBytes(data.totalBytes)} />
        <StatCard label="Proxy Coverage" value={`${data.proxyCoverage.toFixed(1)}%`} />
        <StatCard label="Thumbnail Coverage" value={`${data.thumbnailCoverage.toFixed(1)}%`} />
        <StatCard label="Media Types" value={String(data.byMediaType.length)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DashboardCard title="Storage by Media Type">
          <HorizontalBarChart
            data={data.byMediaType.map((m) => ({
              label: m.mediaType,
              value: m.bytes,
              sublabel: formatBytes(m.bytes),
              color: getColor(m.mediaType, MEDIA_COLORS),
            }))}
          />
        </DashboardCard>
        <DashboardCard title="Storage by Type (Donut)">
          <DonutChart
            segments={data.byMediaType.map((m) => ({ label: m.mediaType, value: m.bytes, color: getColor(m.mediaType, MEDIA_COLORS) }))}
          />
        </DashboardCard>
      </div>
      {data.growthTrend.length > 0 && (
        <DashboardCard title="Storage Growth Trend">
          <LineChart
            series={[{ label: "Storage", data: data.growthTrend, color: "var(--color-ah-accent)" }]}
            height={180}
          />
        </DashboardCard>
      )}
    </div>
  );
}

function RenderPanel({ data }: { data: AnalyticsRenderData | null }) {
  if (!data) return <EmptyState label="Render Metrics" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Core Hours" value={`${formatHours(data.totalCoreHours)}h`} />
        <StatCard label="Avg Render Time" value={formatDuration(data.avgRenderTimeSeconds)} />
        <StatCard label="Engines" value={String(data.jobsByEngine.length)} />
        <StatCard label="Peak Memory Pts" value={String(data.peakMemoryTrend.length)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DashboardCard title="Jobs by Engine">
          <VerticalBarChart
            data={data.jobsByEngine.map((e) => ({ label: e.engine, value: e.count, color: getColor(e.engine, ENGINE_COLORS) }))}
          />
        </DashboardCard>
        {data.peakMemoryTrend.length > 0 && (
          <DashboardCard title="Peak Memory Trend">
            <LineChart
              series={[{ label: "Memory GB", data: data.peakMemoryTrend, color: "var(--color-ah-warning)" }]}
              height={180}
            />
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
