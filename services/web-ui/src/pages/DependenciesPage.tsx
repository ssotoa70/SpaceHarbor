import { useState } from "react";
import { useParams } from "react-router-dom";

import { DependencyExplorer } from "../components/DependencyExplorer";
import { DependencyImpactView } from "../components/DependencyImpactView";

/* ── Tab type ── */

type Tab = "explorer" | "impact";

/* ── Tab button ── */

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors border-b-2 ${
        active
          ? "border-[var(--color-ah-accent)] text-[var(--color-ah-accent)]"
          : "border-transparent text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
      }`}
      aria-selected={active}
      role="tab"
    >
      {label}
    </button>
  );
}

/* ── Page ── */

export function DependenciesPage() {
  const { versionId } = useParams<{ versionId?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("explorer");

  return (
    <div data-testid="dependencies-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">Dependencies</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Explore asset dependency graphs and analyze downstream impact
          </p>
        </div>
      </div>

      {!versionId ? (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] p-10 text-center">
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Select an asset to view its dependency graph.
          </p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div
            className="flex border-b border-[var(--color-ah-border)] mb-5"
            role="tablist"
            aria-label="Dependency views"
          >
            <TabButton
              label="Explorer"
              active={activeTab === "explorer"}
              onClick={() => setActiveTab("explorer")}
            />
            <TabButton
              label="Impact Analysis"
              active={activeTab === "impact"}
              onClick={() => setActiveTab("impact")}
            />
          </div>

          {/* Panel content */}
          {activeTab === "explorer" && (
            <div
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] p-5"
              role="tabpanel"
              aria-label="Explorer"
            >
              <DependencyExplorer versionId={versionId} />
            </div>
          )}

          {activeTab === "impact" && (
            <div
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] p-5"
              role="tabpanel"
              aria-label="Impact Analysis"
            >
              <DependencyImpactView versionId={versionId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
