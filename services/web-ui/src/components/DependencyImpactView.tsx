import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchVersionImpactAnalysis,
  type ImpactAnalysisData,
  type ShotAssetUsageData,
} from "../api";
import { Badge, Button } from "../design-system";

/* ── Types for the affected-shots table ── */

interface AffectedShot {
  shotId: string;
  usageType: string;
  layerName: string | null;
  renderStatus: "pending" | "rendering" | "complete" | "stale";
  estimatedTime: string;
  artist: string;
}

type SortKey = "shotId" | "renderStatus" | "estimatedTime" | "artist";
type SortDir = "asc" | "desc";

/* ── Map API shot usage to table rows ── */

function mapShotUsage(usage: ShotAssetUsageData[]): AffectedShot[] {
  const seen = new Set<string>();
  const result: AffectedShot[] = [];

  for (const u of usage) {
    if (seen.has(u.shotId)) continue;
    seen.add(u.shotId);
    result.push({
      shotId: u.shotId,
      usageType: u.usageType,
      layerName: u.layerName,
      renderStatus: "pending",
      estimatedTime: "-",
      artist: "-",
    });
  }

  return result;
}

/* ── Status badge helpers ── */

const renderStatusVariant = (s: AffectedShot["renderStatus"]) => {
  if (s === "complete") return "success" as const;
  if (s === "stale") return "warning" as const;
  if (s === "rendering") return "info" as const;
  return "default" as const;
};

/* ── Main component ── */

interface DependencyImpactViewProps {
  versionId: string;
  assetTitle?: string;
  className?: string;
}

export function DependencyImpactView({ versionId, assetTitle, className = "" }: DependencyImpactViewProps) {
  const [impact, setImpact] = useState<ImpactAnalysisData | null>(null);
  const [shots, setShots] = useState<AffectedShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("shotId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchVersionImpactAnalysis(versionId).then((data) => {
      if (cancelled) return;
      setImpact(data);
      setShots(data ? mapShotUsage(data.shotUsage) : []);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [versionId]);

  const affectedCount = impact?.affectedShotCount ?? 0;

  const sorted = useMemo(() => {
    const copy = [...shots];
    copy.sort((a, b) => {
      const aVal = a[sortKey] ?? "";
      const bVal = b[sortKey] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [shots, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const handleNotify = useCallback(() => {
    setNotifying(true);
    // Simulate notification dispatch
    setTimeout(() => {
      setNotifying(false);
      setNotified(true);
    }, 800);
  }, []);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  return (
    <div className={`grid gap-4 ${className}`} data-testid="dependency-impact-view">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ah-text)]">Impact Analysis</h3>
          {assetTitle && (
            <p className="text-sm text-[var(--color-ah-text-muted)] mt-0.5">
              {assetTitle}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          onClick={handleNotify}
          disabled={notifying || notified}
        >
          {notified ? "Coordinator Notified" : notifying ? "Sending..." : "Notify Coordinator"}
        </Button>
      </div>

      {/* Impact summary banner */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-ah-md)] border"
        style={{
          backgroundColor: "rgba(245, 158, 11, 0.06)",
          borderColor: "var(--color-ah-warning-muted)",
        }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{
            backgroundColor: "var(--color-ah-warning-muted)",
            color: "var(--color-ah-warning)",
          }}
        >
          {affectedCount}
        </span>
        <div>
          <p className="text-sm font-medium text-[var(--color-ah-warning)]">
            If this asset is updated, {affectedCount} shot{affectedCount !== 1 ? "s" : ""} will need to re-render
          </p>
          <p className="text-xs text-[var(--color-ah-text-subtle)] mt-0.5">
            Review the affected shots below before making changes
          </p>
        </div>
      </div>

      {/* Affected shots table */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-sm text-[var(--color-ah-text-subtle)]">
          <div className="w-4 h-4 border-2 border-[var(--color-ah-accent)] border-t-transparent rounded-full animate-spin" />
          Analyzing impact...
        </div>
      ) : (
        <div className="border border-[var(--color-ah-border)] rounded-[var(--radius-ah-md)] overflow-hidden">
          <table className="w-full text-sm" data-testid="affected-shots-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-raised)] text-[var(--color-ah-text-muted)] text-left">
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:text-[var(--color-ah-text)] transition-colors"
                  onClick={() => handleSort("shotId")}
                >
                  Shot ID{sortIndicator("shotId")}
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:text-[var(--color-ah-text)] transition-colors"
                  onClick={() => handleSort("renderStatus")}
                >
                  Render Status{sortIndicator("renderStatus")}
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:text-[var(--color-ah-text)] transition-colors"
                  onClick={() => handleSort("estimatedTime")}
                >
                  Est. Time{sortIndicator("estimatedTime")}
                </th>
                <th
                  className="px-3 py-2 font-medium cursor-pointer hover:text-[var(--color-ah-text)] transition-colors"
                  onClick={() => handleSort("artist")}
                >
                  Artist{sortIndicator("artist")}
                </th>
                <th className="px-3 py-2 font-medium">Usage</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((shot) => (
                <tr
                  key={shot.shotId}
                  className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                >
                  <td className="px-3 py-2 font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]">
                    {shot.shotId}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={renderStatusVariant(shot.renderStatus)}>
                      {shot.renderStatus}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                    {shot.estimatedTime}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ah-text-muted)]">
                    {shot.artist}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-[var(--color-ah-text-subtle)]">
                      {shot.usageType.replace(/_/g, " ")}
                      {shot.layerName ? ` (${shot.layerName})` : ""}
                    </span>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[var(--color-ah-text-subtle)]">
                    No impact analysis data. Run an impact analysis to see affected shots.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
