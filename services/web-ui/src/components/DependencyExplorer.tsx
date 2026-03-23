import { useEffect, useState } from "react";

import {
  fetchVersionDependencies,
  fetchVersionImpactAnalysis,
  type AssetDependencyData,
  type ImpactAnalysisData,
} from "../api";
import { Badge } from "../design-system";

/* ── Color mapping by dependency type ── */

type DepCategory = "material" | "texture" | "cache" | "geo" | "render" | "other";

const DEP_TYPE_CATEGORY: Record<string, DepCategory> = {
  uses_material: "material",
  references_texture: "texture",
  uses_simulation: "cache",
  in_shot: "geo",
  derived_from_plate: "render",
  conform_source: "render",
};

const CATEGORY_COLORS: Record<DepCategory, { bg: string; text: string; border: string; label: string }> = {
  material: {
    bg: "var(--color-ah-purple)",
    text: "var(--color-ah-purple)",
    border: "var(--color-ah-purple)",
    label: "Material",
  },
  texture: {
    bg: "var(--color-ah-accent)",
    text: "var(--color-ah-accent)",
    border: "var(--color-ah-accent-muted)",
    label: "Texture",
  },
  cache: {
    bg: "var(--color-ah-warning)",
    text: "var(--color-ah-warning)",
    border: "var(--color-ah-warning-muted)",
    label: "Cache",
  },
  geo: {
    bg: "var(--color-ah-success)",
    text: "var(--color-ah-success)",
    border: "var(--color-ah-success-muted)",
    label: "Geometry",
  },
  render: {
    bg: "var(--color-ah-info)",
    text: "var(--color-ah-info)",
    border: "var(--color-ah-accent-muted)",
    label: "Render",
  },
  other: {
    bg: "var(--color-ah-text-subtle)",
    text: "var(--color-ah-text-muted)",
    border: "var(--color-ah-border)",
    label: "Other",
  },
};

function getCategory(depType: string): DepCategory {
  return DEP_TYPE_CATEGORY[depType] ?? "other";
}

/* ── Dependency tree node ── */

function DependencyNode({ dep, direction }: { dep: AssetDependencyData; direction: "upstream" | "downstream" }) {
  const category = getCategory(dep.dependencyType);
  const colors = CATEGORY_COLORS[category];
  const entityId = direction === "upstream" ? dep.targetEntityId : dep.sourceEntityId;
  const entityType = direction === "upstream" ? dep.targetEntityType : dep.sourceEntityType;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-[var(--radius-ah-md)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: colors.bg }}
      />
      <Badge
        variant={
          category === "material" ? "purple" :
          category === "texture" ? "info" :
          category === "cache" ? "warning" :
          category === "geo" ? "success" :
          category === "render" ? "info" :
          "default"
        }
      >
        {colors.label}
      </Badge>
      <span className="text-sm truncate font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
        {entityId}
      </span>
      <span className="text-[10px] text-[var(--color-ah-text-subtle)] ml-auto shrink-0">
        {entityType}
      </span>
      {dep.dependencyStrength !== "hard" && (
        <Badge variant="warning">{dep.dependencyStrength}</Badge>
      )}
    </div>
  );
}

/* ── Impact badge for downstream panel ── */

function ImpactBadge({ shotCount }: { shotCount: number }) {
  if (shotCount === 0) return null;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-ah-md)] border text-sm"
      style={{
        backgroundColor: "rgba(var(--color-ah-warning), 0.08)",
        borderColor: "var(--color-ah-warning-muted)",
      }}
    >
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
        style={{
          backgroundColor: "var(--color-ah-warning-muted)",
          color: "var(--color-ah-warning)",
        }}
      >
        {shotCount}
      </span>
      <span className="text-[var(--color-ah-warning)]">
        Used in {shotCount} shot{shotCount !== 1 ? "s" : ""} — updating will trigger re-render
      </span>
    </div>
  );
}

/* ── Main component ── */

interface DependencyExplorerProps {
  versionId: string;
  className?: string;
}

export function DependencyExplorer({ versionId, className = "" }: DependencyExplorerProps) {
  const [upstream, setUpstream] = useState<AssetDependencyData[]>([]);
  const [impact, setImpact] = useState<ImpactAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<"upstream" | "downstream">("upstream");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchVersionDependencies(versionId),
      fetchVersionImpactAnalysis(versionId),
    ]).then(([deps, impactData]) => {
      if (cancelled) return;
      setUpstream(deps);
      setImpact(impactData);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [versionId]);

  const downstream = impact?.reverseDependencies ?? [];
  const affectedShotCount = impact?.affectedShotCount ?? 0;

  return (
    <div className={`grid gap-3 ${className}`} data-testid="dependency-explorer">
      {/* Panel tabs */}
      <div className="flex border-b border-[var(--color-ah-border)]">
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors border-b-2 ${
            activePanel === "upstream"
              ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
              : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          }`}
          onClick={() => setActivePanel("upstream")}
        >
          Upstream ({upstream.length})
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors border-b-2 ${
            activePanel === "downstream"
              ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
              : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          }`}
          onClick={() => setActivePanel("downstream")}
        >
          Downstream ({downstream.length})
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center text-sm text-[var(--color-ah-text-subtle)]">
          <div className="w-4 h-4 border-2 border-[var(--color-ah-accent)] border-t-transparent rounded-full animate-spin" />
          Loading dependencies...
        </div>
      ) : (
        <>
          {activePanel === "upstream" && (
            <div className="grid gap-1" data-testid="upstream-panel">
              {upstream.length === 0 ? (
                <p className="text-sm text-[var(--color-ah-text-subtle)] py-2">No dependency data. Select an asset to view its dependency graph.</p>
              ) : (
                upstream.map((dep) => (
                  <DependencyNode key={dep.id} dep={dep} direction="upstream" />
                ))
              )}
            </div>
          )}

          {activePanel === "downstream" && (
            <div className="grid gap-2" data-testid="downstream-panel">
              <ImpactBadge shotCount={affectedShotCount} />
              {downstream.length === 0 ? (
                <p className="text-sm text-[var(--color-ah-text-subtle)] py-2">No downstream dependents found.</p>
              ) : (
                <div className="grid gap-1">
                  {downstream.map((dep) => (
                    <DependencyNode key={dep.id} dep={dep} direction="downstream" />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--color-ah-border-muted)]">
        {Object.entries(CATEGORY_COLORS).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5 text-[10px] text-[var(--color-ah-text-subtle)]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: val.bg }} />
            {val.label}
          </div>
        ))}
      </div>
    </div>
  );
}
