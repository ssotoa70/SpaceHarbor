import { useCallback, useEffect, useState, Suspense, lazy } from "react";

import { Card, Skeleton } from "../design-system";
import { PermissionGate } from "../components/PermissionGate";
import { fetchPlatformSettings } from "../api";
import { ConnectionBanner } from "./dataengine/ConnectionBanner";

/* ── Lazy-loaded tab panels ── */

const DashboardTab = lazy(() =>
  import("./dataengine/DashboardTab").then((m) => ({ default: m.DashboardTab })),
);
const FunctionsTab = lazy(() =>
  import("./dataengine/FunctionsTab").then((m) => ({ default: m.FunctionsTab })),
);
const TriggersTab = lazy(() =>
  import("./dataengine/TriggersTab").then((m) => ({ default: m.TriggersTab })),
);
const PipelinesTab = lazy(() =>
  import("./dataengine/PipelinesTab").then((m) => ({ default: m.PipelinesTab })),
);
const TelemetryTab = lazy(() =>
  import("./dataengine/TelemetryTab").then((m) => ({ default: m.TelemetryTab })),
);

/* ── Tab definitions ── */

type DataEngineTab = "dashboard" | "functions" | "triggers" | "pipelines" | "telemetry";

const TABS: { key: DataEngineTab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "functions", label: "Functions" },
  { key: "triggers", label: "Triggers" },
  { key: "pipelines", label: "Pipelines" },
  { key: "telemetry", label: "Telemetry" },
];

/* ── Loading skeleton for tab panels ── */

function TabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse p-1">
      <div className="h-6 bg-[var(--color-ah-bg-overlay)] rounded w-48" />
      <div className="h-10 bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)]" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)]" />
      ))}
    </div>
  );
}

/* ── Main content ── */

function DataEngineContent() {
  const [tab, setTab] = useState<DataEngineTab>("dashboard");
  const [connected, setConnected] = useState<boolean | null>(null); // null = checking
  const [checkError, setCheckError] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    setConnected(null);
    setCheckError(null);
    try {
      const settings = await fetchPlatformSettings();
      const de = settings.vastDataEngine;
      // Connected if URL is configured AND VMS credentials are stored
      setConnected(de.configured && de.hasPassword === true);
    } catch (err) {
      // If we can't fetch settings (e.g. no auth), assume connected and let proxy routes fail gracefully
      setCheckError(err instanceof Error ? err.message : "Failed to check DataEngine connection");
      setConnected(true);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  // Still checking connection status
  if (connected === null) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  // Not configured — show banner
  if (!connected && !checkError) {
    return <ConnectionBanner />;
  }

  return (
    <section aria-label="DataEngine management" className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--color-ah-border-muted)] px-5 pt-4 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
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
      <div className="flex-1 overflow-y-auto p-5">
        <Suspense fallback={<TabSkeleton />}>
          {tab === "dashboard" && <DashboardTab />}
          {tab === "functions" && <FunctionsTab />}
          {tab === "triggers" && <TriggersTab />}
          {tab === "pipelines" && <PipelinesTab />}
          {tab === "telemetry" && <TelemetryTab />}
        </Suspense>
      </div>
    </section>
  );
}

export function DataEnginePage() {
  return (
    <PermissionGate
      permission="admin:system_config"
      fallback={
        <section aria-label="DataEngine" className="p-6 max-w-5xl mx-auto">
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              You do not have permission to manage DataEngine.
            </p>
          </Card>
        </section>
      }
    >
      <DataEngineContent />
    </PermissionGate>
  );
}
