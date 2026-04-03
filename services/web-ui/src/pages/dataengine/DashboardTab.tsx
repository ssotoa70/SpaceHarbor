import { useState, useEffect, useCallback, useRef } from "react";

import { Button, Skeleton } from "../../design-system";
import {
  DashboardCard,
  StatCard,
  LineChart,
  VerticalBarChart,
} from "../../components/charts";
import {
  fetchDashboardStats,
  fetchDashboardEventsStats,
  fetchDashboardExecutionTime,
} from "../../api/dataengine-proxy";
import type {
  DashboardStats,
  DashboardEventsStats,
  DashboardExecutionTime,
} from "../../types/dataengine";

const REFRESH_INTERVAL = 300; // 5 minutes in seconds

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── Loading skeleton ── */

function DashboardSkeleton() {
  return (
    <div className="space-y-6" data-testid="dashboard-skeleton">
      {/* Stats row skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height="4.5rem" />
        ))}
      </div>
      {/* Charts row skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Skeleton height="280px" />
        <Skeleton height="280px" />
      </div>
    </div>
  );
}

/* ── Error state ── */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="max-w-md w-full">
        <div className="bg-[var(--color-ah-danger)]/10 border border-[var(--color-ah-danger)]/30 rounded-[var(--radius-ah-md)] p-5 text-center">
          <p className="text-sm font-medium text-[var(--color-ah-danger)]">
            Failed to load dashboard data
          </p>
          <p className="text-xs text-[var(--color-ah-text-muted)] mt-1">{message}</p>
          <Button variant="secondary" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */

export function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [eventsStats, setEventsStats] = useState<DashboardEventsStats | null>(null);
  const [executionTime, setExecutionTime] = useState<DashboardExecutionTime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statsResult, eventsResult, execResult] = await Promise.allSettled([
      fetchDashboardStats(),
      fetchDashboardEventsStats(),
      fetchDashboardExecutionTime(),
    ]);

    // If all three failed, show error
    if (
      statsResult.status === "rejected" &&
      eventsResult.status === "rejected" &&
      execResult.status === "rejected"
    ) {
      const reason =
        statsResult.reason instanceof Error
          ? statsResult.reason.message
          : "Unable to reach DataEngine API";
      setError(reason);
      setLoading(false);
      setCountdown(REFRESH_INTERVAL);
      return;
    }

    setStats(statsResult.status === "fulfilled" ? statsResult.value : null);
    setEventsStats(eventsResult.status === "fulfilled" ? eventsResult.value : null);
    setExecutionTime(execResult.status === "fulfilled" ? execResult.value : null);
    setLoading(false);
    setCountdown(REFRESH_INTERVAL);
  }, []);

  // Initial load
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-refresh countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void loadData();
          return REFRESH_INTERVAL;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loadData]);

  const handleRefresh = () => {
    setCountdown(REFRESH_INTERVAL);
    void loadData();
  };

  // Pure loading state (no data yet)
  if (loading && !stats && !eventsStats && !executionTime) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">
            DataEngine Overview
          </h2>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">
            DataEngine Overview
          </h2>
        </div>
        <ErrorState message={error} onRetry={handleRefresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-[var(--font-ah-display)] font-semibold tracking-tight">
          DataEngine Overview
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
            Refresh in {formatCountdown(countdown)}
          </span>
          <Button variant="secondary" className="text-xs" onClick={handleRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Functions" value={String(stats?.functions_count ?? 0)} />
        <StatCard label="Triggers" value={String(stats?.triggers_count ?? 0)} />
        <StatCard label="Pipelines Total" value={String(stats?.pipelines_count ?? 0)} />
        <StatCard label="Pipelines Active" value={String(stats?.active_pipelines ?? 0)} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DashboardCard title="Events & Failures">
          {eventsStats && eventsStats.events.length > 0 ? (
            <LineChart
              series={[
                {
                  label: "Events",
                  data: eventsStats.events,
                  color: "var(--color-ah-accent)",
                },
                {
                  label: "Failures",
                  data: eventsStats.failures,
                  color: "var(--color-ah-danger)",
                },
              ]}
              height={200}
            />
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)] text-center py-8">
              No event data available
            </p>
          )}
        </DashboardCard>

        <DashboardCard title="Avg Function Duration">
          {executionTime && executionTime.labels.length > 0 ? (
            <VerticalBarChart
              data={executionTime.labels.map((label, i) => ({
                label,
                value: executionTime.avg_duration_ms[i],
                color: "var(--color-ah-accent)",
              }))}
            />
          ) : (
            <p className="text-sm text-[var(--color-ah-text-subtle)] text-center py-8">
              No execution data available
            </p>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
