import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchHierarchy, fetchAssetLineage, createProject, createSequence, createShot, type HierarchyNode, type LineageDAG } from "../api";
import { AddToPlaylistModal } from "../components/AddToPlaylistModal";
import { AssetLineageGraph } from "../components/AssetLineageGraph";
import { ProvenancePanel } from "../components/ProvenancePanel";
import { VersionTimeline } from "../components/VersionTimeline";
import { Badge, Button, Card } from "../design-system";

function typeBadgeVariant(type: HierarchyNode["type"]) {
  if (type === "project") return "info" as const;
  if (type === "sequence") return "warning" as const;
  if (type === "shot") return "success" as const;
  if (type === "task") return "purple" as const;
  return "default" as const;
}

// ---------------------------------------------------------------------------
// Inline add-child form (shared for sequences and shots)
// ---------------------------------------------------------------------------

interface InlineAddFormProps {
  placeholder: string;
  onAdd: (code: string) => Promise<void>;
  onCancel: () => void;
}

function InlineAddForm({ placeholder, onAdd, onCancel }: InlineAddFormProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      className="flex items-center gap-1 px-2 py-1"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2 py-0.5 text-xs border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
      />
      <button
        type="submit"
        disabled={submitting || !code.trim()}
        className="text-xs text-[var(--color-ah-success)] hover:underline disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-[var(--color-ah-text-muted)] hover:underline"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-[var(--color-ah-danger)]">{error}</span>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// TreeItem
// ---------------------------------------------------------------------------

interface TreeItemProps {
  node: HierarchyNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (node: HierarchyNode) => void;
  onToggle: (id: string) => void;
  focusedId: string | null;
  onAddSequence?: (projectId: string, code: string) => Promise<void>;
  onAddShot?: (projectId: string, sequenceId: string, code: string) => Promise<void>;
  onNodeAdded?: (parentId: string, child: HierarchyNode) => void;
}

function TreeItem({ node, depth, selectedId, expanded, onSelect, onToggle, focusedId, onAddSequence, onAddShot, onNodeAdded }: TreeItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const [addingChild, setAddingChild] = useState(false);

  useEffect(() => {
    if (focusedId === node.id) ref.current?.focus();
  }, [focusedId, node.id]);

  const canAddChild = node.type === "project" || node.type === "sequence";
  const childLabel = node.type === "project" ? "seq code, e.g. SQ010" : "shot code, e.g. SQ010_0010";

  async function handleAddChild(code: string) {
    if (node.type === "project" && onAddSequence) {
      const child = await (async () => {
        await onAddSequence(node.id, code);
        // find the new node from the tree via onNodeAdded callback
        return null;
      })();
      void child;
    } else if (node.type === "sequence" && onAddShot) {
      // need projectId — it's stored on the sequence node but our HierarchyNode doesn't carry it
      // We pass node.id as sequenceId and rely on a dedicated handler that knows the projectId
      await onAddShot("__from_seq__", node.id, code);
    }
    setAddingChild(false);
  }

  return (
    <li
      ref={ref}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={selectedId === node.id}
      tabIndex={focusedId === node.id ? 0 : -1}
      className={`outline-none cursor-pointer ${selectedId === node.id ? "bg-[var(--color-ah-accent-muted)]/15" : "hover:bg-[var(--color-ah-bg-overlay)]"}`}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      onClick={(e) => { e.stopPropagation(); onSelect(node); if (hasChildren) onToggle(node.id); }}
      data-node-id={node.id}
    >
      <div className="flex items-center gap-2 py-1.5 px-2 text-sm group">
        <span className="w-4 text-center text-[var(--color-ah-text-subtle)]">
          {hasChildren ? (isExpanded ? "\u25BC" : "\u25B6") : "\u00B7"}
        </span>
        <span className="font-medium">{node.label}</span>
        <Badge variant={typeBadgeVariant(node.type)}>{node.type}</Badge>
        {node.pipeline_stage && (
          <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">{node.pipeline_stage}</span>
        )}
        {node.assignee && (
          <span className="text-[10px] text-[var(--color-ah-text-muted)]">{node.assignee}</span>
        )}
        {canAddChild && !addingChild && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAddingChild(true);
              if (!isExpanded) onToggle(node.id);
            }}
            className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-ah-accent)] hover:underline transition-opacity"
            title={node.type === "project" ? "Add sequence" : "Add shot"}
          >
            + Add
          </button>
        )}
      </div>
      {(hasChildren || addingChild) && (isExpanded || addingChild) && (
        <ul role="group">
          {node.children?.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              focusedId={focusedId}
              onAddSequence={onAddSequence}
              onAddShot={onAddShot}
              onNodeAdded={onNodeAdded}
            />
          ))}
          {addingChild && (
            <li style={{ paddingLeft: `${(depth + 1) * 1.25 + 0.5}rem` }}>
              <InlineAddForm
                placeholder={childLabel}
                onAdd={handleAddChild}
                onCancel={() => setAddingChild(false)}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

type DetailTab = "details" | "lineage";

function DetailPanel({ node, onNavigateToAsset, onAddToPlaylist }: { node: HierarchyNode | null; onNavigateToAsset?: (id: string) => void; onAddToPlaylist?: (shotId: string, versionId: string) => void }) {
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const [lineageDAG, setLineageDAG] = useState<LineageDAG | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // Load lineage data when a shot or version node is selected and lineage tab is active
  useEffect(() => {
    if (!node) { setLineageDAG(null); return; }
    if (activeTab !== "lineage") return;

    const id = node.id;
    void fetchAssetLineage(id).then(dag => {
      setLineageDAG(dag);
    });
  }, [node, activeTab]);

  // Reset tab when node changes
  useEffect(() => {
    setActiveTab("details");
    setSelectedVersionId(null);
  }, [node?.id]);

  if (!node) {
    return (
      <Card className="flex-1">
        <p className="text-[var(--color-ah-text-muted)] text-sm">Select a node to view details.</p>
      </Card>
    );
  }

  const showLineageTab = node.type === "shot" || node.type === "version";

  return (
    <Card className="flex-1 flex flex-col">
      {/* Tab bar */}
      {showLineageTab && (
        <div className="flex items-center gap-1 mb-3 border-b border-[var(--color-ah-border-muted)] pb-2">
          <button
            type="button"
            className={`px-2 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
              activeTab === "details"
                ? "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
                : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
            }`}
            onClick={() => setActiveTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
              activeTab === "lineage"
                ? "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
                : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
            }`}
            onClick={() => setActiveTab("lineage")}
          >
            Lineage
          </button>
        </div>
      )}

      {/* Details tab */}
      {activeTab === "details" && (
        <>
          <h2 className="text-lg font-semibold mb-2">{node.label}</h2>
          <Badge variant={typeBadgeVariant(node.type)}>{node.type}</Badge>
          <dl className="grid grid-cols-2 gap-2 mt-4 text-sm">
            <dt className="text-[var(--color-ah-text-muted)]">ID</dt>
            <dd className="font-mono">{node.id}</dd>
            <dt className="text-[var(--color-ah-text-muted)]">Type</dt>
            <dd>{node.type}</dd>
            {node.status && (
              <>
                <dt className="text-[var(--color-ah-text-muted)]">Status</dt>
                <dd>{node.status}</dd>
              </>
            )}
            {node.assignee && (
              <>
                <dt className="text-[var(--color-ah-text-muted)]">Assignee</dt>
                <dd>{node.assignee}</dd>
              </>
            )}
            {node.frame_range && (
              <>
                <dt className="text-[var(--color-ah-text-muted)]">Frame Range</dt>
                <dd className="font-mono">{node.frame_range.start} - {node.frame_range.end}</dd>
              </>
            )}
            {node.pipeline_stage && (
              <>
                <dt className="text-[var(--color-ah-text-muted)]">Pipeline Stage</dt>
                <dd>{node.pipeline_stage}</dd>
              </>
            )}
            {node.children && (
              <>
                <dt className="text-[var(--color-ah-text-muted)]">Children</dt>
                <dd>{node.children.length}</dd>
              </>
            )}
          </dl>

          {/* Version-specific details */}
          {node.type === "version" && (
            <div className="mt-4 pt-3 border-t border-[var(--color-ah-border)]">
              <h3 className="text-sm font-semibold text-[var(--color-ah-text-muted)] mb-2">Version Details</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {node.proxyUri && (
                  <>
                    <dt className="text-[var(--color-ah-text-muted)]">Proxy URI</dt>
                    <dd className="font-mono text-xs truncate">{node.proxyUri}</dd>
                  </>
                )}
                {node.resolution && (
                  <>
                    <dt className="text-[var(--color-ah-text-muted)]">Resolution</dt>
                    <dd className="font-mono text-xs">{node.resolution}</dd>
                  </>
                )}
                {node.color_space && (
                  <>
                    <dt className="text-[var(--color-ah-text-muted)]">Color Space</dt>
                    <dd className="font-mono text-xs">{node.color_space}</dd>
                  </>
                )}
                {node.frame_range && (
                  <>
                    <dt className="text-[var(--color-ah-text-muted)]">Frame Range</dt>
                    <dd className="font-mono text-xs">{node.frame_range.start} - {node.frame_range.end}</dd>
                  </>
                )}
                {node.pipeline_stage && (
                  <>
                    <dt className="text-[var(--color-ah-text-muted)]">Pipeline Stage</dt>
                    <dd className="font-mono text-xs">{node.pipeline_stage}</dd>
                  </>
                )}
              </dl>
              <div className="flex gap-2 mt-3">
                {onNavigateToAsset && (
                  <button
                    type="button"
                    onClick={() => onNavigateToAsset(node.id)}
                    className="text-sm text-[var(--color-ah-accent)] hover:underline cursor-pointer"
                  >
                    View in Asset Browser &rarr;
                  </button>
                )}
                {onNavigateToAsset && (
                  <button
                    type="button"
                    onClick={() => onNavigateToAsset(`${node.id}#review`)}
                    className="text-sm text-[var(--color-ah-success)] hover:underline cursor-pointer"
                  >
                    Send to Review &rarr;
                  </button>
                )}
              </div>

              {/* Provenance panel for version nodes */}
              <ProvenancePanel versionId={node.id} variant="inline" />
            </div>
          )}

          {/* Shot version timeline — replaced with VersionTimeline component */}
          {node.type === "shot" && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-[var(--color-ah-text-muted)] mb-2">Version timeline</h3>
              <VersionTimeline
                versions={(node.children ?? []).filter(c => c.type === "version")}
                selectedVersionId={selectedVersionId}
                onSelectVersion={(id) => {
                  setSelectedVersionId(id);
                  onNavigateToAsset?.(id);
                }}
              />
              {onAddToPlaylist && (
                <button
                  type="button"
                  onClick={() => {
                    const latestVersion = (node.children ?? []).filter(c => c.type === "version").at(-1);
                    if (latestVersion) onAddToPlaylist(node.id, latestVersion.id);
                  }}
                  className="mt-2 text-sm text-[var(--color-ah-warning)] hover:underline cursor-pointer"
                  data-testid="add-to-playlist-btn"
                >
                  Add to Playlist
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Lineage tab */}
      {activeTab === "lineage" && (
        <div className="flex-1 min-h-[300px]">
          {lineageDAG ? (
            <AssetLineageGraph
              dag={lineageDAG}
              currentVersionId={node.type === "version" ? node.id : undefined}
              onNodeClick={(id) => onNavigateToAsset?.(id)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-[var(--color-ah-text-subtle)]">
              Loading lineage...
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function flattenTree(nodes: HierarchyNode[], expanded: Set<string>): HierarchyNode[] {
  const result: HierarchyNode[] = [];
  function walk(list: HierarchyNode[]) {
    for (const n of list) {
      result.push(n);
      if (n.children && expanded.has(n.id)) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Create Project modal
// ---------------------------------------------------------------------------

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: (node: HierarchyNode) => void;
}

function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const node = await createProject({ name: name.trim(), code: code.trim() });
      onCreated(node);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="create-project-modal"
    >
      <div className="bg-[var(--color-ah-surface)] border border-[var(--color-ah-border)] rounded-[var(--radius-ah-md)] shadow-lg w-80 p-5">
        <h2 className="text-sm font-semibold mb-4">Create Project</h2>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Galactic Saga"
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="project-name-input"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-ah-text-muted)] mb-1">Project Code</label>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. GLXS"
              className="w-full px-2 py-1.5 text-sm border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)]"
              data-testid="project-code-input"
            />
          </div>
          {error && (
            <p className="text-xs text-[var(--color-ah-danger)]" role="alert">{error}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || !name.trim() || !code.trim()}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main HierarchyBrowser component
// ---------------------------------------------------------------------------

export function HierarchyBrowser() {
  const [tree, setTree] = useState<HierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<HierarchyNode | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const navigate = useNavigate();

  // Map sequenceId -> projectId for shot creation (sequences don't carry projectId in HierarchyNode)
  const seqToProject = useRef<Map<string, string>>(new Map());

  function loadTree() {
    setLoading(true);
    void fetchHierarchy().then((projects) => {
      // Rebuild the sequenceId->projectId index
      seqToProject.current = new Map();
      for (const proj of projects) {
        for (const child of proj.children ?? []) {
          if (child.type === "sequence") seqToProject.current.set(child.id, proj.id);
        }
      }
      setTree(projects);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }

  useEffect(() => {
    loadTree();
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleNavigateToAsset = useCallback((id: string) => {
    navigate(`/assets?q=${encodeURIComponent(id)}`);
  }, [navigate]);

  const [playlistTarget, setPlaylistTarget] = useState<{ shotId: string; versionId: string } | null>(null);

  // Add sequence to a project node in the tree
  const handleAddSequence = useCallback(async (projectId: string, code: string) => {
    const node = await createSequence({ projectId, code });
    seqToProject.current.set(node.id, projectId);
    setTree((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      return { ...p, children: [...(p.children ?? []), { ...node, children: [] }] };
    }));
  }, []);

  // Add shot to a sequence node. The sequenceId is passed as the second arg.
  // When called from TreeItem the projectId is "__from_seq__" — we resolve it from the index.
  const handleAddShot = useCallback(async (_projectId: string, sequenceId: string, code: string) => {
    const resolvedProjectId = seqToProject.current.get(sequenceId) ?? _projectId;
    const node = await createShot({ projectId: resolvedProjectId, sequenceId, code });
    setTree((prev) => {
      function insertShot(nodes: HierarchyNode[]): HierarchyNode[] {
        return nodes.map((n) => {
          if (n.id === sequenceId) {
            return { ...n, children: [...(n.children ?? []), { ...node, children: [] }] };
          }
          if (n.children) return { ...n, children: insertShot(n.children) };
          return n;
        });
      }
      return insertShot(prev);
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const flat = flattenTree(tree, expanded);
      const idx = flat.findIndex((n) => n.id === focusedId);
      if (idx < 0) return;

      if (e.key === "ArrowDown" && idx < flat.length - 1) {
        e.preventDefault();
        setFocusedId(flat[idx + 1].id);
      } else if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        setFocusedId(flat[idx - 1].id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const node = flat[idx];
        if (node.children?.length && !expanded.has(node.id)) toggleExpand(node.id);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const node = flat[idx];
        if (expanded.has(node.id)) toggleExpand(node.id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setSelectedNode(flat[idx]);
      }
    },
    [tree, expanded, focusedId, toggleExpand]
  );

  return (
    <section aria-label="Hierarchy browser" className="flex gap-4">
      <Card className="w-72 shrink-0 overflow-auto max-h-[calc(100vh-8rem)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--color-ah-text-muted)]">Project Hierarchy</h2>
          <Button variant="primary" onClick={() => setShowCreateProject(true)}>
            + Project
          </Button>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-7 rounded bg-[var(--color-ah-bg-overlay)] animate-pulse" />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-3xl mb-3 opacity-40">&#128193;</div>
            <p className="text-sm font-semibold text-[var(--color-ah-text)] mb-1">No projects</p>
            <p className="text-xs text-[var(--color-ah-text-muted)]">
              Create a project to start building the VFX hierarchy.
            </p>
          </div>
        ) : (
          <ul role="tree" aria-label="Project tree" onKeyDown={handleKeyDown}>
            {tree.map((node) => (
              <TreeItem
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedNode?.id ?? null}
                expanded={expanded}
                onSelect={(n) => { setSelectedNode(n); setFocusedId(n.id); }}
                onToggle={toggleExpand}
                focusedId={focusedId}
                onAddSequence={handleAddSequence}
                onAddShot={handleAddShot}
              />
            ))}
          </ul>
        )}
      </Card>
      <DetailPanel
        node={selectedNode}
        onNavigateToAsset={handleNavigateToAsset}
        onAddToPlaylist={(shotId, versionId) => setPlaylistTarget({ shotId, versionId })}
      />
      {playlistTarget && (
        <AddToPlaylistModal
          shotId={playlistTarget.shotId}
          versionId={playlistTarget.versionId}
          projectId="default"
          onClose={() => setPlaylistTarget(null)}
        />
      )}
      {showCreateProject && (
        <CreateProjectModal
          onClose={() => setShowCreateProject(false)}
          onCreated={(node) => {
            setTree((prev) => [...prev, { ...node, children: [] }]);
            setShowCreateProject(false);
          }}
        />
      )}
    </section>
  );
}
