/**
 * Workflow DSL ⇄ React Flow conversion.
 *
 * Pure module with no React/reactflow imports — exists in a shape that the
 * canvas component can consume (FlowNode/FlowEdge are RF-compatible) but the
 * tests can drive without instantiating React Flow.
 *
 * Position policy:
 *   The engine and validator (services/control-plane/src/routes/workflows.ts
 *   validateDsl) tolerate extra fields on nodes. We persist canvas positions
 *   as `position: { x, y }` on each DSL node. dslToFlow falls back to an
 *   auto-layout for nodes without a saved position; flowToDsl always writes
 *   the current canvas coordinates back so reopening preserves layout.
 *
 * Round-trip invariant:
 *   flowToDsl(dslToFlow(dsl)) deep-equals dsl   (ignoring auto-layout
 *   coordinates added when input nodes had no position).
 */

import type { NodeKind } from "./node-kinds.js";
import { layoutNodes, type LayoutSize } from "./auto-layout.js";

export interface DslNode {
  id: string;
  kind: NodeKind;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface DslEdge {
  from: string;
  to: string;
  when?: Record<string, unknown>;
}

export interface WorkflowDsl {
  nodes: DslNode[];
  edges: DslEdge[];
}

// React Flow shape. Loosely typed here so the component can pass these to
// reactflow without us depending on its types in this pure module.
export interface FlowNode {
  id: string;
  type: "workflowNode";
  position: { x: number; y: number };
  data: {
    kind: NodeKind;
    config: Record<string, unknown> | undefined;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  data?: { when?: Record<string, unknown> };
  label?: string;
}

const DEFAULT_NODE_SIZE: LayoutSize = { width: 200, height: 90 };

export function dslToFlow(dsl: WorkflowDsl): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const positioned = layoutNodes(dsl.nodes, dsl.edges, DEFAULT_NODE_SIZE);
  const nodes: FlowNode[] = positioned.map((n) => ({
    id: n.id,
    type: "workflowNode" as const,
    position: n.position,
    data: { kind: n.kind as NodeKind, config: n.config },
  }));
  const edges: FlowEdge[] = dsl.edges.map((e, i) => ({
    id: `e-${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    data: e.when ? { when: e.when } : undefined,
    label: e.when ? "when" : undefined,
  }));
  return { nodes, edges };
}

export function flowToDsl(flowNodes: FlowNode[], flowEdges: FlowEdge[]): WorkflowDsl {
  const nodes: DslNode[] = flowNodes.map((n) => {
    const out: DslNode = { id: n.id, kind: n.data.kind };
    if (n.data.config !== undefined) out.config = n.data.config;
    out.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    return out;
  });
  const edges: DslEdge[] = flowEdges.map((e) => {
    const out: DslEdge = { from: e.source, to: e.target };
    if (e.data?.when) out.when = e.data.when;
    return out;
  });
  return { nodes, edges };
}

/**
 * Validate the DSL client-side with the same rules as the server-side
 * validateDsl in routes/workflows.ts. Lets us surface errors before save
 * without a network round-trip.
 */
export function validateDsl(dsl: WorkflowDsl): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!dsl || !Array.isArray(dsl.nodes) || dsl.nodes.length === 0) {
    return { ok: false, errors: ["dsl.nodes must be a non-empty array"] };
  }
  if (!Array.isArray(dsl.edges)) {
    return { ok: false, errors: ["dsl.edges must be an array"] };
  }
  const ids = new Set<string>();
  for (const n of dsl.nodes) {
    if (!n.id) errors.push("every node needs an id");
    else if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    else ids.add(n.id);
    if (!n.kind) errors.push(`node ${n.id || "<no-id>"}: missing kind`);
  }
  if (!dsl.nodes.some((n) => n.kind === "start")) {
    errors.push("dsl must include a node of kind 'start'");
  }
  for (const e of dsl.edges) {
    if (!ids.has(e.from)) errors.push(`edge.from "${e.from}" is not a known node id`);
    if (!ids.has(e.to))   errors.push(`edge.to "${e.to}" is not a known node id`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
