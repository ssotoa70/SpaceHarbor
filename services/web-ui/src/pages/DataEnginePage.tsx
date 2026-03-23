import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card } from "../design-system";
import { PermissionGate } from "../components/PermissionGate";
import {
  fetchDataEngineFunctions,
  fetchDataEnginePipelines,
  type DataEngineFunction,
  type DataEnginePipeline,
  type DataEnginePipelineStep,
} from "../api";

/* ── Helpers ── */

const CATEGORIES = [
  "VFX PROCESSING",
  "COLOR & GRADE",
  "EDITORIAL",
  "METADATA & PROVENANCE",
  "DELIVERY & NOTIFICATION",
];

type TriggerFilter = "on:ingest" | "on:tag" | "schedule";

function triggerBadgeVariant(trigger: string) {
  switch (trigger) {
    case "on:ingest": return "info" as const;
    case "on:tag": return "purple" as const;
    case "schedule": return "orange" as const;
    default: return "default" as const;
  }
}

function runtimeBadgeVariant(runtime: string) {
  return runtime === "C++" ? "warning" as const : "default" as const;
}

function stepStatusVariant(status: DataEnginePipelineStep["status"]) {
  switch (status) {
    case "done": return "success" as const;
    case "running": return "warning" as const;
    case "error": return "danger" as const;
    case "queued": return "default" as const;
  }
}

/* ── Function Library Card ── */

