import React, { useMemo, useState } from "react";
import type { FunctionConfigDTO, FunctionConfigValueType } from "../api";

interface SettingCardProps {
  config: FunctionConfigDTO;
  onSave: (newValue: unknown) => Promise<void>;
  onReset: () => Promise<void>;
}

type LocalError = string | null;

export function SettingCard({ config, onSave, onReset }: SettingCardProps): JSX.Element {
  const [draft, setDraft] = useState<unknown>(config.value);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [remoteError, setRemoteError] = useState<LocalError>(null);

  const dirty = !deepEqual(draft, config.value);
  const atDefault = deepEqual(config.value, config.default);

  const localError = useMemo<LocalError>(() => {
    return validateDraft(config.valueType, draft, config.min, config.max);
  }, [config.valueType, draft, config.min, config.max]);

  const saveDisabled = !dirty || localError !== null || saving;

  async function handleSave(): Promise<void> {
    setRemoteError(null);
    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(): Promise<void> {
    setRemoteError(null);
    setResetting(true);
    try {
      await onReset();
      setDraft(config.default);
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 mb-3">
      <div className="font-semibold text-slate-100">{config.label}</div>
      <div className="text-sm text-slate-400 mt-1 mb-3">{config.description}</div>

      <div className="flex items-center gap-2">
        {renderInput(config.valueType, draft, setDraft)}
        {config.valueType === "duration_seconds" && <span className="text-slate-400">s</span>}
      </div>

      <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-x-3">
        <span>default: {formatValue(config.default)}</span>
        {config.min !== null && <span>min: {config.min}</span>}
        {config.max !== null && <span>max: {config.max}</span>}
        {!atDefault && config.lastEditedBy && (
          <span>last edited by {config.lastEditedBy}{config.lastEditedAt ? ` at ${formatDate(config.lastEditedAt)}` : ""}</span>
        )}
      </div>

      {(localError ?? remoteError) && (
        <div className="text-sm text-red-400 mt-2">{localError ?? remoteError}</div>
      )}

      <div className="flex gap-2 mt-3">
        <button type="button" disabled={saveDisabled} onClick={handleSave}
          className="px-3 py-1 rounded bg-cyan-600 text-white disabled:bg-slate-700 disabled:text-slate-500">
          {saving ? "Saving…" : "Save"}
        </button>
        {!atDefault && (
          <button type="button" disabled={resetting} onClick={handleReset}
            className="px-3 py-1 rounded border border-slate-600 text-slate-200">
            {resetting ? "Resetting…" : "Reset"}
          </button>
        )}
      </div>
    </div>
  );
}

function renderInput(
  t: FunctionConfigValueType,
  value: unknown,
  setDraft: (v: unknown) => void,
): JSX.Element {
  if (t === "bool") {
    const checked = Boolean(value);
    return (
      <input type="checkbox" role="switch" checked={checked}
        onChange={(e) => setDraft(e.target.checked)}
        className="h-5 w-9 appearance-none rounded-full bg-slate-600 checked:bg-cyan-500 transition" />
    );
  }
  if (t === "string") {
    return (
      <input type="text" value={String(value ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        className="w-64 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100" />
    );
  }
  // numeric types
  return (
    <input type="number" value={Number(value ?? 0)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw === "" ? "" : Number(raw));
      }}
      className="w-32 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100" />
  );
}

function validateDraft(
  t: FunctionConfigValueType,
  v: unknown,
  min: number | null,
  max: number | null,
): LocalError {
  if (t === "int") {
    if (typeof v !== "number" || !Number.isInteger(v)) return "value must be integer";
  } else if (t === "float" || t === "duration_seconds") {
    if (typeof v !== "number" || !Number.isFinite(v)) return "value must be number";
  } else if (t === "bool") {
    if (typeof v !== "boolean") return "value must be boolean";
  } else if (t === "string") {
    if (typeof v !== "string") return "value must be string";
  }
  if (typeof v === "number") {
    if (min !== null && v < min) return `value must be >= ${min}`;
    if (max !== null && v > max) return `value must be <= ${max}`;
  }
  return null;
}

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
