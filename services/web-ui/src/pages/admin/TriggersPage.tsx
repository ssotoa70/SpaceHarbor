/**
 * Triggers admin page — event-selector driven automation.
 *
 * Surface: list triggers, enable/disable, create/edit/delete with JSON
 * condition + action config. Shows fire count + last fired.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  listTriggers, createTrigger, updateTrigger, deleteTrigger,
  type Trigger, type TriggerActionKind,
} from "../../api";

const ACTION_KINDS: Array<{ value: TriggerActionKind; label: string; hint: string }> = [
  { value: "post_event", label: "post_event", hint: "publish a synthetic event onto the bus (cascade)" },
  { value: "http_call", label: "http_call", hint: "outbound HTTP call — use webhookId for HMAC signing" },
  { value: "run_workflow", label: "run_workflow", hint: "create a new instance of a named workflow" },
  { value: "enqueue_job", label: "enqueue_job", hint: "queue a background job (Phase 3)" },
  { value: "run_script", label: "run_script", hint: "sandboxed JS snippet (Phase 3 — isolated-vm)" },
];

export function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Trigger | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { triggers: rows } = await listTriggers({ limit: 200 });
      setTriggers(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load triggers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toggleEnabled = useCallback(async (t: Trigger) => {
    try {
      await updateTrigger(t.id, { enabled: !t.enabled });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
  }, [reload]);

  const handleDelete = useCallback(async (t: Trigger) => {
    if (!confirm(`Delete trigger "${t.name}"?`)) return;
    try {
      await deleteTrigger(t.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [reload]);

  return (
    <section aria-label="Triggers" className="flex flex-col h-full gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Triggers</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Event-driven automation. Subscribe to events (<code className="font-[var(--font-ah-mono)] text-xs">checkin.committed</code>,
            {" "}<code className="font-[var(--font-ah-mono)] text-xs">version.approved</code>, etc.) and dispatch an action.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Trigger</Button>
      </header>

      {error && <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error}</div>}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
              <th className="px-3 py-2 text-left font-medium">Enabled</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Event Selector</th>
              <th className="px-3 py-2 text-left font-medium">Action</th>
              <th className="px-3 py-2 text-right font-medium">Fires</th>
              <th className="px-3 py-2 text-left font-medium">Last Fired</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>}
            {!loading && triggers.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No triggers yet. Click <span className="font-medium">+ New Trigger</span> to subscribe to an event.
              </td></tr>
            )}
            {triggers.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2">
                  <label className="inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={t.enabled} onChange={() => void toggleEnabled(t)} />
                  </label>
                </td>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{t.eventSelector}</td>
                <td className="px-3 py-2"><Badge variant="info">{t.actionKind}</Badge></td>
                <td className="px-3 py-2 text-right font-[var(--font-ah-mono)] text-xs">{t.fireCount}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                  {t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => setEditTarget(t)}>Edit</Button>
                  <Button variant="ghost" onClick={() => void handleDelete(t)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showCreate && (
        <TriggerDialog mode="create" onCancel={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await reload(); }} />
      )}
      {editTarget && (
        <TriggerDialog mode="edit" existing={editTarget} onCancel={() => setEditTarget(null)} onSaved={async () => { setEditTarget(null); await reload(); }} />
      )}
    </section>
  );
}

function TriggerDialog({
  mode,
  existing,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  existing?: Trigger;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [eventSelector, setEventSelector] = useState(existing?.eventSelector ?? "checkin.committed");
  const [conditionJson, setConditionJson] = useState(existing?.conditionJson ?? "");
  const [actionKind, setActionKind] = useState<TriggerActionKind>(existing?.actionKind ?? "post_event");
  const [actionConfigJson, setActionConfigJson] = useState(
    existing?.actionConfigJson
      ? JSON.stringify(JSON.parse(existing.actionConfigJson), null, 2)
      : JSON.stringify({ type: "downstream.event" }, null, 2),
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedCondition = useMemo(() => {
    if (!conditionJson.trim()) return null;
    try { return JSON.parse(conditionJson); } catch { return undefined; }
  }, [conditionJson]);

  const parsedActionConfig = useMemo(() => {
    try { return JSON.parse(actionConfigJson); } catch { return undefined; }
  }, [actionConfigJson]);

  const canSubmit =
    name.trim().length > 0 &&
    eventSelector.trim().length > 0 &&
    parsedActionConfig !== undefined &&
    parsedCondition !== undefined;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      if (mode === "create") {
        await createTrigger({
          name: name.trim(),
          description: description.trim() || undefined,
          eventSelector: eventSelector.trim(),
          conditionJson: parsedCondition ? JSON.stringify(parsedCondition) : undefined,
          actionKind,
          actionConfig: parsedActionConfig as Record<string, unknown>,
          enabled,
        });
      } else if (existing) {
        await updateTrigger(existing.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          eventSelector: eventSelector.trim(),
          conditionJson: parsedCondition ? JSON.stringify(parsedCondition) : undefined,
          actionKind,
          actionConfig: parsedActionConfig as Record<string, unknown>,
          enabled,
        });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }, [mode, existing, name, description, eventSelector, parsedCondition, actionKind, parsedActionConfig, enabled, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[640px] max-w-[95vw] max-h-[90vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{mode === "create" ? "New Trigger" : `Edit ${existing?.name}`}</h3>

        {error && <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>}

        <div className="grid gap-3">
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </Field>
          <Field label="Description (optional)">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]" />
          </Field>
          <Field label="Event Selector">
            <input type="text" value={eventSelector} onChange={(e) => setEventSelector(e.target.value)}
              placeholder="checkin.committed | version.* | *"
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm" />
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
              Exact match (<code>checkin.committed</code>), wildcard (<code>version.*</code>), or catchall (<code>*</code>).
            </p>
          </Field>
          <Field label="Condition JSON (optional — restrict by payload)">
            <textarea value={conditionJson} onChange={(e) => setConditionJson(e.target.value)}
              rows={3}
              placeholder={`{\n  "equals": { "path": "data.status", "value": "approved" }\n}`}
              className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                parsedCondition === undefined ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
              }`} />
            {parsedCondition === undefined && <p className="mt-1 text-xs text-red-400">Invalid JSON</p>}
          </Field>
          <Field label="Action Kind">
            <select value={actionKind} onChange={(e) => setActionKind(e.target.value as TriggerActionKind)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]">
              {ACTION_KINDS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
              {ACTION_KINDS.find((a) => a.value === actionKind)?.hint}
            </p>
          </Field>
          <Field label="Action Config JSON">
            <textarea value={actionConfigJson} onChange={(e) => setActionConfigJson(e.target.value)}
              rows={5}
              className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                parsedActionConfig === undefined ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
              }`} />
            {parsedActionConfig === undefined && <p className="mt-1 text-xs text-red-400">Invalid JSON</p>}
            {actionKind === "http_call" && (
              <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
                <code>{`{"webhookId": "<id>"}`}</code> for HMAC-signed delivery, or <code>{`{"url": "..."}`}</code> for fire-and-forget.
              </p>
            )}
            {actionKind === "post_event" && (
              <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
                <code>{`{"type": "event.name", "data": {...}}`}</code> — data defaults to source event's data if omitted.
              </p>
            )}
            {actionKind === "run_workflow" && (
              <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">
                <code>{`{"workflowName": "my_flow"}`}</code> — uses the latest enabled version.
              </p>
            )}
          </Field>
          <Field label="Enabled">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Trigger will fire on matching events</span>
            </label>
          </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
