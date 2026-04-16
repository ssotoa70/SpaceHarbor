/**
 * WorkflowCanvas — visual editor for workflow_definitions.dsl_json.
 *
 * The canvas owns its own (nodes, edges) state derived from a controlled
 * `value: WorkflowDsl` prop. On every mutation it calls back via `onChange`
 * with the updated DSL, so the parent dialog stays the source of truth and
 * the JSON view stays consistent.
 *
 * Selecting a node opens a side panel with a kind-aware editor (currently
 * a generic JSON config editor; per-kind typed forms can be added later).
 * Selecting an edge opens a JSON `when` condition editor.
 *
 * Connecting two handles in the canvas creates an edge in the DSL.
 * Pressing Backspace/Delete on a selected node/edge removes it.
 *
 * Engine + DSL contract:
 *   services/control-plane/src/workflow/engine.ts
 *   services/control-plane/src/routes/workflows.ts (validateDsl)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  dslToFlow,
  flowToDsl,
  validateDsl,
  type FlowEdge,
  type FlowNode,
  type WorkflowDsl,
} from "./dsl-mapper";
import {
  NODE_KINDS,
  NODE_KIND_ORDER,
  type NodeKind,
} from "./node-kinds";
import { WorkflowNodeComponent, type WorkflowNodeData } from "./WorkflowNode";

const nodeTypes = { workflowNode: WorkflowNodeComponent };

export interface WorkflowCanvasProps {
  value: WorkflowDsl;
  onChange: (next: WorkflowDsl) => void;
  height?: number;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({ value, onChange, height = 480 }: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<Node<WorkflowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<{ when?: Record<string, unknown> }>[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<NodeKind | "">("");
  const [newNodeId, setNewNodeId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const lastEmittedRef = useRef<string>("");

  // Sync incoming `value` prop into local React Flow state. Compare by
  // serialized DSL so we only reset when the parent actually changes (not
  // when our own onChange came back through).
  useEffect(() => {
    const incomingKey = JSON.stringify(value);
    if (incomingKey === lastEmittedRef.current) return;
    lastEmittedRef.current = incomingKey;
    const flow = dslToFlow(value);
    setNodes(flow.nodes as unknown as Node<WorkflowNodeData>[]);
    setEdges(flow.edges as unknown as Edge<{ when?: Record<string, unknown> }>[]);
  }, [value]);

  const emit = useCallback(
    (
      nextNodes: Node<WorkflowNodeData>[],
      nextEdges: Edge<{ when?: Record<string, unknown> }>[],
    ) => {
      const nextDsl = flowToDsl(
        nextNodes as unknown as FlowNode[],
        nextEdges as unknown as FlowEdge[],
      );
      const key = JSON.stringify(nextDsl);
      if (key === lastEmittedRef.current) return;
      lastEmittedRef.current = key;
      onChange(nextDsl);
    },
    [onChange],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((curr) => {
      const next = applyNodeChanges(changes, curr);
      // Position changes fire on every drag pixel — debounce by waiting
      // for "drag stop" semantics: emit only when the change isn't a
      // dragging update.
      const isDragging = changes.some((c) => c.type === "position" && c.dragging === true);
      if (!isDragging) emit(next as Node<WorkflowNodeData>[], edges);
      return next as Node<WorkflowNodeData>[];
    });
  }, [edges, emit]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((curr) => {
      const next = applyEdgeChanges(changes, curr) as Edge<{ when?: Record<string, unknown> }>[];
      emit(nodes, next);
      return next;
    });
  }, [nodes, emit]);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    setEdges((curr) => {
      const id = `e-${conn.source}-${conn.target}-${Date.now()}`;
      const next = addEdge(
        { ...conn, id, data: undefined } as Edge<{ when?: Record<string, unknown> }>,
        curr,
      ) as Edge<{ when?: Record<string, unknown> }>[];
      emit(nodes, next);
      return next;
    });
  }, [nodes, emit]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedNodeId(params.nodes[0]?.id ?? null);
    setSelectedEdgeId(params.edges[0]?.id ?? null);
  }, []);

  const handleAddNode = useCallback(() => {
    setAddError(null);
    if (!addingKind) {
      setAddError("Pick a node kind");
      return;
    }
    const id = newNodeId.trim();
    if (!id) {
      setAddError("Node id is required");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
      setAddError("Node id must be alphanumeric (start with letter or _)");
      return;
    }
    if (nodes.some((n) => n.id === id)) {
      setAddError(`Node id "${id}" already exists`);
      return;
    }
    const meta = NODE_KINDS[addingKind];
    const newNode: Node<WorkflowNodeData> = {
      id,
      type: "workflowNode",
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { kind: addingKind, config: meta.defaultConfig() },
    };
    const next = [...nodes, newNode];
    setNodes(next);
    emit(next, edges);
    setNewNodeId("");
    setAddingKind("");
  }, [addingKind, newNodeId, nodes, edges, emit]);

  const updateSelectedNodeConfig = useCallback((config: Record<string, unknown> | undefined) => {
    if (!selectedNodeId) return;
    const next = nodes.map((n) =>
      n.id === selectedNodeId
        ? { ...n, data: { ...n.data, config } }
        : n,
    );
    setNodes(next);
    emit(next, edges);
  }, [nodes, edges, emit, selectedNodeId]);

  const updateSelectedEdgeWhen = useCallback((when: Record<string, unknown> | undefined) => {
    if (!selectedEdgeId) return;
    const next = edges.map((e) =>
      e.id === selectedEdgeId
        ? { ...e, data: when ? { when } : undefined, label: when ? "when" : undefined }
        : e,
    );
    setEdges(next);
    emit(nodes, next);
  }, [nodes, edges, emit, selectedEdgeId]);

  const validation = useMemo(() => {
    const dsl = flowToDsl(
      nodes as unknown as FlowNode[],
      edges as unknown as FlowEdge[],
    );
    return validateDsl(dsl);
  }, [nodes, edges]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );

  return (
    <div className="border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-ah-bg-overlay)] border-b border-[var(--color-ah-border-muted)] text-xs">
        <select
          value={addingKind}
          onChange={(e) => setAddingKind((e.target.value as NodeKind) || "")}
          className="px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
          aria-label="Node kind"
        >
          <option value="">Add node…</option>
          {NODE_KIND_ORDER.map((k) => (
            <option key={k} value={k}>{NODE_KINDS[k].label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="node id"
          value={newNodeId}
          onChange={(e) => setNewNodeId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddNode(); }}
          className="px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] font-[var(--font-ah-mono)] w-40"
        />
        <button
          type="button"
          onClick={handleAddNode}
          className="px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] hover:bg-[var(--color-ah-bg-overlay)]"
        >
          + Add
        </button>
        {addError && <span className="text-red-400 text-xs">{addError}</span>}
        <span className="ml-auto text-[var(--color-ah-text-muted)] text-[10px]">
          drag handle from one node to another to connect · select + Backspace to delete
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 280px", height }}>
        <div className="h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-[var(--color-ah-bg)]" />
          </ReactFlow>
        </div>

        <aside className="border-l border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] overflow-auto">
          {selectedNode && (
            <NodeInspector
              node={selectedNode}
              onChangeConfig={updateSelectedNodeConfig}
            />
          )}
          {selectedEdge && !selectedNode && (
            <EdgeInspector
              edge={selectedEdge}
              onChangeWhen={updateSelectedEdgeWhen}
            />
          )}
          {!selectedNode && !selectedEdge && (
            <ValidationPanel validation={validation} nodeCount={nodes.length} edgeCount={edges.length} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ValidationPanel({
  validation, nodeCount, edgeCount,
}: {
  validation: { ok: true } | { ok: false; errors: string[] };
  nodeCount: number;
  edgeCount: number;
}) {
  return (
    <div className="p-3 text-xs">
      <h4 className="font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider text-[10px] mb-2">
        Status
      </h4>
      <p className="text-[var(--color-ah-text-muted)]">
        {nodeCount} node(s), {edgeCount} edge(s).
      </p>
      <div className="mt-3">
        {validation.ok ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 text-emerald-400">
            ✓ DSL valid
          </span>
        ) : (
          <div>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-500/15 text-red-400">
              ✗ DSL invalid
            </span>
            <ul className="mt-2 space-y-1 list-disc list-inside text-red-400">
              {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-4 text-[10px] text-[var(--color-ah-text-subtle)]">
        Click a node or edge to edit its config.
      </p>
    </div>
  );
}

function NodeInspector({
  node, onChangeConfig,
}: {
  node: Node<WorkflowNodeData>;
  onChangeConfig: (config: Record<string, unknown> | undefined) => void;
}) {
  const meta = NODE_KINDS[node.data.kind];
  const [text, setText] = useState(() =>
    node.data.config ? JSON.stringify(node.data.config, null, 2) : "",
  );
  const [parseError, setParseError] = useState<string | null>(null);

  // Reset textarea when selection changes.
  useEffect(() => {
    setText(node.data.config ? JSON.stringify(node.data.config, null, 2) : "");
    setParseError(null);
  }, [node.id, node.data.config]);

  const handleApply = useCallback(() => {
    if (!text.trim()) {
      setParseError(null);
      onChangeConfig(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setParseError("config must be a JSON object");
        return;
      }
      setParseError(null);
      onChangeConfig(parsed as Record<string, unknown>);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }, [text, onChangeConfig]);

  return (
    <div className="p-3 text-xs">
      <h4 className="font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider text-[10px] mb-2">
        {meta.label} node
      </h4>
      <p className="font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">{node.id}</p>
      <p className="mt-1 text-[var(--color-ah-text-muted)]">{meta.describe(node.data.config)}</p>

      <div className="mt-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-ah-text-muted)]">
            config (JSON)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className={`mt-1 w-full px-2 py-1 rounded border font-[var(--font-ah-mono)] text-xs ${
              parseError ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
            }`}
          />
          {parseError && <p className="mt-1 text-red-400 text-[10px]">{parseError}</p>}
        </label>
        <button
          type="button"
          onClick={handleApply}
          className="mt-2 px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] hover:bg-[var(--color-ah-bg-overlay)]"
        >
          Apply config
        </button>
      </div>
    </div>
  );
}

function EdgeInspector({
  edge, onChangeWhen,
}: {
  edge: Edge<{ when?: Record<string, unknown> }>;
  onChangeWhen: (when: Record<string, unknown> | undefined) => void;
}) {
  const [text, setText] = useState(() =>
    edge.data?.when ? JSON.stringify(edge.data.when, null, 2) : "",
  );
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(edge.data?.when ? JSON.stringify(edge.data.when, null, 2) : "");
    setParseError(null);
  }, [edge.id, edge.data]);

  const handleApply = useCallback(() => {
    if (!text.trim()) {
      setParseError(null);
      onChangeWhen(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setParseError("`when` must be a JSON object");
        return;
      }
      setParseError(null);
      onChangeWhen(parsed as Record<string, unknown>);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }, [text, onChangeWhen]);

  return (
    <div className="p-3 text-xs">
      <h4 className="font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider text-[10px] mb-2">
        Edge
      </h4>
      <p className="font-[var(--font-ah-mono)]">
        <span className="text-[var(--color-ah-accent)]">{edge.source}</span>
        <span className="mx-1 text-[var(--color-ah-text-muted)]">→</span>
        <span className="text-[var(--color-ah-accent)]">{edge.target}</span>
      </p>

      <div className="mt-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-ah-text-muted)]">
            when (JSON, optional)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`{\n  "equals": { "path": "state", "value": "approved" }\n}`}
            rows={6}
            className={`mt-1 w-full px-2 py-1 rounded border font-[var(--font-ah-mono)] text-xs ${
              parseError ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]"
            }`}
          />
          {parseError && <p className="mt-1 text-red-400 text-[10px]">{parseError}</p>}
        </label>
        <button
          type="button"
          onClick={handleApply}
          className="mt-2 px-2 py-1 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)] hover:bg-[var(--color-ah-bg-overlay)]"
        >
          Apply condition
        </button>
        <p className="mt-2 text-[10px] text-[var(--color-ah-text-subtle)]">
          Empty = unconditional. Engine evaluates `when` against the workflow context to decide which outgoing edge to take from a branch / approval node.
        </p>
      </div>
    </div>
  );
}
