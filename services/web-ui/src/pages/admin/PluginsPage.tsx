/**
 * Plugins admin page (Phase 5.3).
 *
 * Two panels:
 *   Export — pick a name + which resource types to bundle, downloads JSON.
 *   Import — paste/upload a bundle, preview to surface conflicts, then
 *            apply. Surfaces freshly-generated webhook secrets once.
 *
 * Backend: POST /api/v1/plugins/{export,preview,import}
 *          src/routes/plugins.ts
 *          src/domain/plugin-bundle.ts
 */
import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  PLUGIN_RESOURCE_TYPES,
  exportPlugin,
  importPlugin,
  previewPluginImport,
  type PluginBundle,
  type PluginConflictStrategy,
  type PluginImportRecord,
  type PluginImportReport,
  type PluginResourceType,
} from "../../api";

const RESOURCE_LABELS: Record<PluginResourceType, string> = {
  namingTemplates: "Naming Templates",
  customFields: "Custom Fields",
  triggers: "Triggers",
  workflows: "Workflows",
  webhooks: "Webhooks",
};

export function PluginsPage() {
  return (
    <section aria-label="Plugins" className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold">Plugins</h1>
        <p className="text-sm text-[var(--color-ah-text-muted)]">
          Export your automation config (naming templates, custom fields, triggers, workflows, webhooks)
          as a portable JSON bundle, or import one shared by another deployment.
        </p>
      </header>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <ExportPanel />
        <ImportPanel />
      </div>
    </section>
  );
}

