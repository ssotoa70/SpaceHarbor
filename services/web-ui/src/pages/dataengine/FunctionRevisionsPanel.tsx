import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Input } from "../../design-system/Input";
import { Skeleton } from "../../design-system/Skeleton";
import {
  fetchFunctionRevisions,
  createFunctionRevision,
  publishFunctionRevision,
  fetchContainerRegistries,
} from "../../api/dataengine-proxy";
import type {
  VastFunctionRevision,
  VastContainerRegistry,
} from "../../types/dataengine";

export function FunctionRevisionsPanel({
  functionGuid,
}: {
  functionGuid: string;
}) {
  const [revisions, setRevisions] = useState<VastFunctionRevision[]>([]);
  const [registries, setRegistries] = useState<VastContainerRegistry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-revision form state
  const [showForm, setShowForm] = useState(false);
  const [formRegistry, setFormRegistry] = useState("");
  const [formArtifact, setFormArtifact] = useState("");
  const [formImageTag, setFormImageTag] = useState("");
  const [formAlias, setFormAlias] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Publishing state
  const [publishingGuid, setPublishingGuid] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [revs, regs] = await Promise.all([
        fetchFunctionRevisions({ guid: functionGuid }),
        fetchContainerRegistries(),
      ]);
      setRevisions(revs);
      setRegistries(regs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  }, [functionGuid]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateRevision(e: FormEvent) {
    e.preventDefault();
    if (!formRegistry || !formArtifact || !formImageTag) return;

    setFormSubmitting(true);
    setFormError(null);
    try {
      await createFunctionRevision({
        function_guid: functionGuid,
        container_registry: formRegistry,
        artifact_source: formArtifact,
        image_tag: formImageTag,
        alias: formAlias || undefined,
      });
      setShowForm(false);
      setFormRegistry("");
      setFormArtifact("");
      setFormImageTag("");
      setFormAlias("");
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create revision");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handlePublish(revGuid: string) {
    setPublishingGuid(revGuid);
    try {
      await publishFunctionRevision(revGuid);
      await loadData();
    } catch {
      // Silently fail — the user can retry
    } finally {
      setPublishingGuid(null);
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-2" data-testid="revisions-loading">
        <Skeleton height="1.5rem" width="60%" />
        <Skeleton height="1rem" width="80%" />
        <Skeleton height="1rem" width="70%" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-[var(--color-ah-danger)]" data-testid="revisions-error">
        {error}
        <button
          onClick={loadData}
          className="ml-2 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--color-ah-bg)] border-t border-[var(--color-ah-border-muted)] p-4"
      data-testid="revisions-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold tracking-widest text-[var(--color-ah-text-muted)] uppercase">
          Revisions
        </h3>
        {!showForm && (
          <Button variant="ghost" onClick={() => setShowForm(true)}>
            + New Revision
          </Button>
        )}
      </div>

      {/* Create-revision form */}
      {showForm && (
        <form
          onSubmit={handleCreateRevision}
          className="mb-4 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] p-4 space-y-3"
          data-testid="revision-create-form"
        >
          <div className="grid gap-1.5">
            <label
              htmlFor="rev-registry"
              className="text-xs font-medium text-[var(--color-ah-text-muted)] block"
            >
              Container Registry
            </label>
            <select
              id="rev-registry"
              value={formRegistry}
              onChange={(e) => setFormRegistry(e.target.value)}
              required
              className="w-full rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]"
            >
              <option value="">Select registry...</option>
              {registries.map((r) => (
                <option key={r.guid} value={r.guid}>
                  {r.name} ({r.url})
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Artifact Source"
            value={formArtifact}
            onChange={(e) => setFormArtifact(e.target.value)}
            placeholder="e.g. myorg/my-function"
            required
          />

          <Input
            label="Image Tag"
            value={formImageTag}
            onChange={(e) => setFormImageTag(e.target.value)}
            placeholder="e.g. v1.2.0"
            required
          />

          <Input
            label="Alias"
            value={formAlias}
            onChange={(e) => setFormAlias(e.target.value)}
            placeholder="Optional alias (e.g. latest, stable)"
          />

          {formError && (
            <div
              role="alert"
              className="rounded-[var(--radius-ah-sm)] border border-[var(--color-ah-danger)]/30 bg-[var(--color-ah-danger)]/10 px-3 py-2 text-sm text-[var(--color-ah-danger)]"
            >
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowForm(false)}
              disabled={formSubmitting}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={formSubmitting}>
              {formSubmitting ? "Creating..." : "Create Revision"}
            </Button>
          </div>
        </form>
      )}

      {/* Revisions table */}
      {revisions.length === 0 ? (
        <p className="text-sm text-[var(--color-ah-text-subtle)] py-4 text-center">
          No revisions yet. Create the first one above.
        </p>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="revisions-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-3 py-2 font-medium">Rev #</th>
                <th className="px-3 py-2 font-medium">Alias</th>
                <th className="px-3 py-2 font-medium">Image</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => (
                <tr
                  key={rev.guid}
                  className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {rev.revision_number}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-ah-text-muted)]">
                    {rev.alias || "\u2014"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-ah-text-muted)] max-w-[200px] truncate">
                    {rev.full_image_path || `${rev.artifact_source}:${rev.image_tag}`}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={rev.status === "published" ? "success" : "warning"}>
                      {rev.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ah-text-muted)]">
                    {formatDate(rev.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    {rev.status === "draft" && (
                      <Button
                        variant="ghost"
                        onClick={() => handlePublish(rev.guid)}
                        disabled={publishingGuid === rev.guid}
                      >
                        {publishingGuid === rev.guid ? "Publishing..." : "Publish"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
