/**
 * AovLayerMapTable — the "AOV Layer Map" view in the AOVS tab.
 *
 * Reads dbExtras.channels (from frame_metadata.channels) and groups by
 * layer_name. Each group renders as one row with:
 *   - LAYER name + a deterministic color dot
 *   - CHANNELS components (e.g. "RGB", "XYZ", "UV")
 *   - DEPTH (16f / 32f / mixed)
 *   - SIZE (uncompressed_bytes — when populated, otherwise null/blank)
 *
 * Switches from <table> to a card layout in narrow containers
 * (≤ 480px) per the UX agent's recommendation.
 *
 * When dbExtras.aovs is populated (future state — not in cluster today),
 * the renderer prefers the canonical AOV rollup over channel-derived
 * grouping. Until aovs[] ships, channels[] is the source of truth.
 */

import { useMemo, type ReactNode } from "react";

import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { depthLabelFromChannelType } from "./metadata/frame-fields-extractor";
import { formatFileSize } from "./metadata/formatters";
import type { AssetRow } from "../types";

// Deterministic color per layer index. Mirrors the user's mockup palette.
const LAYER_COLORS = [
  "#a855f7", "#06b6d4", "#f59e0b", "#22c55e", "#ec4899", "#3b82f6", "#ef4444", "#8b5cf6",
];

interface LayerRow {
  /** layer_name from channels[], or aov.name when aovs[] is populated. */
  name: string;
  /** Concatenated component letters (e.g. "RGB", "Z", "XYZ"). */
  channels: string;
  /** Compact depth label (16f / 32f / 8u) or "mixed (32f/16f)". */
  depth: string | null;
  /** Total uncompressed bytes for this layer, when known. */
  sizeBytes: number | null;
  /** Category badge (beauty / utility / matte / crypto / ...) when aovs[] is present. */
  category?: string;
}

interface AovLayerMapTableProps {
  asset: AssetRow;
}

export function AovLayerMapTable({ asset }: AovLayerMapTableProps): ReactNode {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : null;

  const rows = useMemo(() => buildLayerRows(metadata), [metadata]);

  if (result.status === "loading") {
    return (
      <div className="p-4 text-xs text-[var(--color-ah-text-subtle)]">Loading AOV layer map…</div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="p-4 text-xs text-red-400">
        Failed to load AOV map: {result.error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--color-ah-text-subtle)]" data-testid="aov-empty">
        No AOV layer data available. The frame-metadata-extractor hasn&apos;t
        produced channels / aovs rows for this asset yet — re-run the
        pipeline to populate.
      </div>
    );
  }

  return (
    <div className="@container px-4 py-3" data-testid="aov-layer-map">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-ah-text)]">AOV Layer Map</h3>
        <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-accent)] tracking-wide">
          {rows.length} {rows.length === 1 ? "LAYER" : "LAYERS"}
        </span>
      </div>

      {/* Wide-container table view. Hidden in cramped containers. */}
      <table className="hidden @[480px]:table w-full text-[11px]">
        <thead>
          <tr className="text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)] text-[9px] tracking-[0.14em] uppercase">
            <th className="text-left py-1 font-medium">Layer</th>
            <th className="text-left py-1 font-medium">Channels</th>
            <th className="text-left py-1 font-medium">Depth</th>
            <th className="text-right py-1 font-medium">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name} className="border-t border-[var(--color-ah-border-muted)]">
              <td className="py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: LAYER_COLORS[i % LAYER_COLORS.length] }}
                    aria-hidden
                  />
                  <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">{row.name}</span>
                  {row.category && (
                    <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)] uppercase tracking-wide">
                      {row.category}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-1.5 font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{row.channels}</td>
              <td className="py-1.5 font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{row.depth ?? "—"}</td>
              <td className="py-1.5 font-[var(--font-ah-mono)] text-right text-[var(--color-ah-text-muted)]">
                {row.sizeBytes != null ? formatFileSize(row.sizeBytes) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow-container card view. */}
      <div className="@[480px]:hidden flex flex-col gap-2">
        {rows.map((row, i) => (
          <div
            key={row.name}
            className="border border-[var(--color-ah-border-muted)] rounded p-2.5 bg-[var(--color-ah-bg-raised)]"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: LAYER_COLORS[i % LAYER_COLORS.length] }}
                aria-hidden
              />
              <span className="font-[var(--font-ah-mono)] text-[12px] font-medium text-[var(--color-ah-text)]">{row.name}</span>
              {row.category && (
                <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)] uppercase tracking-wide ml-auto">
                  {row.category}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] font-[var(--font-ah-mono)]">
              <dt className="text-[var(--color-ah-text-subtle)]">Channels</dt>
              <dd className="text-[var(--color-ah-text-muted)]">{row.channels}</dd>
              <dt className="text-[var(--color-ah-text-subtle)]">Depth</dt>
              <dd className="text-[var(--color-ah-text-muted)]">{row.depth ?? "—"}</dd>
              {row.sizeBytes != null && (
                <>
                  <dt className="text-[var(--color-ah-text-subtle)]">Size</dt>
                  <dd className="text-[var(--color-ah-text-muted)]">{formatFileSize(row.sizeBytes)}</dd>
                </>
              )}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pure derivation (exported for unit tests).
// ─────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Build the layer-row list from the unified metadata response.
 *
 * Priority:
 *   1. dbExtras.aovs  — canonical rollup; one row per AOV.
 *   2. dbExtras.channels — fallback when aovs[] is absent. Group by
 *      layer_name; render as one row per layer.
 *   3. neither — empty.
 */
export function buildLayerRows(metadata: { dbExtras?: { aovs?: Row[]; channels?: Row[] } } | null): LayerRow[] {
  if (!metadata) return [];
  const aovs = metadata.dbExtras?.aovs;
  if (aovs && aovs.length > 0) {
    return aovs.map((a) => ({
      name: asString(a.name) ?? "(unnamed)",
      channels: asString(a.components) ?? asString(a.channel_group) ?? "—",
      depth: asString(a.depth_label) ?? null,
      sizeBytes: asNumber(a.uncompressed_bytes) ?? null,
      category: asString(a.category),
    }));
  }
  return groupChannelsByLayer(metadata.dbExtras?.channels);
}

function groupChannelsByLayer(channels: readonly Row[] | undefined): LayerRow[] {
  if (!channels || channels.length === 0) return [];
  const byLayer = new Map<string, Row[]>();
  for (const ch of channels) {
    const layer = asString(ch.layer_name) ?? "(root)";
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(ch);
  }
  const out: LayerRow[] = [];
  for (const [layer, group] of byLayer) {
    const components = group
      .map((c) => asString(c.component_name) ?? asString(c.channel_name))
      .filter((s): s is string => Boolean(s))
      .join("");
    const depth = depthRollup(group);
    out.push({
      name: layer,
      channels: components || "—",
      depth,
      sizeBytes: null, // channels[] doesn't carry per-layer size; only aovs[] does
    });
  }
  return out;
}

function depthRollup(channels: readonly Row[]): string | null {
  const types = channels
    .map((c) => asString(c.channel_type) ?? asString(c.type))
    .filter((t): t is string => Boolean(t));
  if (types.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 1) return depthLabelFromChannelType(types[0]) ?? null;
  const dominant = [...counts.entries()].sort(([, a], [, b]) => b - a)[0][0];
  const label = depthLabelFromChannelType(dominant);
  return label ? `${label} (mixed)` : null;
}
