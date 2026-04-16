/**
 * CustomFieldsPanel — inline editor for runtime custom fields on an entity.
 *
 * Fetches definitions for `entityType`, fetches current values for
 * `entityId`, and renders an input per field that commits on blur.
 *
 * Drop into: AssetDetail, VersionDetail, ShotDetail, etc.
 *
 * Usage:
 *   <CustomFieldsPanel entityType="asset" entityId={asset.id} />
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listCustomFieldDefinitions, getCustomFieldValues, setCustomFieldValues,
  type CustomFieldDefinition, type CustomFieldEntityType,
} from "../api";

export interface CustomFieldsPanelProps {
  entityType: CustomFieldEntityType;
  entityId: string;
  /** Optional className for outer wrapper. */
  className?: string;
  /** Read-only display, no editing. */
  readOnly?: boolean;
}

export function CustomFieldsPanel({ entityType, entityId, className, readOnly }: CustomFieldsPanelProps) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [defs, valRes] = await Promise.all([
        listCustomFieldDefinitions({ entity: entityType }),
        getCustomFieldValues(entityType, entityId),
      ]);
      setDefinitions(defs);
      setValues(valRes.fields);
      setDraft(valRes.fields);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load custom fields");
      setLoaded(true);
    }
  }, [entityType, entityId]);

  useEffect(() => { void reload(); }, [reload]);

  const dirtyFields = useMemo(() => {
    const out: string[] = [];
    for (const def of definitions) {
      const current = values[def.name];
      const next = draft[def.name];
      if (!deepEqual(current, next)) out.push(def.name);
    }
    return out;
  }, [definitions, values, draft]);

  const commitField = useCallback(async (name: string) => {
    const value = draft[name];
    setSaving(name);
    try {
      await setCustomFieldValues(entityType, entityId, { [name]: value });
      setValues((prev) => ({ ...prev, [name]: value }));
      setError(null);
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : "save failed"}`);
      // Revert draft on failure so the UI reflects server truth
      setDraft((prev) => ({ ...prev, [name]: values[name] }));
    } finally {
      setSaving(null);
    }
  }, [entityType, entityId, draft, values]);

  if (!loaded) {
    return <div className={className}><div className="text-xs text-[var(--color-ah-text-muted)]">Loading custom fields…</div></div>;
  }

  if (definitions.length === 0) {
    return (
      <div className={className}>
        <div className="text-xs text-[var(--color-ah-text-muted)]">
          No custom fields defined for {entityType}. Admins can add fields at{" "}
          <a href="/automation/custom-fields" className="text-[var(--color-ah-accent)] underline">
            Automation → Custom Fields
          </a>.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {error && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="grid gap-2">
        {definitions.map((def) => (
          <FieldRow
            key={def.id}
            def={def}
            value={draft[def.name]}
            onChange={(v) => setDraft((prev) => ({ ...prev, [def.name]: v }))}
            onCommit={() => void commitField(def.name)}
            dirty={dirtyFields.includes(def.name)}
            saving={saving === def.name}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function FieldRow({
  def, value, onChange, onCommit, dirty, saving, readOnly,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  onCommit: () => void;
  dirty: boolean;
  saving: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <label className="w-32 text-xs font-medium text-[var(--color-ah-text-muted)] pt-2 flex-shrink-0" title={def.description ?? ""}>
        {def.displayLabel}
        {def.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">
        <FieldInput def={def} value={value} onChange={onChange} onCommit={onCommit} readOnly={readOnly} />
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-ah-text-subtle)]">
          <span className="font-[var(--font-ah-mono)]">{def.dataType}</span>
          {saving && <span className="text-[var(--color-ah-accent)]">saving…</span>}
          {dirty && !saving && <span className="text-[var(--color-ah-warning)]">unsaved · Enter or blur to save</span>}
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  def, value, onChange, onCommit, readOnly,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  onCommit: () => void;
  readOnly?: boolean;
}) {
  const commonClass =
    "w-full px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] text-sm disabled:opacity-50";

  const handleCommit = () => { if (!readOnly) onCommit(); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && def.dataType !== "string") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  switch (def.dataType) {
    case "string":
    case "ref":
      return (
        <input
          type="text"
          value={stringify(value)}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={handleKey}
          maxLength={def.validation?.max_length}
          className={commonClass}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={value as number | string ?? ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          onBlur={handleCommit}
          onKeyDown={handleKey}
          min={def.validation?.min}
          max={def.validation?.max}
          className={commonClass}
        />
      );
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={readOnly}
            onChange={(e) => { onChange(e.target.checked); if (!readOnly) onCommit(); }}
          />
          <span className="text-[var(--color-ah-text-muted)]">{value ? "Yes" : "No"}</span>
        </label>
      );
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          onBlur={handleCommit}
          className={commonClass}
        />
      );
    case "enum": {
      const allowed = def.validation?.allowed_values ?? [];
      return (
        <select
          value={stringify(value)}
          disabled={readOnly}
          onChange={(e) => { onChange(e.target.value || null); if (!readOnly) onCommit(); }}
          className={commonClass}
        >
          <option value="">—</option>
          {allowed.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
