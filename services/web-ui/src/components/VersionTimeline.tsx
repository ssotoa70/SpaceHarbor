import { useCallback, useRef, useState } from "react";
import type { HierarchyNode } from "../api";

/* ── Status color helpers ── */

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  approved: {
    bg: "var(--color-ah-success-muted)",
    text: "var(--color-ah-success)",
    border: "var(--color-ah-success)",
  },
  rejected: {
    bg: "var(--color-ah-danger-muted)",
    text: "var(--color-ah-danger)",
    border: "var(--color-ah-danger)",
  },
  review: {
    bg: "var(--color-ah-warning-muted)",
    text: "var(--color-ah-warning)",
    border: "var(--color-ah-warning)",
  },
  published: {
    bg: "rgba(34, 211, 238, 0.15)",
    text: "var(--color-ah-accent)",
    border: "var(--color-ah-accent)",
  },
};

function statusStyle(status?: string) {
  const s = status ?? "";
  return STATUS_COLORS[s] ?? {
    bg: "rgba(8, 145, 178, 0.15)",
    text: "var(--color-ah-accent-muted)",
    border: "var(--color-ah-accent-muted)",
  };
}

/* ── Tooltip ── */

interface TooltipData {
  x: number;
  y: number;
  node: HierarchyNode;
}

/* ── Layout helpers ── */

interface VersionNodeLayout {
  node: HierarchyNode;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
}

/**
 * Build a horizontal strip layout for version nodes.
 * Linear versions are placed left-to-right.
 * Branches (detected via branchLabel or multiple children) are offset vertically.
 */
function layoutVersions(versions: HierarchyNode[]): VersionNodeLayout[] {
  if (versions.length === 0) return [];

  const NODE_SPACING = 80;
  const NODE_Y = 24;
  const BRANCH_Y = 60;

  const result: VersionNodeLayout[] = [];
  let x = 20;

  // For now, lay versions out linearly. If a version has a parent hint
  // (via label naming convention like "v002b"), offset it vertically.
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const isBranch = /[a-z]$/i.test(v.label) && i > 0;
    const y = isBranch ? BRANCH_Y : NODE_Y;
    const parentX = i > 0 ? result[i - 1].x : undefined;
    const parentY = i > 0 ? result[i - 1].y : undefined;

    result.push({ node: v, x, y, parentX, parentY });
    x += NODE_SPACING;
  }

  return result;
}

/* ── Component ── */

interface VersionTimelineProps {
  versions: HierarchyNode[];
  selectedVersionId?: string | null;
  onSelectVersion?: (versionId: string) => void;
}

export function VersionTimeline({ versions, selectedVersionId, onSelectVersion }: VersionTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const layout = layoutVersions(versions);

  const svgWidth = layout.length > 0
    ? layout[layout.length - 1].x + 60
    : 100;
  const svgHeight = layout.some(l => l.y > 30) ? 90 : 60;

  const NODE_R = 14;

  const handleNodeClick = useCallback((id: string) => {
    onSelectVersion?.(id);
  }, [onSelectVersion]);

  const handleMouseEnter = useCallback((e: React.MouseEvent, node: HierarchyNode) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top - 60,
      node,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (versions.length === 0) {
    return (
      <span className="text-xs text-[var(--color-ah-text-subtle)]">No versions</span>
    );
  }

  return (
    <div ref={containerRef} className="relative overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="block"
      >
        {/* Connection lines (SVG paths) */}
        {layout.map((item, i) => {
          if (i === 0 || item.parentX == null || item.parentY == null) return null;
          const x1 = item.parentX + NODE_R;
          const y1 = item.parentY;
          const x2 = item.x - NODE_R;
          const y2 = item.y;

          // If same row, straight line. If different row, curved path (branch).
          if (y1 === y2) {
            return (
              <line
                key={`line-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-ah-border)"
                strokeWidth={1.5}
              />
            );
          }

          // Branch curve
          const midX = (x1 + x2) / 2;
          const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
          return (
            <path
              key={`path-${i}`}
              d={d}
              fill="none"
              stroke="var(--color-ah-border)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
          );
        })}

        {/* Version nodes */}
        {layout.map((item) => {
          const style = statusStyle(item.node.status);
          const isSelected = item.node.id === selectedVersionId;

          return (
            <g
              key={item.node.id}
              transform={`translate(${item.x}, ${item.y})`}
              onClick={() => handleNodeClick(item.node.id)}
              onMouseEnter={(e) => handleMouseEnter(e, item.node)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: "pointer" }}
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  r={NODE_R + 3}
                  fill="none"
                  stroke="var(--color-ah-accent)"
                  strokeWidth={2}
                />
              )}

              {/* Node circle */}
              <circle
                r={NODE_R}
                fill={style.bg}
                stroke={style.border}
                strokeWidth={1.5}
              />

              {/* Label */}
              <text
                y={1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={style.text}
                fontSize={9}
                fontWeight={600}
                fontFamily="var(--font-ah-mono)"
              >
                {item.node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-20 px-3 py-2 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border)] shadow-lg pointer-events-none"
          style={{ left: tooltip.x - 60, top: tooltip.y }}
        >
          <div className="text-xs font-semibold text-[var(--color-ah-text)]">{tooltip.node.label}</div>
          {tooltip.node.status && (
            <div className="text-[10px] text-[var(--color-ah-text-muted)] mt-0.5">
              Status: <span style={{ color: statusStyle(tooltip.node.status).text }}>{tooltip.node.status}</span>
            </div>
          )}
          {tooltip.node.assignee && (
            <div className="text-[10px] text-[var(--color-ah-text-muted)]">
              Author: {tooltip.node.assignee}
            </div>
          )}
          {tooltip.node.color_space && (
            <div className="text-[10px] text-[var(--color-ah-text-muted)]">
              Color: {tooltip.node.color_space}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
