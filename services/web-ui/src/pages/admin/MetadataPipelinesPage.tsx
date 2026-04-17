// services/web-ui/src/pages/admin/MetadataPipelinesPage.tsx
/**
 * Metadata Pipelines admin page (Phase 5.5).
 *
 * Edits the `dataEnginePipelines` platform setting — a 3-kind routing
 * table (image / video / raw_camera) that drives metadata extraction.
 * Shows live VAST function resolution status + a per-pipeline test-lookup
 * tool so operators can verify routing before saving.
 *
 * Backend contract:
 *   GET  /api/v1/dataengine/pipelines/active[?force=true]
 *   GET  /api/v1/dataengine/pipelines/defaults
 *   PUT  /api/v1/platform/settings { dataEnginePipelines: [...] }
 *   GET  /api/v1/metadata/lookup?path=&schema=&table=
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  fetchActiveDataEnginePipelines,
  fetchMetadataPipelineDefaults,
  saveMetadataPipelines,
  testMetadataLookup,
  type DataEnginePipelineConfig,
  type DiscoveredPipeline,
  type DiscoveredPipelineStatus,
  type MetadataLookupResult,
} from "../../api";

const ALL_KINDS = ["image", "video", "raw_camera"] as const;
type FileKind = (typeof ALL_KINDS)[number];

const KIND_LABEL: Record<FileKind, string> = {
  image: "Image",
  video: "Video",
  raw_camera: "Raw Camera",
};

interface StatusPillProps {
  status: DiscoveredPipelineStatus;
  detail?: string;
}

function StatusPill({ status, detail }: StatusPillProps) {
  const variant = status === "ok" ? "success" : status === "function-not-found" ? "warning" : "danger";
  const label = status === "ok" ? "OK" : status === "function-not-found" ? "Not found" : "Unreachable";
  return (
    <span title={detail ?? undefined}>
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}

export function MetadataPipelinesPage() {
  const [rows, setRows] = useState<DiscoveredPipeline[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const resp = await fetchActiveDataEnginePipelines({ force });
      setRows(resp.pipelines);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pipelines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const [seedFailed, setSeedFailed] = useState(false);

  const missingKinds = useMemo((): FileKind[] => {
    if (!rows) return [];
    const configured = new Set(rows.map((r) => r.config.fileKind));
    return ALL_KINDS.filter((k) => !configured.has(k));
  }, [rows]);

  const handleSeedDefaults = useCallback(async () => {
    try {
      const defaults = await fetchMetadataPipelineDefaults();
      await saveMetadataPipelines(defaults);
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed failed");
      setSeedFailed(true);
    }
  }, [load]);

  const handleSeedMissing = useCallback(async () => {
    if (!rows) return;
    try {
      const defaults = await fetchMetadataPipelineDefaults();
      const merged: DataEnginePipelineConfig[] = [
        ...rows.map((r) => r.config),
        ...defaults.filter((d) => missingKinds.includes(d.fileKind as FileKind)),
      ];
      await saveMetadataPipelines(merged);
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed missing failed");
      setSeedFailed(true);
    }
  }, [rows, missingKinds, load]);

  const handleToggle = useCallback(async (target: DiscoveredPipeline) => {
    if (!rows) return;
    const nextEnabled = !(target.config.enabled !== false);
    // Optimistic update
    const optimisticRows = rows.map((r) =>
      r.config.fileKind === target.config.fileKind
        ? { ...r, config: { ...r.config, enabled: nextEnabled } }
        : r,
    );
    setRows(optimisticRows);
    try {
      await saveMetadataPipelines(optimisticRows.map((r) => r.config));
      await load(true);
    } catch (e) {
      setRows(rows); // rollback
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, [rows, load]);

  const isEmpty = rows !== null && rows.length === 0;

  return (
    <section aria-label="Metadata Pipelines" className="flex flex-col h-full gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Metadata Pipelines</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Per-fileKind routing to VAST DataEngine functions. Edit the
            <code className="mx-1 px-1 rounded bg-[var(--color-ah-bg-overlay)] font-[var(--font-ah-mono)] text-xs">dataEnginePipelines</code>
            platform setting.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void load(true)}>Refresh</Button>
      </header>

      {error && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
        </div>
      )}

      {!isEmpty && missingKinds.length > 0 && (
        <div className="p-3 rounded border border-amber-500/30 bg-amber-500/10 text-sm flex items-center justify-between">
          <span>
            Missing pipelines for: {missingKinds.join(", ")}
          </span>
          <Button variant="ghost" onClick={() => void handleSeedMissing()} disabled={seedFailed}>
            Seed missing
          </Button>
        </div>
      )}

      {loading && !rows && (
        <div className="p-6 text-center text-[var(--color-ah-text-muted)]">Loading…</div>
      )}

      {isEmpty && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[var(--color-ah-text-muted)] mb-3">
            No pipelines configured. Seed the canonical default set (image / video / raw_camera).
          </p>
          <Button variant="primary" onClick={() => void handleSeedDefaults()} disabled={seedFailed}>
            Seed defaults
          </Button>
        </Card>
      )}

      {!isEmpty && rows && rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                <th className="px-3 py-2 text-left font-medium">Function</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Extensions</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Enabled</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.config.fileKind}
                  className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]"
                >
                  <td className="px-3 py-2">
                    <Badge variant="info">{KIND_LABEL[row.config.fileKind as FileKind] ?? row.config.fileKind}</Badge>
                  </td>
                  <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{row.config.functionName}</td>
                  <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">
                    {row.config.targetSchema}.{row.config.targetTable}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)] truncate max-w-[180px]"
                      title={row.config.extensions.join(", ")}>
                    {row.config.extensions.join(", ")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={row.status} detail={row.statusDetail} />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.config.enabled !== false}
                      aria-label={`Toggle ${row.config.fileKind}`}
                      onClick={() => void handleToggle(row)}
                      className={`inline-flex items-center h-5 w-9 rounded-full px-0.5 transition-colors ${
                        row.config.enabled !== false
                          ? "bg-green-500/60"
                          : "bg-[var(--color-ah-border-muted)]"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                          row.config.enabled !== false ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" disabled>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
