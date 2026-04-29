/**
 * AssetHeaderBar — Phase 6 asset-detail header.
 *
 * Three independent slots (each hides when its data is missing):
 *   - Frame counter ("Frame 1001")
 *   - Timecode ("01:00:04:01")
 *   - AOV pill row, with deterministic per-layer color dots
 *
 * Two render modes selected by callback presence:
 *   - `onAovChange` provided → pills are clickable; `activeAov` drives
 *     the pressed-state styling. Single-select toggle.
 *   - `onAovChange` absent → pills are non-interactive (no role/button,
 *     `tabIndex={-1}`). Used in the full-screen viewer where there is
 *     no AOV table to filter.
 *
 * When all three slots are empty, the bar returns `null` (zero DOM).
 *
 * Color-dot consistency with `AovLayerMapTable`: both call
 * `buildLayerRows(metadata)` and index into the same `LAYER_COLORS`
 * tuple. Kept in lockstep by construction.
 */

import type { AssetMetadataResponse } from "../api";
import { buildLayerRows } from "./AovLayerMapTable";
import { extractFrameFields } from "./metadata/frame-fields-extractor";

const LAYER_COLORS = [
  "#a855f7", "#06b6d4", "#f59e0b", "#22c55e", "#ec4899", "#3b82f6", "#ef4444", "#8b5cf6",
];

interface AssetHeaderBarProps {
  metadata: AssetMetadataResponse | null;
  activeAov?: string | null;
  onAovChange?: (aov: string | null) => void;
}

export function AssetHeaderBar({ metadata, activeAov, onAovChange }: AssetHeaderBarProps) {
  if (metadata == null) return null;

  const fields = extractFrameFields(metadata);
  const frameNumber = fields.frame_number;
  const timecode = fields.timecode_value;
  const rows = buildLayerRows(metadata);

  const showFrame = frameNumber !== undefined;
  const showTimecode = typeof timecode === "string" && timecode.length > 0;
  const showPills = rows.length > 0;

  if (!showFrame && !showTimecode && !showPills) return null;

  return (
    <div
      className="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-[var(--color-ah-border-muted)]"
      data-testid="asset-header-bar"
    >
      {showFrame && (
        <span className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-muted)] whitespace-nowrap">
          Frame {frameNumber}
        </span>
      )}
      {showTimecode && (
        <span className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-muted)] whitespace-nowrap">
          {timecode}
        </span>
      )}
      {showPills && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {rows.map((row, i) => {
            const color = LAYER_COLORS[i % LAYER_COLORS.length];
            const isActive = activeAov === row.name;
            const interactive = typeof onAovChange === "function";
            const baseClass =
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border";
            const stateClass = isActive
              ? "border-[var(--color-ah-accent)] text-[var(--color-ah-text)] bg-[var(--color-ah-bg-raised)]"
              : "border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]";
            const interactiveClass = interactive
              ? "cursor-pointer hover:text-[var(--color-ah-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
              : "";

            const dot = (
              <span
                aria-hidden="true"
                data-testid="asset-header-bar-pill-dot"
                className="w-1.5 h-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
            );

            if (!interactive) {
              return (
                <span
                  key={row.name}
                  className={`${baseClass} ${stateClass}`}
                  tabIndex={-1}
                >
                  {dot}
                  {row.name}
                </span>
              );
            }

            return (
              <button
                key={row.name}
                type="button"
                aria-pressed={isActive}
                className={`${baseClass} ${stateClass} ${interactiveClass}`}
                onClick={() => onAovChange!(isActive ? null : row.name)}
              >
                {dot}
                {row.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
