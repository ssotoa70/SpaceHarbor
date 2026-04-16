/**
 * Layered BFS layout for workflow DAGs.
 *
 * Pure function — given nodes with optional saved positions plus the edge
 * list, returns each node with a position. Saved positions are preserved.
 *
 * Algorithm:
 *   1. Build adjacency. Roots = nodes with no incoming edge.
 *   2. BFS layers: each node's depth = max(depth(parents)) + 1.
 *      Nodes unreachable from any root land in layer 0.
 *   3. Within each layer, sort by stable insertion order, then assign x by
 *      column index, y by layer.
 *   4. Skip any node that already has a saved position; layout fills only
 *      the missing ones.
 *
 * Not as pretty as dagre but adds zero deps and is good enough for the
 * 5-15 node workflows we're targeting. Users can drag nodes after.
 */

export interface LayoutInputNode {
  id: string;
  kind: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface LayoutInputEdge {
  from: string;
  to: string;
  when?: Record<string, unknown>;
}

export interface LayoutOutputNode extends LayoutInputNode {
  position: { x: number; y: number };
}

export interface LayoutSize {
  width: number;
  height: number;
}

const COLUMN_GAP = 80;
const ROW_GAP = 60;

export function layoutNodes(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  nodeSize: LayoutSize,
): LayoutOutputNode[] {
  const inDegree = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outAdj.set(n.id, []);
  }
  for (const e of edges) {
    if (!inDegree.has(e.from) || !inDegree.has(e.to)) continue;
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    outAdj.get(e.from)!.push(e.to);
  }

  // Layer assignment via BFS from all roots simultaneously. Nodes
  // unreachable from any root (cycles, dangling subgraphs) get layer 0.
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layer.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = layer.get(id) ?? 0;
    for (const child of outAdj.get(id) ?? []) {
      const childDepth = depth + 1;
      const existing = layer.get(child);
      if (existing === undefined || childDepth > existing) {
        layer.set(child, childDepth);
        queue.push(child);
      }
    }
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 0);

  // Group by layer in stable input order.
  const byLayer = new Map<number, LayoutInputNode[]>();
  for (const n of nodes) {
    const d = layer.get(n.id) ?? 0;
    if (!byLayer.has(d)) byLayer.set(d, []);
    byLayer.get(d)!.push(n);
  }

  // Assign coordinates only to nodes without a saved position.
  const result: LayoutOutputNode[] = [];
  const layerWidths = new Map<number, number>(); // x cursor per layer
  for (const n of nodes) {
    if (n.position) {
      result.push({ ...n, position: n.position });
      continue;
    }
    const d = layer.get(n.id) ?? 0;
    const peers = byLayer.get(d) ?? [];
    const colIdx = peers.indexOf(n);
    void layerWidths; // reserved for future symmetric centering
    const x = d * (nodeSize.width + COLUMN_GAP);
    const y = colIdx * (nodeSize.height + ROW_GAP);
    result.push({ ...n, position: { x, y } });
  }
  return result;
}
