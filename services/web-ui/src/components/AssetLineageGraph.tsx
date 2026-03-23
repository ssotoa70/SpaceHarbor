import { useCallback, useEffect, useRef, useState } from "react";
import type { VersionNode, VersionEdge, LineageDAG } from "../api";
import { fetchCatalogResolveElement } from "../api";

/* ── Status color mapping ── */
const STATUS_COLORS: Record<string, string> = {
  draft: "var(--color-ah-text-muted)",
  review: "var(--color-ah-warning)",
  approved: "var(--color-ah-success)",
  rejected: "var(--color-ah-danger)",
  published: "var(--color-ah-accent)",
  archived: "var(--color-ah-text-subtle)",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "var(--color-ah-text-muted)";
}

/* ── Topological layout ── */

interface LayoutNode extends VersionNode {
  x: number;
  y: number;
  col: number;
  row: number;
}

function buildLayout(dag: LineageDAG): { nodes: LayoutNode[]; width: number; height: number } {
  const nodeMap = new Map(dag.nodes.map(n => [n.id, n]));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();

  for (const edge of dag.edges) {
    if (!children.has(edge.sourceId)) children.set(edge.sourceId, []);
    children.get(edge.sourceId)!.push(edge.targetId);
    if (!parents.has(edge.targetId)) parents.set(edge.targetId, []);
    parents.get(edge.targetId)!.push(edge.sourceId);
  }

  // Find root nodes (no parents)
  const roots = dag.nodes.filter(n => !parents.has(n.id) || parents.get(n.id)!.length === 0);

  // BFS to assign rows (depth) and columns
  const visited = new Set<string>();
  const rowAssignment = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const root of roots) {
    queue.push({ id: root.id, depth: 0 });
  }

  // If no roots found (cycle or empty), use all nodes
  if (queue.length === 0) {
    for (const n of dag.nodes) {
      queue.push({ id: n.id, depth: 0 });
    }
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    rowAssignment.set(id, depth);

    const childIds = children.get(id) ?? [];
    for (const childId of childIds) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  // Add unvisited nodes
  for (const n of dag.nodes) {
    if (!visited.has(n.id)) {
      rowAssignment.set(n.id, 0);
    }
  }

  // Group by row and assign columns
  const rowGroups = new Map<number, string[]>();
  for (const [id, row] of rowAssignment) {
    if (!rowGroups.has(row)) rowGroups.set(row, []);
    rowGroups.get(row)!.push(id);
  }

  const NODE_W = 160;
  const NODE_H = 80;
  const PAD_X = 40;
  const PAD_Y = 30;

  let maxCol = 0;
  let maxRow = 0;

  const layoutNodes: LayoutNode[] = [];

  for (const [row, ids] of rowGroups) {
    ids.forEach((id, col) => {
      const node = nodeMap.get(id);
      if (!node) return;
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;
      layoutNodes.push({
        ...node,
        col,
        row,
        x: PAD_X + col * (NODE_W + PAD_X),
        y: PAD_Y + row * (NODE_H + PAD_Y),
      });
    });
  }

  const width = PAD_X + (maxCol + 1) * (NODE_W + PAD_X) + PAD_X;
  const height = PAD_Y + (maxRow + 1) * (NODE_H + PAD_Y) + PAD_Y;

  return { nodes: layoutNodes, width: Math.max(width, 300), height: Math.max(height, 150) };
}

/* ── Component ── */

interface AssetLineageGraphProps {
  dag: LineageDAG;
  currentVersionId?: string;
  onNodeClick?: (nodeId: string) => void;
}

