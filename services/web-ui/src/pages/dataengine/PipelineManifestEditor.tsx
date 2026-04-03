import { useState, useEffect, useCallback } from "react";
import { Button } from "../../design-system/Button";
import { updateVastPipeline } from "../../api/dataengine-proxy";
import type { VastPipeline } from "../../types/dataengine";

export function PipelineManifestEditor({
  open,
  pipeline,
  onClose,
  onSaved,
}: {
  open: boolean;
  pipeline: VastPipeline | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  // Reset state when pipeline changes or modal opens
  useEffect(() => {
    if (open && pipeline) {
      const formatted = pipeline.manifest
        ? JSON.stringify(pipeline.manifest, null, 2)
        : "null";
      setRawJson(formatted);
      setEditing(false);
      setParseError(null);
      setSaveError(null);
      setSaving(false);
    }
  }, [open, pipeline]);

  function handleEditToggle() {
    setEditing(true);
    setParseError(null);
    setSaveError(null);
  }

  async function handleSave() {
    setParseError(null);
    setSaveError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Invalid JSON",
      );
      return;
    }

    if (!pipeline) return;

    setSaving(true);
    try {
      await updateVastPipeline(pipeline.id, { manifest: parsed });
      setEditing(false);
      onSaved();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save manifest",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open || !pipeline) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="pipeline-manifest-editor"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-ah-border-muted)]">
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)]">
            Manifest &mdash; {pipeline.name}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {editing ? (
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="w-full h-80 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-4 py-3 text-sm text-[var(--color-ah-text)] font-mono resize-y focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
              spellCheck={false}
              data-testid="manifest-textarea"
            />
          ) : (
            <pre
              className="w-full h-80 overflow-auto rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-4 py-3 text-sm text-[var(--color-ah-text)] font-mono whitespace-pre-wrap"
              data-testid="manifest-readonly"
            >
              {rawJson}
            </pre>
          )}

          {parseError && (
            <div
              role="alert"
              className="mt-3 rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/10 px-3 py-2 text-sm text-[var(--color-ah-danger)]"
            >
              Invalid JSON: {parseError}
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              className="mt-3 rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/10 px-3 py-2 text-sm text-[var(--color-ah-danger)]"
            >
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-ah-border-muted)]">
          {editing ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setParseError(null);
                  setSaveError(null);
                  // Reset to original
                  const formatted = pipeline.manifest
                    ? JSON.stringify(pipeline.manifest, null, 2)
                    : "null";
                  setRawJson(formatted);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={handleEditToggle}>
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
