import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Button } from "../../design-system/Button";
import { Input } from "../../design-system/Input";
import { createVastPipeline } from "../../api/dataengine-proxy";

export function PipelineCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kubernetesCluster, setKubernetesCluster] = useState("");
  const [namespace, setNamespace] = useState("");
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

  // Reset form state when modal opens
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setKubernetesCluster("");
      setNamespace("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await createVastPipeline({
        name: name.trim(),
        description: description.trim() || undefined,
        kubernetes_cluster: kubernetesCluster.trim() || undefined,
        namespace: namespace.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pipeline");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="pipeline-create-modal"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-4">
          Create Pipeline
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. media-ingest-pipeline"
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
              placeholder="Optional description of the pipeline"
              rows={3}
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)] resize-none"
            />
          </div>

          <Input
            label="Kubernetes Cluster"
            value={kubernetesCluster}
            onChange={(e) => setKubernetesCluster(e.target.value)}
            placeholder="e.g. production-cluster"
          />

          <Input
            label="Namespace"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="e.g. dataengine"
          />

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
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
