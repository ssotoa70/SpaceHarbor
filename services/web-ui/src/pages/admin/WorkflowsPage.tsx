/**
 * Workflows admin page.
 *
 * Left pane: definitions list (create/update/delete, enable/disable).
 * Right pane: for the selected definition, a list of recent instances
 * + the ability to start a new instance and transition one (approval,
 * cancel).
 *
 * DSL is edited as raw JSON. A React Flow canvas editor lands in Phase 5.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
  listWorkflowInstances, startWorkflow, getWorkflowInstance, transitionWorkflowInstance, cancelWorkflowInstance,
  type WorkflowDefinition, type WorkflowInstance, type WorkflowDsl, type WorkflowTransition,
} from "../../api";

const EXAMPLE_DSL: WorkflowDsl = {
  nodes: [
    { id: "start", kind: "start" },
    { id: "review", kind: "approval", config: { approvers: ["admin"] } },
    { id: "end", kind: "end" },
  ],
  edges: [
    { from: "start", to: "review" },
    { from: "review", to: "end" },
  ],
};

export function WorkflowsPage() {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<WorkflowDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listWorkflows();
      setDefinitions(rows);
      setError(null);
      if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void reload(); }, [reload]);

  const selected = definitions.find((d) => d.id === selectedId);

  const handleDelete = useCallback(async (d: WorkflowDefinition) => {
    if (!confirm(`Delete "${d.name}" v${d.version}? Running instances will continue; this is a soft delete.`)) return;
    try {
      await deleteWorkflow(d.id);
      if (selectedId === d.id) setSelectedId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [reload, selectedId]);

  const handleToggle = useCallback(async (d: WorkflowDefinition) => {
    try {
      await updateWorkflow(d.id, { enabled: !d.enabled });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }, [reload]);

  return (
    <section aria-label="Workflows" className="flex flex-col h-full gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Workflows</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Declarative JSON DAGs with approval/http/branch/wait node types. Define once, instantiate per asset.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Workflow</Button>
      </header>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <div className="grid gap-4" style={{ gridTemplateColumns: "320px 1fr" }}>
        <Card className="p-0 overflow-hidden h-fit">
          <div className="px-3 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] border-b border-[var(--color-ah-border)]">
            Definitions
          </div>
          <div>
            {loading && <div className="px-3 py-6 text-center text-sm text-[var(--color-ah-text-muted)]">Loading…</div>}
            {!loading && definitions.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-[var(--color-ah-text-muted)]">
                No workflows yet.
              </div>
            )}
            {definitions.map((d) => (
              <div
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`px-3 py-2 border-b border-[var(--color-ah-border-muted)] cursor-pointer ${
                  selectedId === d.id ? "bg-[var(--color-ah-bg-overlay)]" : "hover:bg-[var(--color-ah-bg-overlay)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{d.name}</span>
                    <Badge variant="default">v{d.version}</Badge>
                  </div>
                  {d.enabled ? <Badge variant="success">on</Badge> : <Badge variant="warning">off</Badge>}
                </div>
                {d.description && (
                  <p className="mt-1 text-xs text-[var(--color-ah-text-muted)] truncate">{d.description}</p>
                )}
                <div className="mt-2 flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); void handleToggle(d); }}
                    className="text-xs text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]">
                    {d.enabled ? "Disable" : "Enable"}
                  </button>
                  <span className="text-[var(--color-ah-text-subtle)]">·</span>
                  <button onClick={(e) => { e.stopPropagation(); setShowEdit(d); }}
                    className="text-xs text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]">
                    Edit
                  </button>
                  <span className="text-[var(--color-ah-text-subtle)]">·</span>
                  <button onClick={(e) => { e.stopPropagation(); void handleDelete(d); }}
                    className="text-xs text-red-400 hover:text-red-300">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {selected ? <DefinitionPane definition={selected} /> : (
          <div className="flex items-center justify-center text-sm text-[var(--color-ah-text-muted)]">
            Select a workflow definition from the list, or create one.
          </div>
        )}
      </div>

      {showCreate && (
        <DefinitionDialog mode="create" onCancel={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await reload(); }} />
      )}
      {showEdit && (
        <DefinitionDialog mode="edit" existing={showEdit} onCancel={() => setShowEdit(null)} onSaved={async () => { setShowEdit(null); await reload(); }} />
      )}
    </section>
  );
}

function DefinitionPane({ definition }: { definition: WorkflowDefinition }) {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<{ instance: WorkflowInstance; transitions: WorkflowTransition[] } | null>(null);
  const [startingContext, setStartingContext] = useState("{}");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadInstances = useCallback(async () => {
    try {
      const r = await listWorkflowInstances({ definitionId: definition.id, limit: 50 });
      setInstances(r.instances);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load instances");
    }
  }, [definition.id]);

  useEffect(() => { void reloadInstances(); setSelectedInstance(null); }, [reloadInstances]);

  const handleStart = useCallback(async () => {
    let ctx: Record<string, unknown> = {};
    try { ctx = JSON.parse(startingContext || "{}"); } catch {
      setError("Invalid starting context JSON");
      return;
    }
    setStarting(true); setError(null);
    try {
      await startWorkflow(definition.name, { context: ctx });
      await reloadInstances();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start failed");
    } finally {
      setStarting(false);
    }
  }, [definition.name, startingContext, reloadInstances]);

  const loadInstanceDetail = useCallback(async (instanceId: string) => {
    try {
      const d = await getWorkflowInstance(instanceId);
      setSelectedInstance(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load instance failed");
    }
  }, []);

  const handleAdvance = useCallback(async () => {
    if (!selectedInstance) return;
    try {
      await transitionWorkflowInstance(selectedInstance.instance.id, {});
      await reloadInstances();
      await loadInstanceDetail(selectedInstance.instance.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    }
  }, [selectedInstance, reloadInstances, loadInstanceDetail]);

  const handleCancel = useCallback(async () => {
    if (!selectedInstance) return;
    if (!confirm("Cancel this workflow instance?")) return;
    try {
      await cancelWorkflowInstance(selectedInstance.instance.id);
      await reloadInstances();
      await loadInstanceDetail(selectedInstance.instance.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }, [selectedInstance, reloadInstances, loadInstanceDetail]);

  const dslPretty = useMemo(() => {
    try { return JSON.stringify(JSON.parse(definition.dslJson), null, 2); }
    catch { return definition.dslJson; }
  }, [definition.dslJson]);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold">{definition.name} <span className="text-sm text-[var(--color-ah-text-muted)]">v{definition.version}</span></h2>
            <p className="text-xs text-[var(--color-ah-text-muted)]">Created by {definition.createdBy} · {new Date(definition.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={startingContext} onChange={(e) => setStartingContext(e.target.value)}
              placeholder="context JSON"
              className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] w-48" />
            <Button variant="primary" onClick={() => void handleStart()} disabled={starting || !definition.enabled}>
              {starting ? "Starting…" : "Start Instance"}
            </Button>
          </div>
        </div>
        {error && <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400 mb-2">{error}</div>}
        <details>
          <summary className="text-xs text-[var(--color-ah-text-muted)] cursor-pointer">DSL</summary>
          <pre className="mt-2 p-3 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] font-[var(--font-ah-mono)] text-xs overflow-auto max-h-60">
            {dslPretty}
          </pre>
        </details>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 text-xs font-medium text-[var(--color-ah-text-muted)] border-b border-[var(--color-ah-border)]">
          Recent Instances ({instances.length})
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Started</th>
              <th className="px-3 py-2 text-left font-medium">Current Node</th>
              <th className="px-3 py-2 text-left font-medium">State</th>
              <th className="px-3 py-2 text-left font-medium">By</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {instances.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-[var(--color-ah-text-muted)]">
                No instances yet.
              </td></tr>
            )}
            {instances.map((i) => (
              <tr key={i.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2 text-xs">{new Date(i.startedAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{i.currentNodeId}</td>
                <td className="px-3 py-2">
                  <Badge variant={
                    i.state === "completed" ? "success" :
                    i.state === "failed" ? "danger" :
                    i.state === "cancelled" ? "warning" : "info"
                  }>{i.state}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">{i.startedBy}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => void loadInstanceDetail(i.id)}>Inspect</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {selectedInstance && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Instance: {selectedInstance.instance.id.slice(0, 8)}…</h3>
            <div className="flex gap-2">
              {selectedInstance.instance.state === "running" && (
                <>
                  <Button variant="primary" onClick={() => void handleAdvance()}>Advance / Retry</Button>
                  <Button variant="ghost" onClick={() => void handleCancel()}>Cancel</Button>
                </>
              )}
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <div><span className="text-[var(--color-ah-text-muted)]">Current node:</span> <code className="font-[var(--font-ah-mono)] text-xs">{selectedInstance.instance.currentNodeId}</code></div>
            <div><span className="text-[var(--color-ah-text-muted)]">State:</span> {selectedInstance.instance.state}</div>
            {selectedInstance.instance.lastError && (
              <div className="text-red-400 text-xs">Error: {selectedInstance.instance.lastError}</div>
            )}
            <details>
              <summary className="text-xs text-[var(--color-ah-text-muted)] cursor-pointer">Context</summary>
              <pre className="mt-1 p-2 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] font-[var(--font-ah-mono)] text-xs overflow-auto max-h-40">
                {(() => { try { return JSON.stringify(JSON.parse(selectedInstance.instance.contextJson), null, 2); } catch { return selectedInstance.instance.contextJson; } })()}
              </pre>
            </details>
            <details open>
              <summary className="text-xs text-[var(--color-ah-text-muted)] cursor-pointer">Transitions ({selectedInstance.transitions.length})</summary>
              <ol className="mt-1 space-y-1 text-xs font-[var(--font-ah-mono)]">
                {selectedInstance.transitions.map((t) => (
                  <li key={t.id} className="p-2 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)]">
                    <span className="text-[var(--color-ah-text-muted)]">{new Date(t.at).toLocaleTimeString()}</span> ·
                    <span className="text-[var(--color-ah-accent)] ml-1">{t.fromNodeId}</span>
                    <span className="mx-1">→</span>
                    <span className="text-[var(--color-ah-accent)]">{t.toNodeId}</span>
                    {t.eventType && <span className="ml-2 text-[var(--color-ah-text-muted)]">[{t.eventType}]</span>}
                    {t.actor && <span className="ml-2 text-[var(--color-ah-text-muted)]">by {t.actor}</span>}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </Card>
      )}
    </div>
  );
}

function DefinitionDialog({
  mode,
  existing,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  existing?: WorkflowDefinition;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [dslJson, setDslJson] = useState(
    existing?.dslJson
      ? JSON.stringify(JSON.parse(existing.dslJson), null, 2)
      : JSON.stringify(EXAMPLE_DSL, null, 2),
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedDsl = useMemo(() => {
    try { return JSON.parse(dslJson) as WorkflowDsl; } catch { return undefined; }
  }, [dslJson]);

  const canSubmit = name.trim().length > 0 && parsedDsl !== undefined;

  const handleSubmit = useCallback(async () => {
    if (!parsedDsl) return;
    setSubmitting(true); setError(null);
    try {
      if (mode === "create") {
        await createWorkflow({ name: name.trim(), description: description.trim() || undefined, dsl: parsedDsl, enabled });
      } else if (existing) {
        await updateWorkflow(existing.id, { description: description.trim() || undefined, dsl: parsedDsl, enabled });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }, [mode, existing, name, description, parsedDsl, enabled, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[720px] max-w-[95vw] max-h-[90vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{mode === "create" ? "New Workflow" : `Edit ${existing?.name} v${existing?.version}`}</h3>

        {error && <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>}

        <div className="grid gap-3">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Name (auto-versioned per name)</span>
            <input type="text" value={name} disabled={mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm disabled:opacity-50" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Description (optional)</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">DSL (nodes + edges JSON)</span>
            <textarea value={dslJson} onChange={(e) => setDslJson(e.target.value)}
              rows={18}
              className={`mt-1 w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                parsedDsl === undefined ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
              }`} />
            {parsedDsl === undefined && <p className="mt-1 text-xs text-red-400">Invalid JSON</p>}
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
              Must include a node of kind <code>start</code>. Node kinds: start, end, approval, http, branch, wait_for_event, script, enqueue_job.
            </p>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enabled</span>
          </label>
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
