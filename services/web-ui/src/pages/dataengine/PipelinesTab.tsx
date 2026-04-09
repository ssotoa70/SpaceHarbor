import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "../../design-system/Button";
import { Badge } from "../../design-system/Badge";
import type { BadgeVariant } from "../../design-system/Badge";
import { Skeleton } from "../../design-system/Skeleton";
import {
  fetchVastPipelines,
  deleteVastPipeline,
  deployVastPipeline,
} from "../../api/dataengine-proxy";
import type { VastPipeline, PipelineStatus } from "../../types/dataengine";
import { PipelineCreateModal } from "./PipelineCreateModal";
import { PipelineManifestEditor } from "./PipelineManifestEditor";
import { PipelineEditModal } from "./PipelineEditModal";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  Draft: "default",
  "In progress": "warning",
  Running: "success",
  Ready: "success",
  Deployed: "success",
  Failure: "danger",
  Failed: "danger",
  Error: "danger",
  Deploying: "warning",
  Pending: "warning",
};

export function PipelinesTab() {
  const [pipelines, setPipelines] = useState<VastPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VastPipeline | null>(null);
  const [editTarget, setEditTarget] = useState<VastPipeline | null>(null);
  const [manifestTarget, setManifestTarget] = useState<VastPipeline | null>(null);
  const [deployingIds, setDeployingIds] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVastPipelines();
      setPipelines(result);
    } catch (err) {
      setPipelines([]);
      setError(err instanceof Error ? err.message : "Failed to load pipelines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return pipelines;
    const q = debouncedQuery.toLowerCase();
    return pipelines.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }, [pipelines, debouncedQuery]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteVastPipeline(deleteTarget.id);
      setDeleteTarget(null);
      if (manifestTarget?.id === deleteTarget.id) setManifestTarget(null);
      await loadPipelines();
    } catch {
      // Keep modal open on failure -- user can retry
    }
  }

  async function handleDeploy(pipeline: VastPipeline) {
    setDeployingIds((prev) => new Set(prev).add(pipeline.id));
    try {
      await deployVastPipeline(pipeline.id);
      await loadPipelines();
    } catch {
      // Silently fail -- user can retry
    } finally {
      setDeployingIds((prev) => {
        const next = new Set(prev);
        next.delete(pipeline.id);
        return next;
      });
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  const canDeploy = (status: PipelineStatus) =>
    status === "Draft" || status === "Failure";

  return (
    <div data-testid="pipelines-tab">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-ah-text)]">
          Pipelines
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pipelines..."
            className="w-64 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-1.5 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ah-accent)]"
            data-testid="pipelines-search"
          />
          <Button
            variant="ghost"
            onClick={loadPipelines}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => setCreateModalOpen(true)}
          >
            Create Pipeline
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3" data-testid="pipelines-loading">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height="3rem" />
          ))}
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="pipelines-error"
        >
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            Unable to load pipelines
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">
            {error}
          </p>
          <Button variant="primary" onClick={loadPipelines}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="pipelines-empty"
        >
          <div className="text-4xl mb-4 opacity-40">&laquo;&raquo;</div>
          <h3 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">
            {debouncedQuery ? "No matching pipelines" : "No pipelines yet"}
          </h3>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            {debouncedQuery
              ? "Try a different search term."
              : "Create your first DataEngine pipeline to get started."}
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] overflow-hidden">
          <table className="w-full text-sm" data-testid="pipelines-table">
            <thead>
              <tr className="bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-subtle)] text-left">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">K8s Cluster</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pipeline) => (
                <tr
                  key={pipeline.id}
                  className="border-t border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] transition-colors"
                  data-testid={`pipeline-row-${pipeline.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {pipeline.name}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)]">
                    <span className="truncate block max-w-xs">
                      {pipeline.description || "\u2014"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={STATUS_BADGE_VARIANT[pipeline.status] ?? "default"}
                      data-testid={`pipeline-status-${pipeline.id}`}
                    >
                      {pipeline.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs">
                    {pipeline.kubernetes_cluster || "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ah-text-muted)] text-xs">
                    {formatDate(pipeline.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canDeploy(pipeline.status) && (
                        <Button
                          variant="primary"
                          onClick={() => void handleDeploy(pipeline)}
                          disabled={deployingIds.has(pipeline.id)}
                          data-testid={`pipeline-deploy-${pipeline.id}`}
                          className="text-xs px-2.5 py-1"
                        >
                          {deployingIds.has(pipeline.id) ? "Deploying..." : "Deploy"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => setEditTarget(pipeline)}
                        data-testid={`pipeline-edit-${pipeline.id}`}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setManifestTarget(pipeline)}
                        data-testid={`pipeline-manifest-${pipeline.id}`}
                      >
                        Manifest
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setDeleteTarget(pipeline)}
                        className="text-[var(--color-ah-danger)] hover:text-[var(--color-ah-danger)]"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <PipelineCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={loadPipelines}
      />

      <PipelineEditModal
        open={editTarget !== null}
        pipeline={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={loadPipelines}
      />

      <PipelineManifestEditor
        open={manifestTarget !== null}
        pipeline={manifestTarget}
        onClose={() => setManifestTarget(null)}
        onSaved={loadPipelines}
      />

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="Delete Pipeline"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ""}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
