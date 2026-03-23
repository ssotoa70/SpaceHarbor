import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchMaterials, type MaterialData, type MaterialVersion, type TextureDep } from "../api";
import { Badge, Button, Card } from "../design-system";
import { DependencyExplorer } from "../components/DependencyExplorer";
import { extractVastPath } from "../utils/media-types";

const depTypeColors: Record<string, string> = {
  diffuse: "var(--color-ah-success)",
  normal: "var(--color-ah-accent)",
  roughness: "var(--color-ah-warning)",
  displacement: "var(--color-ah-danger)",
  other: "var(--color-ah-text-subtle)",
};

function DependencyTree({ deps }: { deps: TextureDep[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-sm font-semibold text-[var(--color-ah-text-muted)] cursor-pointer mb-1"
      >
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        Texture Dependencies ({deps.length})
      </button>
      {expanded && (
        <ul className="ml-4 grid gap-1">
          {deps.map((dep) => {
            const vastPath = dep.vastUri ? extractVastPath(dep.vastUri) : null;
            return (
              <li key={dep.path} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: depTypeColors[dep.type] ?? depTypeColors.other }} />
                <Badge variant="default">{dep.type}</Badge>
                <span className="font-mono text-xs truncate">{dep.path}</span>
                {vastPath && (
                  <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-accent)]/60 truncate">{vastPath}</span>
                )}
              </li>
            );
          })}
          {deps.length === 0 && <li className="text-xs text-[var(--color-ah-text-subtle)]">No dependencies</li>}
        </ul>
      )}
    </div>
  );
}

function WhereUsedPanel({ usages, onNavigateToShot }: { usages: MaterialData["usedBy"]; onNavigateToShot?: (shotId: string) => void }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-ah-text-muted)] mb-1">Where Used?</h3>
      {usages.length === 0 ? (
        <p className="text-xs text-[var(--color-ah-text-subtle)]">Not used in any shots.</p>
      ) : (
        <ul className="grid gap-1">
          {usages.map((u) => (
            <li key={`${u.shotId}-${u.versionLabel}`} className="flex items-center gap-2 text-sm">
              {onNavigateToShot ? (
                <button
                  type="button"
                  onClick={() => onNavigateToShot(u.shotId)}
                  className="cursor-pointer hover:underline"
                >
                  <Badge variant="info">{u.shotId}</Badge>
                </button>
              ) : (
                <Badge variant="info">{u.shotId}</Badge>
              )}
              <span className="text-[var(--color-ah-text-muted)]">{u.versionLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MaterialBrowser() {
  const [materials, setMaterials] = useState<MaterialData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialData | null>(null);
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);
  const [detailTab, setDetailTab] = useState<"textures" | "dependencies">("textures");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    void fetchMaterials().then((data) => {
      setMaterials(data);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const currentVersion = selectedMaterial?.versions[selectedVersionIdx] ?? null;

  const handleNavigateToShot = useCallback((shotId: string) => {
    navigate(`/hierarchy?shot=${encodeURIComponent(shotId)}`);
  }, [navigate]);

  return (
    <section aria-label="Material browser" className="flex gap-4">
      {/* Grid */}
      <div className="flex-1">
        <h1 className="text-xl font-bold mb-4">Materials</h1>
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-overlay)] animate-pulse"
              />
            ))}
          </div>
        ) : materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-4 opacity-40">&#9711;</div>
            <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No materials</h2>
            <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
              MaterialX definitions will appear here when ingested.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {materials.map((mat) => (
            <Card
              key={mat.id}
              className={`cursor-pointer transition-shadow hover:shadow-lg ${selectedMaterial?.id === mat.id ? "ring-2 ring-[var(--color-ah-accent)]" : ""}`}
              onClick={() => { setSelectedMaterial(mat); setSelectedVersionIdx(0); }}
            >
              <div className="h-24 rounded-[var(--radius-ah-sm)] mb-2 flex items-center justify-center" style={{ background: mat.versions[0]?.looks[0]?.previewColor ?? "var(--color-ah-bg)" }}>
                <span className="text-white/70 text-xs font-medium">{mat.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{mat.name}</span>
                <Badge variant="default">
                  {mat.versions.reduce((acc, v) => acc + v.looks.length, 0)} looks
                </Badge>
              </div>
            </Card>
          ))}
        </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedMaterial && (
        <Card className="w-80 shrink-0 overflow-auto max-h-[calc(100vh-8rem)]">
          <h2 className="text-lg font-semibold mb-2">{selectedMaterial.name}</h2>

          <div className="mb-3">
            <label className="text-sm font-medium text-[var(--color-ah-text-muted)]">Version</label>
            <select
              value={selectedVersionIdx}
              onChange={(e) => setSelectedVersionIdx(Number(e.target.value))}
              className="w-full mt-1 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm"
            >
              {selectedMaterial.versions.map((v, i) => (
                <option key={v.id} value={i}>{v.label}</option>
              ))}
            </select>
          </div>

          {currentVersion && (
            <>
              <h3 className="text-sm font-semibold text-[var(--color-ah-text-muted)] mb-2">Look Variants</h3>
              <div className="grid gap-2 mb-4">
                {currentVersion.looks.map((look) => (
                  <div key={look.name} className="flex items-center gap-2 p-2 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)]">
                    <span className="w-6 h-6 rounded-sm shrink-0" style={{ backgroundColor: look.previewColor }} />
                    <div>
                      <span className="text-sm font-medium">{look.name}</span>
                      <span className="text-xs text-[var(--color-ah-text-subtle)] ml-2">{look.renderContext}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tabbed section: Textures | Dependencies */}
              <div className="flex border-b border-[var(--color-ah-border)] mb-3">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors border-b-2 ${
                    detailTab === "textures"
                      ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
                      : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
                  }`}
                  onClick={() => setDetailTab("textures")}
                >
                  Textures
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors border-b-2 ${
                    detailTab === "dependencies"
                      ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
                      : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
                  }`}
                  onClick={() => setDetailTab("dependencies")}
                >
                  Dependencies
                </button>
              </div>

              {detailTab === "textures" ? (
                <DependencyTree deps={currentVersion.dependencies} />
              ) : (
                <DependencyExplorer versionId={currentVersion.id} />
              )}
            </>
          )}

          <div className="mt-4 pt-3 border-t border-[var(--color-ah-border)]">
            <WhereUsedPanel usages={selectedMaterial.usedBy} onNavigateToShot={handleNavigateToShot} />
          </div>
        </Card>
      )}
    </section>
  );
}
