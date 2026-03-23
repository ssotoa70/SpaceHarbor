import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchRenderCostReport,
  fetchCapacityForecast,
  fetchStorageSummary,
  fetchCatalogStorageSummary,
  fetchCatalogOrphans,
} from "../api";
import type {
  RenderCostReport,
  CapacityForecast,
  StorageMetricSummary,
  CatalogStorageBreakdown,
  OrphanFile,
} from "../api";
import {
  DashboardCard,
  VerticalBarChart,
  HorizontalBarChart,
  Sparkline,
  StatCard,
  formatBytes,
  formatHours,
  formatDuration,
} from "../components/charts";

/* ── Bottleneck detection types ── */

interface StageMetricWindow {
  stage: string;
  currentMedianSeconds: number;
  previousMedianSeconds: number;
}

/* ── Utilities ── */

const DEPARTMENT_COLORS: Record<string, string> = {
  lighting: "var(--color-ah-warning)",
  comp: "var(--color-ah-accent)",
  fx: "var(--color-ah-purple)",
  animation: "var(--color-ah-success)",
  lookdev: "var(--color-ah-orange)",
  roto: "var(--color-ah-info)",
  paint: "var(--color-ah-danger)",
  editorial: "var(--color-ah-text-muted)",
};

function getDeptColor(dept: string): string {
  return DEPARTMENT_COLORS[dept.toLowerCase()] ?? "var(--color-ah-accent-muted)";
}

/* ── Bottleneck detection ── */

interface BottleneckStatus {
  stage: string;
  level: "green" | "yellow" | "red";
  percentChange: number;
  currentMedianSeconds: number;
  previousMedianSeconds: number;
}

function computeBottlenecks(data: StageMetricWindow[]): BottleneckStatus[] {
  return data.map((d) => {
    const pctChange =
      d.previousMedianSeconds > 0
        ? ((d.currentMedianSeconds - d.previousMedianSeconds) / d.previousMedianSeconds) * 100
        : 0;
    let level: "green" | "yellow" | "red" = "green";
    if (pctChange > 20) level = "red";
    else if (pctChange > 10) level = "yellow";
    return {
      stage: d.stage,
      level,
      percentChange: pctChange,
      currentMedianSeconds: d.currentMedianSeconds,
      previousMedianSeconds: d.previousMedianSeconds,
    };
  });
}

/* ── Traffic light indicator ── */

function TrafficLight({ level }: { level: "green" | "yellow" | "red" }) {
  const colors: Record<string, string> = {
    green: "var(--color-ah-success)",
    yellow: "var(--color-ah-warning)",
    red: "var(--color-ah-danger)",
  };
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: colors[level] }}
      aria-label={`Status: ${level}`}
    />
  );
}

/* ── Main page component ── */