function FunctionCard({
  fn,
  isSelected,
  onSelect,
  onAdd,
}: {
  fn: DataEngineFunction;
  isSelected: boolean;
  onSelect: () => void;
  onAdd: () => void;
}) {
  return (
    <Card
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
        isSelected
          ? "ring-1 ring-[var(--color-ah-accent)] bg-[var(--color-ah-accent)]/5"
          : "hover:bg-[var(--color-ah-bg-overlay)]"
      }`}
      onClick={onSelect}
      role="listitem"
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold block truncate">{fn.name}</span>
        <span className="text-xs text-[var(--color-ah-text-muted)] line-clamp-1">
          {fn.description}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant={runtimeBadgeVariant(fn.runtime)}>{fn.runtime}</Badge>
        <Badge variant={triggerBadgeVariant(fn.triggerType)}>{fn.triggerType}</Badge>
      </div>
      <Button
        variant="ghost"
        className="shrink-0 text-lg leading-none px-1.5 py-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        aria-label={`Add ${fn.name} to pipeline`}
      >
        +
      </Button>
    </Card>
  );
}

/* ── Pipeline Step Card ── */

function PipelineStepCard({
  step,
  onRemove,
}: {
  step: DataEnginePipelineStep;
  onRemove: () => void;
}) {
  const paramEntries = Object.entries(step.params);
  return (
    <Card className="px-4 py-3" role="listitem">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-[var(--color-ah-bg-overlay)] flex items-center justify-center text-xs font-bold text-[var(--color-ah-text-muted)] shrink-0">
          {step.order}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold">{step.name}</span>
          </div>
          <p className="text-xs text-[var(--color-ah-text-muted)] mb-1.5">
            {step.description}
          </p>
          {paramEntries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {paramEntries.map(([k, v]) => (
                <span
                  key={k}
                  className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)]"
                >
                  {k}={v}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={stepStatusVariant(step.status)}>
            {step.status === "running" ? (
              <span className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                running
              </span>
            ) : (
              step.status
            )}
          </Badge>
          <button
            className="text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-danger)] text-sm leading-none px-1"
            onClick={onRemove}
            aria-label={`Remove ${step.name}`}
          >
            &times;
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ── Connector Arrow ── */

function Connector() {
  return (
    <div className="flex justify-center py-0.5">
      <div className="w-px h-5 bg-[var(--color-ah-border)] relative">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-[var(--color-ah-border)]" />
      </div>
    </div>
  );
}

/* ── Loading Skeleton ── */

function FunctionLibrarySkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      {[1, 2, 3].map((group) => (
        <div key={group}>
          <div className="h-3 bg-[var(--color-ah-bg-overlay)] rounded w-32 mb-3" />
          <div className="space-y-1.5">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-12 bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main Content ── */

function DataEngineContent() {
  const [functions, setFunctions] = useState<DataEngineFunction[]>([]);
  const [pipeline, setPipeline] = useState<DataEnginePipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFn, setSelectedFn] = useState<string | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("on:ingest");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fns, pipelines] = await Promise.all([
        fetchDataEngineFunctions(),
        fetchDataEnginePipelines(),
      ]);
      setFunctions(fns);
      setPipeline(pipelines[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DataEngine data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: functions.filter((f) => f.category === cat),
  }));

  const handleAddToPipeline = (fn: DataEngineFunction) => {
    if (!pipeline) return;
    const nextOrder = pipeline.steps.length + 1;
    const newStep: DataEnginePipelineStep = {
      id: `s-${Date.now()}`,
      functionId: fn.id,
      name: fn.name,
      description: fn.description,
      status: "queued",
      params: {},
      order: nextOrder,
    };
    setPipeline((p) => p ? { ...p, steps: [...p.steps, newStep] } : p);
  };

  const handleRemoveStep = (stepId: string) => {
    setPipeline((p) =>
      p
        ? {
            ...p,
            steps: p.steps
              .filter((s) => s.id !== stepId)
              .map((s, i) => ({ ...s, order: i + 1 })),
          }
        : p,
    );
  };

  const TRIGGER_OPTIONS: TriggerFilter[] = ["on:ingest", "on:tag", "schedule"];

  /* ── Error state ── */
  if (error) {
    return (
      <section aria-label="DataEngine functions" className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-[var(--color-ah-danger-muted)]/20 border border-[var(--color-ah-danger-muted)] rounded-[var(--radius-ah-lg)] p-5 text-[var(--color-ah-danger)]">
            <p className="font-medium">Failed to load DataEngine data</p>
            <p className="text-sm mt-1">{error}</p>
            <Button variant="secondary" className="mt-3" onClick={() => void loadData()}>
              Retry
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="DataEngine functions"
      className="flex h-full min-h-0"
    >
      {/* ── Left Panel: Function Library ── */}
      <div className="w-[40%] shrink-0 border-r border-[var(--color-ah-border)] overflow-y-auto p-5">
        <header className="mb-5">
          <h1 className="text-xl font-semibold">Function Library</h1>
          <p className="text-[10px] font-semibold tracking-widest text-[var(--color-ah-text-muted)] uppercase mt-1">
            Serverless Plugins &middot; Modular Pipeline
          </p>
        </header>

        {loading ? (
          <FunctionLibrarySkeleton />
        ) : functions.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-[var(--color-ah-text-muted)]">
              No DataEngine functions registered
            </p>
            <p className="text-xs text-[var(--color-ah-text-muted)] mt-1 max-w-xs mx-auto">
              Functions will appear here when registered in the control-plane
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ category, items }) =>
              items.length === 0 ? null : (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold tracking-widest text-[var(--color-ah-text-muted)] uppercase whitespace-nowrap">
                      {category}
                    </span>
                    <hr className="flex-1 border-[var(--color-ah-border)]" />
                    <Badge variant="default">{items.length}</Badge>
                  </div>
                  <div className="space-y-1.5" role="list" aria-label={category}>
                    {items.map((fn) => (
                      <FunctionCard
                        key={fn.id}
                        fn={fn}
                        isSelected={selectedFn === fn.id}
                        onSelect={() =>
                          setSelectedFn((prev) =>
                            prev === fn.id ? null : fn.id,
                          )
                        }
                        onAdd={() => handleAddToPipeline(fn)}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* ── Right Panel: Pipeline View ── */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-[var(--color-ah-bg-overlay)] rounded w-48" />
            <div className="h-14 bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)]" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-[var(--color-ah-bg-overlay)] rounded-[var(--radius-ah-md)]" />
            ))}
          </div>
        ) : pipeline === null ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-[var(--color-ah-text-muted)]">
              No DataEngine functions registered
            </p>
            <p className="text-xs text-[var(--color-ah-text-muted)] mt-1 max-w-xs mx-auto">
              Functions will appear here when registered in the control-plane
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-xl font-semibold">{pipeline.name}</h2>
                <p className="text-[10px] font-semibold tracking-widest text-[var(--color-ah-text-muted)] uppercase mt-1">
                  {pipeline.description}
                </p>
              </div>
              <div className="flex gap-1.5 items-center">
                {TRIGGER_OPTIONS.map((t) => (
                  <Button
                    key={t}
                    variant={triggerFilter === t ? "primary" : "ghost"}
                    className="text-xs px-2.5 py-1"
                    onClick={() => setTriggerFilter(t)}
                  >
                    {t}
                  </Button>
                ))}
                <span title="Manual trigger not yet available">
                  <Button
                    variant="ghost"
                    className="text-xs px-2.5 py-1 opacity-40 cursor-not-allowed"
                    disabled
                  >
                    Run
                  </Button>
                </span>
              </div>
            </header>

            {/* Trigger Event Card */}
            <Card className="bg-[var(--color-ah-accent)]/10 border-[var(--color-ah-accent)]/30 px-4 py-3 mb-1">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-[var(--color-ah-accent)]/20 flex items-center justify-center text-[var(--color-ah-accent)] text-sm">
                  &darr;
                </div>
                <div>
                  <span className="text-sm font-semibold block">File Write Event</span>
                  <span className="text-xs text-[var(--color-ah-text-muted)] font-mono">
                    {pipeline.triggerPath} &middot; VAST Event Broker
                  </span>
                </div>
              </div>
            </Card>

            {/* Pipeline Steps */}
            <div role="list" aria-label="Pipeline steps">
              {pipeline.steps.map((step) => (
                <div key={step.id}>
                  <Connector />
                  <PipelineStepCard
                    step={step}
                    onRemove={() => handleRemoveStep(step.id)}
                  />
                </div>
              ))}
            </div>

            {pipeline.steps.length === 0 && (
              <p className="text-sm text-[var(--color-ah-text-muted)] text-center py-12">
                No steps in pipeline. Use the + button in the Function Library to add steps.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function DataEnginePage() {
  return (
    <PermissionGate
      permission="admin:system_config"
      fallback={
        <section aria-label="DataEngine functions" className="p-6 max-w-5xl mx-auto">
          <Card>
            <p className="text-sm text-[var(--color-ah-text-muted)] py-8 text-center">
              You do not have permission to manage DataEngine functions.
            </p>
          </Card>
        </section>
      }
    >
      <DataEngineContent />
    </PermissionGate>
  );
}
