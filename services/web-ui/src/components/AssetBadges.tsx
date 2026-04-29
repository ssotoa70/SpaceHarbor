/**
 * AssetBadges — top-of-panel chip row that surfaces structural and QC
 * signals an artist needs to see WITHOUT scrolling. Per the workflow
 * agent's review: "an artist should never have to open the panel to
 * find out a QC gate failed."
 *
 * Badge taxonomy:
 *   - DEEP            — any part is_deep=true (deep EXR, volumetric data)
 *   - STEREO          — multi_view + view_name set (left/right or named)
 *   - MULTIPART (N)   — parts.length > 1 (different render passes split)
 *   - ANAMORPHIC      — pixel_aspect_ratio differs from 1.0
 *   - BROADCAST       — container is MXF (op_pattern surface in section)
 *   - QC: APPROVED    — asset.qcStatus === "approved"
 *   - QC: PENDING     — asset.qcStatus === "pending"
 *   - QC: FLAGGED     — asset.qcStatus === "flagged"
 *   - QC: FAILED      — asset.qcStatus === "failed"
 *
 * Badges hide entirely when their signal is absent. Order: structural
 * left-aligned (DEEP/STEREO/MULTIPART/ANAMORPHIC/BROADCAST), QC
 * right-aligned via a flex spacer.
 */

import type { ReactNode } from "react";

import type { AssetMetadataResponse } from "../api";
import type { AssetRow } from "../types";
import { extractFrameFields } from "./metadata/frame-fields-extractor";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

interface BadgeSpec {
  id: string;
  label: string;
  tone: BadgeTone;
  /** Optional title attribute for hover-explainer. */
  hint?: string;
}

interface AssetBadgesProps {
  asset: AssetRow;
  metadata: AssetMetadataResponse | null | undefined;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-[var(--color-ah-bg-raised)] border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]",
  info:    "bg-cyan-500/10 border-cyan-500/30 text-cyan-300",
  success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  danger:  "bg-red-500/10 border-red-500/30 text-red-300",
};

export function AssetBadges({ asset, metadata }: AssetBadgesProps): ReactNode {
  const structural = computeStructuralBadges(metadata);
  const qc = computeQcBadge(asset);

  if (structural.length === 0 && !qc) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5" data-testid="asset-badges">
      {structural.map((b) => (
        <Badge key={b.id} spec={b} />
      ))}
      {qc && (
        <>
          <div className="flex-1" />
          <Badge spec={qc} />
        </>
      )}
    </div>
  );
}

function Badge({ spec }: { spec: BadgeSpec }): ReactNode {
  return (
    <span
      title={spec.hint}
      data-badge-id={spec.id}
      className={`px-1.5 py-[2px] rounded border text-[9px] font-[var(--font-ah-mono)] font-medium tracking-[0.08em] uppercase ${TONE_CLASS[spec.tone]}`}
    >
      {spec.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pure derivation helpers (exported for unit tests).
// ─────────────────────────────────────────────────────────────────────────

export function computeStructuralBadges(
  metadata: AssetMetadataResponse | null | undefined,
): BadgeSpec[] {
  if (!metadata) return [];
  const out: BadgeSpec[] = [];
  const fields = extractFrameFields(metadata);
  const parts = metadata.dbExtras?.parts ?? [];
  const sidecar = (metadata.sidecar as Record<string, unknown> | null) ?? null;
  const sidecarMeta = (sidecar?.metadata as Record<string, unknown> | undefined) ?? null;

  // DEEP — any part marked deep, OR top-level is_deep flag.
  const hasDeepPart = parts.some((p) => p.is_deep === true);
  if (fields.is_deep === true || hasDeepPart) {
    out.push({ id: "deep", label: "Deep", tone: "info", hint: "Deep EXR — volumetric data; different load workflow in Nuke." });
  }

  // STEREO — multi_view on any part, OR view_name set on multiple parts.
  const stereo = parts.some((p) => p.multi_view === true) || fields.multi_view === true;
  if (stereo) {
    const views = parts.map((p) => p.view_name).filter((v): v is string => typeof v === "string" && v.length > 0);
    const label = views.length > 0 ? `Stereo (${views.join("/")})` : "Stereo";
    out.push({ id: "stereo", label, tone: "info", hint: "Multi-view file (likely stereo left/right)." });
  }

  // MULTIPART — parts.length > 1.
  if (parts.length > 1) {
    out.push({
      id: "multipart",
      label: `Multipart (${parts.length} parts)`,
      tone: "neutral",
      hint: "Multi-part EXR — render passes split across parts.",
    });
  }

  // ANAMORPHIC — pixel_aspect_ratio meaningfully off from 1.0.
  if (typeof fields.pixel_aspect_ratio === "number" && Math.abs(fields.pixel_aspect_ratio - 1.0) > 0.01) {
    out.push({
      id: "anamorphic",
      label: `Anamorphic ${fields.pixel_aspect_ratio}:1`,
      tone: "warning",
      hint: "Non-square pixel aspect ratio — verify before scaling.",
    });
  }

  // BROADCAST — MXF container.
  const container =
    typeof sidecarMeta?.container_format === "string"
      ? (sidecarMeta.container_format as string)
      : typeof sidecar?.container_format === "string"
      ? (sidecar.container_format as string)
      : undefined;
  if (container && /mxf/i.test(container)) {
    out.push({
      id: "broadcast",
      label: "Broadcast",
      tone: "neutral",
      hint: `${container} container — broadcast/QC delivery format.`,
    });
  }

  return out;
}

/**
 * QC status comes from asset.qcStatus (placeholder for now). Returns null
 * when the field is absent — we never default-show "Pending" because
 * that would mislead users into thinking QC is active.
 */
export function computeQcBadge(asset: AssetRow): BadgeSpec | null {
  const status = (asset as AssetRow & { qcStatus?: string }).qcStatus;
  if (!status) return null;
  switch (status.toLowerCase()) {
    case "approved":
      return { id: "qc-approved", label: "QC Approved", tone: "success" };
    case "pending":
      return { id: "qc-pending", label: "QC Pending", tone: "neutral" };
    case "flagged":
      return { id: "qc-flagged", label: "QC Flagged", tone: "warning" };
    case "failed":
      return { id: "qc-failed", label: "QC Failed", tone: "danger" };
    default:
      return { id: `qc-${status}`, label: `QC ${status}`, tone: "neutral" };
  }
}