export function CapacityPlanningDashboard() {
  const [renderReport, setRenderReport] = useState<RenderCostReport | null>(null);
  const [storageMetrics, setStorageMetrics] = useState<StorageMetricSummary[]>([]);
  const [forecast, setForecast] = useState<CapacityForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogBreakdown, setCatalogBreakdown] = useState<CatalogStorageBreakdown | null>(null);
  const [orphanFiles, setOrphanFiles] = useState<OrphanFile[]>([]);

  const projectId = "default";

  const loadData = useCallback(async () => {
    setLoading(true);
    const [reportResult, storageResult, forecastResult, catalogResult, orphansResult] = await Promise.allSettled([
      fetchRenderCostReport(projectId, "department"),
      fetchStorageSummary(projectId),
      fetchCapacityForecast(projectId),
      fetchCatalogStorageSummary(projectId),
      fetchCatalogOrphans(),
    ]);

    setRenderReport(
      reportResult.status === "fulfilled" && reportResult.value
        ? reportResult.value
        : null,
    );
    setStorageMetrics(
      storageResult.status === "fulfilled" && storageResult.value.length > 0
        ? storageResult.value
        : [],
    );
    setForecast(
      forecastResult.status === "fulfilled" && forecastResult.value
        ? forecastResult.value
        : null,
    );
    setCatalogBreakdown(
      catalogResult.status === "fulfilled" ? catalogResult.value : null,
    );
    setOrphanFiles(
      orphansResult.status === "fulfilled" ? orphansResult.value : [],
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const bottlenecks = useMemo(() => computeBottlenecks([]), []);
  const activeJobCount = forecast?.renderJobCount ?? 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">
          Capacity Planning
        </h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[280px] rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">
          Capacity Planning
        </h1>
        {forecast?.measuredAt && (
          <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
            {`Updated ${new Date(forecast.measuredAt).toLocaleString()}`}
          </span>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Storage" value={formatBytes(forecast?.currentStorageBytes ?? 0)} />
        <StatCard label="Total Files" value={(forecast?.currentFileCount ?? 0).toLocaleString()} />
        <StatCard label="Core Hours" value={`${formatHours(forecast?.totalCoreHours ?? 0)}h`} />
        <StatCard
          label="Avg Render Time"
          value={formatDuration(forecast?.avgRenderTimeSeconds ?? 0)}
        />
      </div>

      {/* Four-panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Panel 1: Render Queue Load */}
        <DashboardCard title="Render Queue Load by Department">
          {renderReport && renderReport.breakdown.length > 0 ? (
            <>
              <VerticalBarChart
                data={renderReport.breakdown.map((d) => ({
                  label: d.group,
                  value: d.coreHours,
                  color: getDeptColor(d.group),
                }))}
              />
              <div className="mt-3 flex items-center justify-between text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                <span>{renderReport.totalJobs} total jobs</span>
                <span>{formatHours(renderReport.totalCoreHours)} core hours</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)]">No render data available</p>
          )}
        </DashboardCard>

        {/* Panel 2: Storage by Department */}
        <DashboardCard title="Storage by Department">
          {storageMetrics.length > 0 ? (
            <HorizontalBarChart
              data={storageMetrics.map((d) => ({
                label: d.entityId,
                value: d.totalBytes,
                sublabel: `${formatBytes(d.totalBytes)} / ${d.fileCount.toLocaleString()} files`,
                color: getDeptColor(d.entityId),
              }))}
            />
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)]">No storage data available</p>
          )}
        </DashboardCard>

        {/* Panel 3: Active Jobs */}
        <DashboardCard title="Active Jobs">
          {forecast ? (
          <div className="flex items-center gap-6">
            <div>
              <div className="text-3xl font-bold font-[var(--font-ah-display)] text-[var(--color-ah-text)]">
                {activeJobCount}
              </div>
              <div className="text-xs text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] mt-1">
                render jobs
              </div>
            </div>
            <div className="flex-1 flex justify-end">
              <Sparkline data={[]} />
            </div>
          </div>
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)]">No capacity data available</p>
          )}

          {/* Per-department job breakdown */}
          {renderReport && renderReport.breakdown.length > 0 && (
            <div className="mt-4 space-y-2">
              {renderReport.breakdown.map((d) => (
                <div key={d.group} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getDeptColor(d.group) }}
                    />
                    <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                      {d.group}
                    </span>
                  </div>
                  <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                    {d.jobCount} jobs / {d.frameCount.toLocaleString()} frames
                  </span>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>

        {/* Panel 4: Catalog Storage Breakdown (C.10) */}
        <DashboardCard title="VAST Catalog Storage (Actual Disk)">
          {catalogBreakdown && catalogBreakdown.byMediaType.length > 0 ? (
            <>
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-2xl font-bold font-[var(--font-ah-display)] text-[var(--color-ah-text)]">
                  {formatBytes(catalogBreakdown.totalBytes)}
                </span>
                <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                  {catalogBreakdown.totalFileCount.toLocaleString()} files on disk
                </span>
              </div>
              <div className="space-y-2">
                {catalogBreakdown.byMediaType.map((entry) => {
                  const pct = catalogBreakdown.totalBytes > 0
                    ? (entry.totalBytes / catalogBreakdown.totalBytes) * 100
                    : 0;
                  return (
                    <div key={entry.mediaType} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                          {entry.mediaType}
                        </span>
                        <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                          {formatBytes(entry.totalBytes)} / {entry.fileCount.toLocaleString()} files
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--color-ah-bg-overlay)] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: getDeptColor(entry.mediaType),
                            opacity: 0.8,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Orphan badge */}
              {orphanFiles.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--color-ah-border-muted)] flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", color: "var(--color-ah-danger)" }}
                  >
                    {orphanFiles.length} orphan{orphanFiles.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[10px] text-[var(--color-ah-text-subtle)]">
                    {formatBytes(orphanFiles.reduce((sum, f) => sum + f.sizeBytes, 0))} reclaimable
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-[var(--color-ah-text-subtle)]">VAST Catalog not configured</p>
              <p className="text-xs text-[var(--color-ah-text-subtle)] mt-1">
                Enable VAST Catalog on your cluster to see actual disk usage
              </p>
            </div>
          )}
        </DashboardCard>

        {/* Panel 5: Storage Health (C.10) */}
        <DashboardCard title="Storage Health">
          <div className="space-y-4">
            {/* Orphan indicator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrafficLight level={orphanFiles.length === 0 ? "green" : orphanFiles.length <= 5 ? "yellow" : "red"} />
                <span className="text-sm font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">Orphan Files</span>
              </div>
              <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                {orphanFiles.length} file{orphanFiles.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Orphan total bytes */}
            {orphanFiles.length > 0 && (
              <div className="pl-5 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--color-ah-text-muted)]">Total orphan storage</span>
                  <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-danger)]">
                    {formatBytes(orphanFiles.reduce((sum, f) => sum + f.sizeBytes, 0))}
                  </span>
                </div>
                {orphanFiles.slice(0, 3).map((f) => (
                  <div key={f.elementHandle} className="flex items-center gap-2 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ah-danger)] shrink-0" />
                    <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)] truncate flex-1">
                      {f.path}
                    </span>
                    <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] shrink-0">
                      {formatBytes(f.sizeBytes)}
                    </span>
                  </div>
                ))}
                {orphanFiles.length > 3 && (
                  <span className="text-[10px] text-[var(--color-ah-text-subtle)] pl-3">
                    +{orphanFiles.length - 3} more orphan files
                  </span>
                )}
              </div>
            )}

            {/* Catalog vs App comparison */}
            {catalogBreakdown && forecast && (
              <div className="pt-3 border-t border-[var(--color-ah-border-muted)]">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--color-ah-text-muted)]">Catalog (actual disk)</span>
                  <span className="font-[var(--font-ah-mono)]">{formatBytes(catalogBreakdown.totalBytes)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--color-ah-text-muted)]">App-tracked</span>
                  <span className="font-[var(--font-ah-mono)]">{formatBytes(forecast.currentStorageBytes)}</span>
                </div>
                {catalogBreakdown.totalBytes > 0 && forecast.currentStorageBytes > 0 && (
                  <div className="flex justify-between text-xs mt-1 pt-1 border-t border-[var(--color-ah-border-muted)]">
                    <span className="text-[var(--color-ah-text-muted)]">Discrepancy</span>
                    <span className="font-[var(--font-ah-mono)]" style={{
                      color: Math.abs(catalogBreakdown.totalBytes - forecast.currentStorageBytes) / forecast.currentStorageBytes > 0.1
                        ? "var(--color-ah-warning)"
                        : "var(--color-ah-success)",
                    }}>
                      {formatBytes(Math.abs(catalogBreakdown.totalBytes - forecast.currentStorageBytes))}
                    </span>
                  </div>
                )}
              </div>
            )}

            {orphanFiles.length === 0 && !catalogBreakdown && (
              <p className="text-xs text-[var(--color-ah-text-subtle)]">
                VAST Catalog not configured. Enable it to detect orphan files and storage discrepancies.
              </p>
            )}
          </div>
        </DashboardCard>

        {/* Panel 6: Bottleneck Indicators */}
        <DashboardCard title="Bottleneck Indicators (7-day rolling)">
          {bottlenecks.length > 0 ? (
            <>
              <div className="space-y-3">
                {bottlenecks.map((b) => (
                  <div
                    key={b.stage}
                    className="flex items-center justify-between py-1.5 border-b border-[var(--color-ah-border-muted)] last:border-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <TrafficLight level={b.level} />
                      <span className="text-sm font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">
                        {b.stage}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                        {formatDuration(b.currentMedianSeconds)} median
                      </span>
                      <span
                        className="text-xs font-bold font-[var(--font-ah-mono)]"
                        style={{
                          color:
                            b.level === "red"
                              ? "var(--color-ah-danger)"
                              : b.level === "yellow"
                                ? "var(--color-ah-warning)"
                                : "var(--color-ah-success)",
                        }}
                      >
                        {b.percentChange > 0 ? "+" : ""}
                        {b.percentChange.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                Stages flagged red have median processing time increase &gt;20% week-over-week
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)]">No bottleneck data available</p>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