export function AssetLineageGraph({ dag, currentVersionId, onNodeClick }: AssetLineageGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [resolvedPaths, setResolvedPaths] = useState<Map<string, string>>(new Map());
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltipPath, setTooltipPath] = useState<string | null>(null);

  const { nodes: layoutNodes, width: svgW, height: svgH } = buildLayout(dag);
  const nodePositions = new Map(layoutNodes.map(n => [n.id, { x: n.x, y: n.y }]));

  const NODE_W = 160;
  const NODE_H = 60;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(3, Math.max(0.3, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Reset zoom on dag change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setResolvedPaths(new Map());
  }, [dag]);

  // C.10: Resolve element handle on node hover for current VAST path display
  useEffect(() => {
    if (!hoveredNode) {
      setTooltipPath(null);
      return;
    }

    // Check cache first
    const cached = resolvedPaths.get(hoveredNode);
    if (cached) {
      setTooltipPath(cached);
      return;
    }

    // Attempt to resolve the node ID as an element handle
    let cancelled = false;
    void fetchCatalogResolveElement(hoveredNode).then((resolved) => {
      if (cancelled) return;
      if (resolved) {
        setTooltipPath(resolved.currentPath);
        setResolvedPaths((prev) => new Map(prev).set(hoveredNode, resolved.currentPath));
      }
    });

    return () => { cancelled = true; };
  }, [hoveredNode, resolvedPaths]);

  if (dag.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-ah-text-subtle)]">
        No lineage data available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          type="button"
          onClick={() => setZoom(z => Math.min(3, z * 1.2))}
          className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] text-sm font-bold text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
          className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] text-sm font-bold text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          aria-label="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] text-xs text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
          aria-label="Reset zoom"
        >
          1:1
        </button>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          transformOrigin: "0 0",
        }}
      >
        <defs>
          <marker id="arrowhead-derives" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--color-ah-accent-muted)" />
          </marker>
          <marker id="arrowhead-depends" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--color-ah-warning)" />
          </marker>
        </defs>

        {/* Edges */}
        {dag.edges.map((edge, i) => {
          const src = nodePositions.get(edge.sourceId);
          const tgt = nodePositions.get(edge.targetId);
          if (!src || !tgt) return null;

          const x1 = src.x + NODE_W / 2;
          const y1 = src.y + NODE_H;
          const x2 = tgt.x + NODE_W / 2;
          const y2 = tgt.y;

          const isDerives = edge.edgeType === "derives";
          const color = isDerives ? "var(--color-ah-accent-muted)" : "var(--color-ah-warning)";
          const markerId = isDerives ? "arrowhead-derives" : "arrowhead-depends";

          // Curved path
          const midY = (y1 + y2) / 2;
          const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

          return (
            <g key={`edge-${i}`}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={isDerives ? "none" : "6 3"}
                markerEnd={`url(#${markerId})`}
                opacity={0.7}
              />
              {/* Change type label */}
              <text
                x={(x1 + x2) / 2}
                y={midY - 6}
                textAnchor="middle"
                fill="var(--color-ah-text-subtle)"
                fontSize={9}
                fontFamily="var(--font-ah-mono)"
              >
                {edge.changeType.replace(/_/g, " ")}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {layoutNodes.map(node => {
          const isCurrent = node.id === currentVersionId;
          const color = statusColor(node.status);

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={(e) => { e.stopPropagation(); onNodeClick?.(node.id); }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Current version ring */}
              {isCurrent && (
                <rect
                  x={-3}
                  y={-3}
                  width={NODE_W + 6}
                  height={NODE_H + 6}
                  rx={10}
                  ry={10}
                  fill="none"
                  stroke="var(--color-ah-accent)"
                  strokeWidth={2}
                  opacity={0.8}
                />
              )}

              {/* Node background */}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill="var(--color-ah-bg-raised)"
                stroke={color}
                strokeWidth={1.5}
              />

              {/* Status indicator dot */}
              <circle cx={12} cy={14} r={4} fill={color} />

              {/* Version label */}
              <text
                x={22}
                y={18}
                fill="var(--color-ah-text)"
                fontSize={12}
                fontWeight={600}
                fontFamily="var(--font-ah-sans)"
              >
                {node.versionLabel}
              </text>

              {/* Status text */}
              <text
                x={NODE_W - 8}
                y={18}
                textAnchor="end"
                fill={color}
                fontSize={9}
                fontFamily="var(--font-ah-mono)"
              >
                {node.status}
              </text>

              {/* Creator */}
              <text
                x={8}
                y={36}
                fill="var(--color-ah-text-muted)"
                fontSize={9}
                fontFamily="var(--font-ah-mono)"
              >
                {node.createdBy}
              </text>

              {/* Date */}
              <text
                x={8}
                y={50}
                fill="var(--color-ah-text-subtle)"
                fontSize={9}
                fontFamily="var(--font-ah-mono)"
              >
                {new Date(node.createdAt).toLocaleDateString()}
              </text>

              {/* Branch label */}
              {node.branchLabel && (
                <text
                  x={NODE_W - 8}
                  y={50}
                  textAnchor="end"
                  fill="var(--color-ah-purple)"
                  fontSize={9}
                  fontFamily="var(--font-ah-mono)"
                >
                  {node.branchLabel}
                </text>
              )}

              {/* C.10: VAST path tooltip on hover */}
              {hoveredNode === node.id && tooltipPath && (
                <g>
                  <rect
                    x={0}
                    y={NODE_H + 4}
                    width={NODE_W}
                    height={18}
                    rx={3}
                    fill="var(--color-ah-bg)"
                    stroke="var(--color-ah-accent-muted)"
                    strokeWidth={0.5}
                    opacity={0.95}
                  />
                  <text
                    x={4}
                    y={NODE_H + 16}
                    fill="var(--color-ah-accent)"
                    fontSize={8}
                    fontFamily="var(--font-ah-mono)"
                  >
                    {tooltipPath.length > 28 ? "..." + tooltipPath.slice(-25) : tooltipPath}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] text-[var(--color-ah-text-subtle)]">
        <span className="flex items-center gap-1">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-ah-accent-muted)" strokeWidth="1.5" /></svg>
          derives
        </span>
        <span className="flex items-center gap-1">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-ah-warning)" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
          depends
        </span>
      </div>
    </div>
  );
}
