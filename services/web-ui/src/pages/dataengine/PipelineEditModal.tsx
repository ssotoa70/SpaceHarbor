import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Input } from "../../design-system/Input";
import { updateVastPipeline } from "../../api/dataengine-proxy";
import type { VastPipeline } from "../../types/dataengine";

/**
 * Lightweight edit modal for renaming / re-describing a pipeline.
 *
 * Manifest (triggers + function deployments) is edited through the existing
 * PipelineManifestEditor (JSON) or, in a future release, the Visual Builder.
 */
export function PipelineEditModal({
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (open && pipeline) {
      setName(pipeline.name);
      setDescription(pipeline.description ?? "");
      setError(null);
      setSubmitting(false);
    }
  }, [open, pipeline]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pipeline || !name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await updateVastPipeline(pipeline.id, {
        name: name.trim(),
        description: description.trim(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pipeline");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !pipeline) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="pipeline-edit-modal"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-1">
          Edit Pipeline
        </h2>
        <p className="text-[11px] text-[var(--color-ah-text-subtle)] mb-4">
          Use the Manifest button to edit triggers and function deployments directly.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <div className="grid gap-1.5">
            <label
              htmlFor="pipeline-description"
              className="text-sm font-medium text-[var(--color-ah-text-muted)]"
            >
              Description
            </label>
            <textarea
              id="pipeline-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)] resize-none"
            />
          </div>

          <div className="rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] px-3 py-2 space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[var(--color-ah-text-subtle)]">Status</span>
              <span className="text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">{pipeline.status}</span>
            </div>
            {pipeline.kubernetes_cluster && (
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-ah-text-subtle)]">Cluster</span>
                <span className="text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">{pipeline.kubernetes_cluster}</span>
              </div>
            )}
            {pipeline.namespace && (
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-ah-text-subtle)]">Namespace</span>
                <span className="text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">{pipeline.namespace}</span>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/10 px-3 py-2 text-sm text-[var(--color-ah-danger)]"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
