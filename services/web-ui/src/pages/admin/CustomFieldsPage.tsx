/**
 * Custom Fields admin page — runtime-extensible entity schema.
 *
 * Surface: list definitions by entity type, create/edit/delete.
 * Backend: GET/POST/PATCH/DELETE /api/v1/custom-fields/definitions
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "../../design-system";
import {
  CUSTOM_FIELD_ENTITY_TYPES,
  listCustomFieldDefinitions,
  createCustomFieldDefinition,
  deleteCustomFieldDefinition,
  updateCustomFieldDefinition,
  type CustomFieldDefinition,
  type CustomFieldEntityType,
  type CustomFieldDataType,
} from "./_custom-field-constants";

export function CustomFieldsPage() {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [entityFilter, setEntityFilter] = useState<CustomFieldEntityType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomFieldDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listCustomFieldDefinitions(
        entityFilter === "all" ? {} : { entity: entityFilter },
      );
      setDefinitions(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load definitions");
    } finally {
      setLoading(false);
    }
  }, [entityFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this custom field definition? Existing values will remain readable but can't be updated.")) return;
    try {
      await deleteCustomFieldDefinition(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [reload]);

  return (
    <section aria-label="Custom Fields" className="flex flex-col h-full gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Custom Fields</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)]">
            Runtime-extensible metadata fields for assets, versions, shots, and more — no code deploy required.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ New Field</Button>
      </header>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[var(--color-ah-text-muted)]">Entity:</label>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value as CustomFieldEntityType | "all")}
          className="px-2 py-1 text-xs rounded border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)]"
        >
          <option value="all">All</option>
          {CUSTOM_FIELD_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
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
              <th className="px-3 py-2 text-left font-medium">Entity</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Label</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Required</th>
              <th className="px-3 py-2 text-left font-medium">Created By</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">Loading…</td></tr>
            )}
            {!loading && definitions.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--color-ah-text-muted)]">
                No custom field definitions yet. Click <span className="font-medium">+ New Field</span> to add one.
              </td></tr>
            )}
            {!loading && definitions.map((d) => (
              <tr key={d.id} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                <td className="px-3 py-2"><Badge variant="info">{d.entityType}</Badge></td>
                <td className="px-3 py-2 font-[var(--font-ah-mono)] text-xs">{d.name}</td>
                <td className="px-3 py-2">{d.displayLabel}</td>
                <td className="px-3 py-2"><Badge variant="default">{d.dataType}</Badge></td>
                <td className="px-3 py-2">{d.required ? <Badge variant="warning">required</Badge> : <span className="text-[var(--color-ah-text-subtle)]">—</span>}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">{d.createdBy}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => setEditTarget(d)}>Edit</Button>
                  <Button variant="ghost" onClick={() => void handleDelete(d.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showCreate && (
        <CustomFieldDialog
          mode="create"
          onCancel={() => setShowCreate(false)}
          onSaved={async () => { setShowCreate(false); await reload(); }}
        />
      )}
      {editTarget && (
        <CustomFieldDialog
          mode="edit"
          existing={editTarget}
          onCancel={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await reload(); }}
        />
      )}
    </section>
  );
}

function CustomFieldDialog({
  mode,
  existing,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  existing?: CustomFieldDefinition;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [entityType, setEntityType] = useState<CustomFieldEntityType>(existing?.entityType ?? "asset");
  const [name, setName] = useState(existing?.name ?? "");
  const [displayLabel, setDisplayLabel] = useState(existing?.displayLabel ?? "");
  const [dataType, setDataType] = useState<CustomFieldDataType>(existing?.dataType ?? "string");
  const [required, setRequired] = useState(existing?.required ?? false);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [validationJson, setValidationJson] = useState(
    existing?.validation ? JSON.stringify(existing.validation, null, 2) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationParsed = useMemo(() => {
    if (!validationJson.trim()) return null;
    try { return JSON.parse(validationJson); } catch { return undefined; }
  }, [validationJson]);

  const canSubmit = name.trim() && displayLabel.trim() && validationParsed !== undefined;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      if (mode === "create") {
        await createCustomFieldDefinition({
          entityType, name: name.trim(), displayLabel: displayLabel.trim(),
          dataType, required, validation: validationParsed ?? null,
          description: description.trim() || null,
        });
      } else if (existing) {
        await updateCustomFieldDefinition(existing.id, {
          displayLabel: displayLabel.trim(),
          required,
          validation: validationParsed ?? null,
          description: description.trim() || null,
        });
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }, [mode, existing, entityType, name, displayLabel, dataType, required, validationParsed, description, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[520px] max-w-[90vw] max-h-[85vh] overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">
          {mode === "create" ? "New Custom Field" : `Edit ${existing?.entityType}.${existing?.name}`}
        </h3>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
        )}

        <div className="grid gap-3">
          <FormRow label="Entity Type">
            <select
              value={entityType}
              disabled={mode === "edit"}
              onChange={(e) => setEntityType(e.target.value as CustomFieldEntityType)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] disabled:opacity-50"
            >
              {CUSTOM_FIELD_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormRow>
          <FormRow label="Name (immutable)">
            <input
              type="text" value={name} disabled={mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. show_code"
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] text-sm disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-[var(--color-ah-text-subtle)]">lowercase, underscores, 1–64 chars</p>
          </FormRow>
          <FormRow label="Display Label">
            <input
              type="text" value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              placeholder="e.g. Show Code"
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
            />
          </FormRow>
          <FormRow label="Data Type (immutable)">
            <select
              value={dataType} disabled={mode === "edit"}
              onChange={(e) => setDataType(e.target.value as CustomFieldDataType)}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] disabled:opacity-50"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="date">date (ISO 8601)</option>
              <option value="enum">enum</option>
              <option value="ref">ref (entity id)</option>
            </select>
          </FormRow>
          <FormRow label="Required">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              <span>Value must be provided on entity create</span>
            </label>
          </FormRow>
          <FormRow label="Validation JSON (optional)">
            <textarea
              value={validationJson}
              onChange={(e) => setValidationJson(e.target.value)}
              rows={4}
              placeholder={`{\n  "max_length": 64,\n  "allowed_values": ["A", "B"]\n}`}
              className={`w-full px-3 py-2 rounded border font-[var(--font-ah-mono)] text-xs ${
                validationParsed === undefined
                  ? "border-red-500/50 bg-red-500/5"
                  : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
              }`}
            />
            {validationParsed === undefined && (
              <p className="mt-1 text-xs text-red-400">Invalid JSON</p>
            )}
          </FormRow>
          <FormRow label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm"
            />
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
