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
      </header>

      {error && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">
          {error}
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
          <Button variant="primary" disabled>
            Seed defaults
          </Button>
          <p className="mt-2 text-[10px] text-[var(--color-ah-text-subtle)]">
            (Seed action wired in the next task.)
          </p>
        </Card>
      )}
    </section>
  );
}