function ExportPanel() {
  const [name, setName] = useState("studio-bundle");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [included, setIncluded] = useState<Set<PluginResourceType>>(
    () => new Set(PLUGIN_RESOURCE_TYPES),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ bundle: PluginBundle; downloadedAt: string } | null>(null);

  const toggle = useCallback((t: PluginResourceType) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const bundle = await exportPlugin({
        include: [...included],
        name: name.trim() || undefined,
        version: version.trim() || undefined,
        description: description.trim() || undefined,
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundle.name}-${bundle.version}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLast({ bundle, downloadedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }, [included, name, version, description]);

  return (
    <Card>
      <h2 className="font-semibold mb-3">Export</h2>

      {error && (
        <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
      )}

      <div className="grid gap-3">
        <FormRow label="Bundle name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm" />
        </FormRow>
        <FormRow label="Version">
          <input type="text" value={version} onChange={(e) => setVersion(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm" />
        </FormRow>
        <FormRow label="Description (optional)">
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm" />
        </FormRow>
        <FormRow label="Include">
          <div className="grid gap-1">
            {PLUGIN_RESOURCE_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={included.has(t)} onChange={() => toggle(t)} />
                <span>{RESOURCE_LABELS[t]}</span>
              </label>
            ))}
          </div>
        </FormRow>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="primary" onClick={() => void handleExport()} disabled={busy || included.size === 0}>
          {busy ? "Exporting…" : "Export & Download"}
        </Button>
      </div>

      {last && (
        <div className="mt-4 p-3 rounded bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)] text-xs">
          <p className="text-[var(--color-ah-text-muted)]">
            Downloaded <span className="text-[var(--color-ah-accent)]">{last.bundle.name}-{last.bundle.version}.json</span>
          </p>
          <ResourceCounts bundle={last.bundle} />
          <p className="mt-1 text-[10px] text-[var(--color-ah-text-subtle)]">
            Webhook secrets are NOT included in the bundle. Receivers will get fresh secrets on import.
          </p>
        </div>
      )}
    </Card>
  );
}

function ImportPanel() {
  const [text, setText] = useState("");
  const [strategy, setStrategy] = useState<PluginConflictStrategy>("skip");
  const [report, setReport] = useState<PluginImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed: { ok: true; bundle: PluginBundle } | { ok: false; error: string } | null = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const obj = JSON.parse(text);
      return { ok: true, bundle: obj as PluginBundle };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const t = await file.text();
      setText(t);
      setReport(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Read failed");
    }
  }, []);

  const handlePreview = useCallback(async () => {
    if (!parsed || !parsed.ok) return;
    setBusy(true); setError(null);
    try {
      const r = await previewPluginImport(parsed.bundle, strategy);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }, [parsed, strategy]);

  const handleApply = useCallback(async () => {
    if (!parsed || !parsed.ok) return;
    if (!confirm("Apply this import? Created resources will be live immediately.")) return;
    setBusy(true); setError(null);
    try {
      const r = await importPlugin(parsed.bundle, strategy);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [parsed, strategy]);

  return (
    <Card>
      <h2 className="font-semibold mb-3">Import</h2>

      {error && (
        <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
      )}

      <div className="grid gap-3">
        <FormRow label="Conflict strategy">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as PluginConflictStrategy)}
            className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm"
          >
            <option value="skip">Skip on conflict (safe default)</option>
            <option value="rename">Rename on conflict (append __imported_&lt;timestamp&gt;)</option>
          </select>
          <p className="mt-1 text-[10px] text-[var(--color-ah-text-subtle)]">
            Custom fields always skip on conflict — their names are part of the API contract for stored values.
          </p>
        </FormRow>

        <FormRow label="Bundle JSON">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            className="block w-full text-xs mb-2"
          />
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setReport(null); }}
            rows={10}
            placeholder='Paste bundle JSON or upload a .json file'
            className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
              parsed?.ok === false ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
            }`}
          />
          {parsed?.ok === false && <p className="mt-1 text-xs text-red-400">{parsed.error}</p>}
          {parsed?.ok === true && (
            <div className="mt-2">
              <p className="text-xs text-[var(--color-ah-text-muted)]">
                <span className="text-[var(--color-ah-accent)] font-[var(--font-ah-mono)]">{parsed.bundle.name}</span>
                <span className="mx-1">·</span> v{parsed.bundle.version}
                <span className="mx-1">·</span> exported {new Date(parsed.bundle.exportedAt).toLocaleString()}
              </p>
              <ResourceCounts bundle={parsed.bundle} />
            </div>
          )}
        </FormRow>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void handlePreview()} disabled={busy || !parsed?.ok}>
          {busy ? "…" : "Preview (dry-run)"}
        </Button>
        <Button variant="primary" onClick={() => void handleApply()} disabled={busy || !parsed?.ok}>
          {busy ? "…" : "Apply Import"}
        </Button>
      </div>

      {report && <ImportReportPanel report={report} />}
    </Card>
  );
}

function ResourceCounts({ bundle }: { bundle: PluginBundle }) {
  const counts = PLUGIN_RESOURCE_TYPES.map((t) => ({
    type: t,
    count: (bundle.resources[t] as unknown[] | undefined)?.length ?? 0,
  })).filter((c) => c.count > 0);
  if (counts.length === 0) {
    return <p className="text-xs text-[var(--color-ah-text-subtle)]">No resources in bundle.</p>;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {counts.map((c) => (
        <Badge key={c.type} variant="default">
          {RESOURCE_LABELS[c.type]}: {c.count}
        </Badge>
      ))}
    </div>
  );
}

function ImportReportPanel({ report }: { report: PluginImportReport }) {
  const secrets = report.records.filter((r) => r.generatedSecret);
  return (
    <div className="mt-4 p-3 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-overlay)] text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider text-[10px]">
          {report.dryRun ? "Preview" : "Import"} Report
        </span>
        <span className="text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
          {report.bundleName} v{report.bundleVersion}
        </span>
      </div>

      <div className="flex gap-2 mb-3">
        <Badge variant="success">created: {report.totals.created}</Badge>
        <Badge variant="default">skipped: {report.totals.skipped}</Badge>
        <Badge variant="info">renamed: {report.totals.renamed}</Badge>
        <Badge variant="warning">failed: {report.totals.failed}</Badge>
      </div>

      {secrets.length > 0 && (
        <div className="mb-3 p-2 rounded bg-amber-500/10 border border-amber-500/30">
          <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Webhook secrets — copy now, won't be shown again</p>
          <ul className="space-y-1 font-[var(--font-ah-mono)] text-xs">
            {secrets.map((r, i) => (
              <li key={i}>
                <span className="text-[var(--color-ah-text-muted)]">{r.generatedSecret!.name}: </span>
                <span className="text-amber-400">{r.generatedSecret!.secret}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-1 max-h-72 overflow-auto">
        {report.records.map((r, i) => <RecordLine key={i} record={r} />)}
      </ul>
    </div>
  );
}

function RecordLine({ record }: { record: PluginImportRecord }) {
  const variant: "success" | "default" | "info" | "warning" =
    record.outcome === "created" ? "success" :
    record.outcome === "skipped" ? "default" :
    record.outcome === "renamed" ? "info" : "warning";
  return (
    <li className="flex items-start gap-2 py-0.5 border-b border-[var(--color-ah-border-muted)]">
      <Badge variant={variant}>{record.outcome}</Badge>
      <div className="flex-1 min-w-0">
        <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">{record.resourceType}:</span>
        <span className="ml-1 font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]">{record.key}</span>
        {record.outcome === "renamed" && record.finalName && (
          <span className="ml-2 text-[var(--color-ah-text-muted)]">→ {record.finalName}</span>
        )}
        {record.message && (
          <span className="ml-2 text-[var(--color-ah-text-muted)]">— {record.message}</span>
        )}
      </div>
    </li>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
