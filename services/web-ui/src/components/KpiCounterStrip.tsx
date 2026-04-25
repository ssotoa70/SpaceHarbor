import React from "react";
import { useAssetStats } from "../hooks/useAssetStats";

export function KpiCounterStrip(): JSX.Element {
  const stats = useAssetStats();

  const counters = (() => {
    if (stats.status === "ready") {
      const s = stats.data;
      const inPipeline = (s.byStatus.pending ?? 0) + (s.byStatus.in_pipeline ?? 0);
      return {
        total: s.total,
        inPipeline,
        processed: s.byStatus.processed ?? 0,
        hashed: s.integrity.hashed,
        withKeyframes: s.integrity.with_keyframes,
      };
    }
    return null;
  })();

  return (
    <div className="flex gap-4 px-4 py-3 border-b border-slate-800 bg-slate-900">
      <Counter label="Total" value={counters?.total} loading={stats.status === "loading"} />
      <Counter label="In pipeline" value={counters?.inPipeline} loading={stats.status === "loading"} />
      <Counter label="Processed" value={counters?.processed} loading={stats.status === "loading"} />
      <Counter label="With hashes" value={counters?.hashed} loading={stats.status === "loading"} />
      <Counter label="With keyframes" value={counters?.withKeyframes} loading={stats.status === "loading"} />
      {stats.status === "error" && <span title={stats.error} className="text-amber-500 ml-2">⚠</span>}
    </div>
  );
}

function Counter({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }): JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-col" data-testid="kpi-skeleton">
        <div className="h-6 w-16 bg-slate-800 rounded animate-pulse" />
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <div className="text-2xl font-semibold text-slate-100">{value === undefined ? "—" : value.toLocaleString()}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
