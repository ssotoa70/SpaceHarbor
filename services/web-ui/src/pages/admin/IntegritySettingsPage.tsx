import React, { useMemo, useState } from "react";
import { SettingCard } from "../../components/SettingCard";
import { useFunctionConfigs } from "../../hooks/useFunctionConfigs";

const SCOPE = "asset-integrity";

export function IntegritySettingsPage(): JSX.Element {
  const { configs, loading, error, save, reset, refresh } = useFunctionConfigs(SCOPE);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const byCategory = useMemo(() => groupBy(configs, (c) => c.category), [configs]);

  if (loading) {
    return <div className="p-6 text-slate-400">Loading settings…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-400 font-semibold">Settings unavailable</div>
        <div className="text-sm text-slate-400 mt-1">{error}</div>
        <button
          className="mt-3 px-3 py-1 rounded border border-slate-600 text-slate-200"
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </div>
    );
  }
  if (configs.length === 0) {
    return <div className="p-6 text-slate-400">No settings configured for this scope.</div>;
  }

  async function handleRestoreAll(): Promise<void> {
    setRestoring(true);
    try {
      for (const c of configs) {
        await reset(c.key);
      }
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Asset Integrity</h1>
          <p className="text-sm text-slate-400 mt-1">
            Tunable knobs for the hash + keyframe DataEngine functions. Changes take effect on the
            next function invocation.
          </p>
        </div>
        <button
          type="button"
          disabled={restoring}
          onClick={() => setConfirmRestore(true)}
          className="px-3 py-1 rounded border border-slate-600 text-slate-200"
        >
          Restore defaults
        </button>
      </div>

      {Object.entries(byCategory).map(([category, items]) => (
        <section key={category} className="mb-6">
          <h2 className="text-slate-300 uppercase text-xs tracking-wider mb-2">{category}</h2>
          {items.map((c) => (
            <SettingCard
              key={c.key}
              config={c}
              onSave={async (v) => save(c.key, v)}
              onReset={async () => reset(c.key)}
            />
          ))}
        </section>
      ))}

      {confirmRestore && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center" role="dialog">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md">
            <h2 className="text-lg font-semibold text-slate-100">Restore defaults?</h2>
            <p className="text-sm text-slate-400 mt-2">
              This will reset all {configs.length} settings in this scope to their factory defaults.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1 rounded border border-slate-600 text-slate-200"
                onClick={() => setConfirmRestore(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded bg-cyan-600 text-white"
                disabled={restoring}
                onClick={() => void handleRestoreAll()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function groupBy<T>(xs: T[], keyer: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) {
    const k = keyer(x);
    (out[k] ??= []).push(x);
  }
  return out;
}
