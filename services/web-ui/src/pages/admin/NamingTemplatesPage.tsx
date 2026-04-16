/**
 * Naming Templates admin page (Phase 5.1).
 *
 * List + create/edit dialog with live preview. The preview pane debounces
 * server-side renders so we get parser+validator output identical to what
 * downstream callers will see.
 *
 * Engine + REST surface:
 *   services/control-plane/src/domain/naming-template.ts
 *   services/control-plane/src/routes/naming-templates.ts
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  NAMING_TEMPLATE_SCOPES,
  createNamingTemplate,
  deleteNamingTemplate,
  listNamingTemplates,
  previewNamingTemplate,
  updateNamingTemplate,
  type NamingTemplate,
  type NamingTemplatePreview,
  type NamingTemplateScope,
} from "../../api";

const SCOPE_LABELS: Record<NamingTemplateScope, string> = {
  asset_filename: "Asset filename",
  version_label: "Version label",
  export_filename: "Export filename",
  shot_name: "Shot name",
};

const SCOPE_DEFAULT_TEMPLATE: Record<NamingTemplateScope, string> = {
  asset_filename: "{project}_{shot}_{task}_v{version:03d}.{ext}",
  version_label: "v{version:03d}",
  export_filename: "{project}_{shot}_v{version:03d}_{date:YYYYMMDD}.{ext}",
  shot_name: "{sequence}_{shot:padleft:4}",
};

const SCOPE_DEFAULT_CONTEXT: Record<NamingTemplateScope, Record<string, unknown>> = {
  asset_filename: { project: "BTH", shot: "010", task: "comp", version: 7, ext: "exr" },
  version_label: { version: 7 },
  export_filename: { project: "BTH", shot: "010", version: 7, date: "2026-04-16", ext: "mov" },
  shot_name: { sequence: "010", shot: "10" },
};

export function NamingTemplatesPage() {
  const [templates, setTemplates] = useState<NamingTemplate[]>([]);
  const [scopeFilter, setScopeFilter] = useState<NamingTemplateScope | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<NamingTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listNamingTemplates(
        scopeFilter === "all" ? {} : { scope: scopeFilter },
      );
      setTemplates(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [scopeFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = useCallback(async (t: NamingTemplate) => {
    if (!confirm(`Delete "${t.name}"? Existing usages stop validating against it.`)) return;
    try {
      await deleteNamingTemplate(t.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [reload]);

  const handleToggle = useCallback(async (t: NamingTemplate) => {
    try {
      await updateNamingTemplate(t.id, { enabled: !t.enabled });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }, [reload]);

  return (
    <section aria-label="Naming Templates" className="flex flex-col h-full gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Naming Templates</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Reusable filename / version-label conventions with live preview. Tokens like
            <code className="mx-1 px-1 rounded bg-[var(--color-ah-bg-overlay)] font-[var(--font-ah-mono)] text-xs">{"{shot}"}</code>
            and
            <code className="mx-1 px-1 rounded bg-[var(--color-ah-bg-overlay)] font-[var(--font-ah-mono)] text-xs">{"{version:03d}"}</code>
            resolve at render time.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Template</Button>
      </header>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[var(--color-ah-text-muted)]">Scope:</label>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as NamingTemplateScope | "all")}
          className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)]"
        >
          <option value="all">All</option>
          {NAMING_TEMPLATE_SCOPES.map((s) => (
            <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Scope</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Template</th>
              <th className="px-3 py-2 text-left font-medium">Tokens</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>
            )}
            {!loading && templates.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No naming templates yet. Click <span className="font-medium">+ New Template</span> to add one.
              </td></tr>
            )}
            {!loading && templates.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2"><Badge variant="info">{SCOPE_LABELS[t.scope as NamingTemplateScope] ?? t.scope}</Badge></td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{t.name}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs truncate max-w-[300px]" title={t.template}>
                  {t.template}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {t.tokens.length === 0 ? "—" : t.tokens.join(", ")}
                </td>
                <td className="px-3 py-2">
                  {t.enabled ? <Badge variant="success">on</Badge> : <Badge variant="warning">off</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => void handleToggle(t)}>
                    {t.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditTarget(t)}>Edit</Button>
                  <Button variant="ghost" onClick={() => void handleDelete(t)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showCreate && (
        <NamingTemplateDialog
          mode="create"
          onCancel={() => setShowCreate(false)}
          onSaved={async () => { setShowCreate(false); await reload(); }}
        />
      )}
      {editTarget && (
        <NamingTemplateDialog
          mode="edit"
          existing={editTarget}
          onCancel={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await reload(); }}
        />
      )}
    </section>
  );
}

function NamingTemplateDialog({
  mode,
  existing,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  existing?: NamingTemplate;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [scope, setScope] = useState<NamingTemplateScope>(existing?.scope ?? "asset_filename");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [template, setTemplate] = useState(
    existing?.template ?? SCOPE_DEFAULT_TEMPLATE[scope],
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [contextJson, setContextJson] = useState(() => {
    const ctx = existing?.sampleContext ?? SCOPE_DEFAULT_CONTEXT[existing?.scope ?? "asset_filename"];
    return JSON.stringify(ctx, null, 2);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NamingTemplatePreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);

  const parsedContext = useMemo(() => {
    if (!contextJson.trim()) return {};
    try { return JSON.parse(contextJson) as Record<string, unknown>; } catch { return undefined; }
  }, [contextJson]);

  const contextValid = parsedContext !== undefined;

  // Debounced server-side preview — keeps frontend rendering identical to backend.
  useEffect(() => {
    if (!template.trim()) { setPreview(null); return; }
    if (!contextValid) { setPreview(null); return; }
    setPreviewPending(true);
    const handle = window.setTimeout(async () => {
      try {
        const r = await previewNamingTemplate(template, parsedContext ?? {});
        setPreview(r);
      } catch (e) {
        setPreview({
          rendered: "",
          tokens: [],
          errors: [{ token: "", message: e instanceof Error ? e.message : "preview failed" }],
          validation: { ok: false, errors: ["preview request failed"] },
        });
      } finally {
        setPreviewPending(false);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [template, contextValid, parsedContext]);

  const canSubmit =
    name.trim().length > 0 &&
    template.trim().length > 0 &&
    contextValid &&
    (preview === null || preview.validation.ok);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      if (mode === "create") {
        await createNamingTemplate({
          name: name.trim(),
          scope,
          template,
          description: description.trim() || null,
          sampleContext: parsedContext ?? null,
          enabled,
        });
      } else if (existing) {
        await updateNamingTemplate(existing.id, {
          template,
          description: description.trim() || null,
          sampleContext: parsedContext ?? null,
          enabled,
        });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }, [mode, existing, name, scope, template, description, parsedContext, enabled, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[820px] max-w-[95vw] max-h-[92vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">
          {mode === "create" ? "New Naming Template" : `Edit ${existing?.scope}.${existing?.name}`}
        </h3>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
        )}

        <div className="grid gap-3">
          <FormRow label="Name (immutable)">
            <input
              type="text" value={name} disabled={mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. studio_export"
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">lowercase + underscores, 1–64 chars</p>
          </FormRow>

          <FormRow label="Scope (immutable)">
            <select
              value={scope} disabled={mode === "edit"}
              onChange={(e) => {
                const next = e.target.value as NamingTemplateScope;
                setScope(next);
                if (mode === "create") {
                  setTemplate(SCOPE_DEFAULT_TEMPLATE[next]);
                  setContextJson(JSON.stringify(SCOPE_DEFAULT_CONTEXT[next], null, 2));
                }
              }}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] disabled:opacity-50"
            >
              {NAMING_TEMPLATE_SCOPES.map((s) => (
                <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Description (optional)">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </FormRow>

          <FormRow label="Template">
            <textarea
              value={template} onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                preview && !preview.validation.ok
                  ? "border-red-500/50 bg-red-500/5"
                  : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
              }`}
            />
            {preview && !preview.validation.ok && (
              <ul className="mt-1 text-xs text-red-400 list-disc list-inside">
                {preview.validation.errors.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
              Tokens: <code>{"{name}"}</code>, <code>{"{n:03d}"}</code> (zero-pad number),
              <code>{" {date:YYYYMMDD}"}</code> (date format),
              <code>{" {x:upper}"}</code> / <code>{"{x:lower}"}</code> / <code>{"{x:slug}"}</code>,
              <code>{" {arr:join:_}"}</code>, escape with <code>{"{{"}</code> / <code>{"}}"}</code>.
            </p>
          </FormRow>

          <FormRow label="Sample context (JSON)">
            <textarea
              value={contextJson} onChange={(e) => setContextJson(e.target.value)}
              rows={6}
              className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                contextValid ? "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" : "border-red-500/50 bg-red-500/5"
              }`}
            />
            {!contextValid && <p className="mt-1 text-xs text-red-400">Invalid JSON</p>}
          </FormRow>

          <div className="rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-overlay)] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Live preview</span>
              {previewPending && <span className="text-[10px] text-[var(--color-ah-text-subtle)]">rendering…</span>}
            </div>
            <pre className="font-[var(--font-ah-mono)] text-sm text-[var(--color-ah-accent)] whitespace-pre-wrap break-all">
              {preview?.rendered || (contextValid ? "" : "(fix JSON to render)")}
            </pre>
            {preview && preview.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-[var(--color-ah-text-subtle)] mb-1">Render warnings:</p>
                <ul className="text-xs text-amber-400 space-y-0.5">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      <code className="font-[var(--font-ah-mono)]">{e.token || "(template)"}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <FormRow label="Enabled">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Available for downstream consumers</span>
            </label>
          </FormRow>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={submitting || !canSubmit}>
            {submitting ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
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
