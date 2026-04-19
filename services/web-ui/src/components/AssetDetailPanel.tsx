import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Skeleton } from "../design-system";
import {
  fetchVersionDetail,
  devAdvanceAsset,
  type VersionDetailInfo,
  type VersionDetailHistoryEvent,
  type ExrAttributeMetadata,
  type ExrFileMetadata,
  type ExrPartMetadata,
  type ExrChannelMetadata,
} from "../api";
import type { AssetRow } from "../types";
import { formatTC } from "../utils/timecode";
import { formatFileSize, formatDuration, inferMediaType } from "../utils/media-types";
import { useStorageSidecar } from "../hooks/useStorageSidecar";
import {
  useDataEnginePipelines,
  findPipelineForFilename,
} from "../hooks/useDataEnginePipelines";
import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { VideoMetadataRenderer, detectSchema } from "./metadata";
import { ChannelPills } from "./ChannelPills";

// ---------------------------------------------------------------------------
// Local alias — shape-compatible with the former ExrMetadataLookupResult.
// Uses the same sub-types exported from api.ts so all field accesses type-
// check. Kept as a separate local alias so we don't re-export a transitional
// type from api.ts.
// ---------------------------------------------------------------------------

type ExrChannel = ExrChannelMetadata;
type ExrPart = ExrPartMetadata;
type ExrFile = ExrFileMetadata;
interface ExrSummary {
  resolution: string;
  compression: string;
  colorSpace: string;
  channelCount: number;
  isDeep: boolean;
  frameNumber: number | null;
}
interface ExrMetadataLookupResultLike {
  found: boolean;
  channels: ExrChannel[];
  parts: ExrPart[];
  summary?: ExrSummary;
  file?: ExrFile;
  attributes?: ExrAttributeMetadata[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "metadata" | "info" | "aovs" | "streams" | "vast" | "history";

interface AssetDetailPanelProps {
  asset: AssetRow;
  onClose: () => void;
  /** [DEV ONLY] Called after a successful dev-advance so the parent can
   *  refresh the asset list and update its local state. */
  onAdvanced?: (updatedAsset: AssetRow) => void;
}

// ---------------------------------------------------------------------------
// Status mapping (VFX-industry labels)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: "WIP", processing: "Rendering", qc_pending: "Review",
  qc_in_review: "Review", qc_approved: "Approved", published: "Published",
  retake: "Retake", completed: "Completed", failed: "Failed",
  draft: "WIP", review: "Review", approved: "Approved", rejected: "Retake",
};

const STATUS_COLORS: Record<string, string> = {
  WIP: "#06b6d4", Rendering: "#06b6d4", Review: "#eab308",
  Approved: "#22c55e", Published: "#22c55e", Retake: "#ef4444",
  Completed: "#22c55e", Failed: "#ef4444",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mediaTypeLabel(t: string): string {
  const map: Record<string, string> = {
    exr_sequence: "EXR", mov: "MOV", dpx: "DPX", audio: "AUDIO",
    vdb: "VDB", usd: "USD", plate: "PLATE", mtlx: "MTLX",
  };
  return map[t] ?? t.toUpperCase();
}

function resolutionTag(w: number | null, h: number | null): string | null {
  if (!w || !h) return null;
  if (w >= 7680) return `${w} \u00d7 ${h} (8K)`;
  if (w >= 3840) return `${w} \u00d7 ${h} (4K)`;
  if (w >= 2048) return `${w} \u00d7 ${h} (2K)`;
  if (w >= 1920) return `${w} \u00d7 ${h} (HD)`;
  return `${w} \u00d7 ${h}`;
}

function bitDepthLabel(bd: number | null): string | null {
  if (!bd) return null;
  return bd >= 32 ? `${bd}-bit float` : `${bd}-bit`;
}

function channelLabel(count: number | null): string | null {
  if (!count) return null;
  if (count > 3) return `Multi-ch (${count} AOVs)`;
  if (count === 3) return "RGB";
  if (count === 4) return "RGBA";
  return String(count);
}

// ---------------------------------------------------------------------------
// Section header — mockup style: MONOSPACE UPPERCASE with horizontal rule
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mt-4 mb-2">
      <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--color-ah-text-subtle)] uppercase whitespace-nowrap">
        {title}
      </span>
      <div className="flex-1 h-px bg-[var(--color-ah-border-muted)]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — expandable group with count badge
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, count, defaultOpen = false, children }: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 py-1.5 cursor-pointer"
      >
        <span className="text-[10px] text-[var(--color-ah-text-subtle)] transition-transform" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          &#9654;
        </span>
        <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--color-ah-text-subtle)] uppercase whitespace-nowrap">
          {title}
        </span>
        {count != null && (
          <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)]">
            ({count})
          </span>
        )}
        <div className="flex-1 h-px bg-[var(--color-ah-border-muted)]" />
      </button>
      {open && <div className="ml-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaRow — left label, right value, monospace
// ---------------------------------------------------------------------------

function MetaRow({ label, value, accent, copyable }: {
  label: string;
  value: string | number | undefined | null;
  accent?: boolean;
  copyable?: boolean;
}) {
  if (value == null || value === "") return null;
  const display = String(value);
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">{label}</dt>
      <dd className={`text-[11px] font-[var(--font-ah-mono)] text-right truncate flex items-center gap-1 ${
        accent ? "text-[var(--color-ah-accent)]" : "text-[var(--color-ah-text)]"
      }`}>
        <span className="truncate">{display}</span>
        {copyable && <CopyBtn value={display} />}
      </dd>
    </div>
  );
}

function StatusRow({ label, statusLabel }: { label: string; statusLabel: string }) {
  const color = STATUS_COLORS[statusLabel] ?? "#94a3b8";
  return (
    <div className="flex items-center justify-between gap-3 py-[3px]">
      <dt className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[11px] font-[var(--font-ah-mono)]">
        <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span style={{ color }}>{statusLabel}</span>
      </dd>
    </div>
  );
}

function copyToClipboard(text: string): boolean {
  // Prefer modern clipboard API (requires secure context)
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  // Fallback for HTTP: use a temporary textarea
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); return true; } catch { return false; }
  finally { document.body.removeChild(ta); }
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (copyToClipboard(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [value]);
  return (
    <button type="button" onClick={handleCopy}
      className="text-[9px] text-[var(--color-ah-accent)] hover:text-[var(--color-ah-text)] transition-colors shrink-0 cursor-pointer"
      aria-label={`Copy ${value}`}
    >{copied ? "Copied" : "Copy"}</button>
  );
}

// ---------------------------------------------------------------------------
// Tag pills
// ---------------------------------------------------------------------------

function TagPills({ asset, info }: { asset: AssetRow; info: VersionDetailInfo }) {
  const v = info.version;
  const tags: string[] = [];

  // Derive tags from real queryable data
  const mt = inferMediaType(asset.title, asset.sourceUri);
  if (mt) tags.push(mt);
  if (v.colorSpace) tags.push(v.colorSpace.toLowerCase());
  if (v.versionLabel) tags.push(v.versionLabel);
  if (asset.productionMetadata?.sequence) tags.push(asset.productionMetadata.sequence);
  if (asset.productionMetadata?.shot) tags.push(asset.productionMetadata.shot);

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel header — mockup: "{ShotCode} {Name} · {Type}" + close
// ---------------------------------------------------------------------------

function PanelHeader({ asset, info, onClose }: {
  asset: AssetRow;
  info: VersionDetailInfo | null;
  onClose: () => void;
}) {
  const v = info?.version;
  const shotCode = asset.productionMetadata?.shot;
  const typeLabel = v ? mediaTypeLabel(v.mediaType) : inferMediaType(asset.title, asset.sourceUri).toUpperCase();
  const titleParts = [shotCode, asset.title.replace(/\.[^.]+$/, "")].filter(Boolean);

  return (
    <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--color-ah-border)]">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-[var(--color-ah-text)] truncate">
          {titleParts.join(" ")} <span className="text-[var(--color-ah-text-subtle)] font-normal">&middot; {typeLabel}</span>
        </h2>
      </div>
      <button type="button" onClick={onClose}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer text-lg leading-none"
        aria-label="Close detail panel"
      >&times;</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame counter bar — mockup: "Frame 1001 of 1240   01:00:04:01"
// ---------------------------------------------------------------------------

function FrameBar({ info }: { info: VersionDetailInfo | null }) {
  const v = info?.version;
  if (!v?.frameRangeStart || !v?.frameRangeEnd) return null;
  const fps = v.frameRate ?? 24;
  const tc = formatTC(v.frameRangeEnd / fps, fps);
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg)]">
      <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-muted)]">
        Frame {v.frameRangeStart} of {v.frameRangeEnd}
      </span>
      <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-subtle)]">
        {tc}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type TabDef = { id: TabId; label: string };

function getTabsForMediaType(mediaType: string): TabDef[] {
  const base: TabDef[] = [];
  // "Metadata" is the primary view — rich sidecar payload from
  // frame-metadata-extractor (images) or video-metadata-extractor (video/raw).
  // Rendered only for media types whose extractor writes a sidecar; other
  // kinds (audio, documents, 3D, etc.) skip this tab and start on INFO.
  if (mediaType === "image" || mediaType === "video" || mediaType === "raw") {
    base.push({ id: "metadata", label: "METADATA" });
  }
  base.push({ id: "info", label: "INFO" });
  if (mediaType === "image") {
    base.push({ id: "aovs", label: "AOVS" });
  } else if (mediaType === "video" || mediaType === "audio") {
    base.push({ id: "streams", label: "STREAMS" });
  }
  base.push({ id: "vast", label: "VAST" });
  base.push({ id: "history", label: "HISTORY" });
  return base;
}

function TabBar({ activeTab, onTabChange, tabs }: { activeTab: TabId; onTabChange: (t: TabId) => void; tabs: TabDef[] }) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (e.key === "ArrowRight") { e.preventDefault(); onTabChange(tabs[(idx + 1) % tabs.length].id); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onTabChange(tabs[(idx - 1 + tabs.length) % tabs.length].id); }
  }, [activeTab, onTabChange, tabs]);

  return (
    <div role="tablist" aria-label="Detail panel tabs" className="flex border-b border-[var(--color-ah-border)]" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        return (
          <button key={tab.id} role="tab" type="button"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 px-2 py-2.5 text-[10px] font-medium tracking-[0.08em] cursor-pointer transition-colors ${
              activeTab === tab.id
                ? "text-[var(--color-ah-accent)] border-b-2 border-[var(--color-ah-accent)]"
                : "text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text-muted)]"
            }`}
          >{tab.label}</button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetadataTab helpers
// ---------------------------------------------------------------------------

type FieldFamily = "Dimensions" | "Codec & color" | "Timing" | "File" | "Other";

const FAMILY_PATTERNS: [FieldFamily, RegExp][] = [
  ["Dimensions",    /^(width|height|channels|bit_depth|pixel_aspect|display_window|data_window)$/i],
  ["Codec & color", /^(codec|pix_fmt|color_space|transfer|primaries|chroma|profile|level|bit_rate)$/i],
  ["Timing",        /^(duration|frame_count|frame_rate|fps|timecode|start_frame|end_frame)$/i],
  ["File",          /^(path|filename|size|sha256|md5|etag|mtime|created_at|modified_at|source_uri|s3_key|file_path|uri)$/i],
];

export function groupColumns(row: Record<string, unknown>): Record<FieldFamily, [string, unknown][]> {
  const groups: Record<FieldFamily, [string, unknown][]> = {
    "Dimensions": [], "Codec & color": [], "Timing": [], "File": [], "Other": [],
  };
  for (const [key, value] of Object.entries(row)) {
    const family = FAMILY_PATTERNS.find(([, re]) => re.test(key))?.[0] ?? "Other";
    groups[family].push([key, value]);
  }
  groups["Other"].sort(([a], [b]) => a.localeCompare(b));
  return groups;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return "<unserializable>"; }
}

function DbRowCard({ row, index }: { row: Record<string, unknown>; index: number }) {
  const groups = groupColumns(row);
  return (
    <div className="p-2 rounded border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] mb-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-ah-text-subtle)] mb-1">Row {index}</div>
      {(Object.entries(groups) as [FieldFamily, [string, unknown][]][]).map(([family, rows]) =>
        rows.length === 0 ? null : (
          <div key={family} className="mb-2 last:mb-0">
            <div className="text-[10px] text-[var(--color-ah-text-muted)] mb-1">{family}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {rows.map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{key}</dt>
                  <dd className="font-[var(--font-ah-mono)] break-all">{formatCell(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetadataTab — reads from /assets/:id/metadata (DB + sidecar unified endpoint)
// ---------------------------------------------------------------------------

export function MetadataTab({ asset }: { asset: AssetRow }) {
  const metadata = useAssetMetadata(asset.id);
  const { pipelines } = useDataEnginePipelines();
  const matchedPipeline = findPipelineForFilename(pipelines, asset.title);

  if (metadata.status === "loading") {
    return <div className="p-3 text-sm text-[var(--color-ah-text-muted)]">Loading…</div>;
  }
  if (metadata.status === "error") {
    return (
      <div className="p-3 text-sm text-red-400">
        Failed to load metadata: {metadata.error ?? "unknown error"}
      </div>
    );
  }
  if (metadata.status !== "ready" || !metadata.data) {
    // idle (no asset id) — matches parent behavior; shouldn't normally appear here.
    return null;
  }
  const data = metadata.data;

  const badgeVariant = (s: string) =>
    s === "ok" ? "success" : s === "empty" ? "default" : s === "missing" ? "default"
      : s === "disabled" ? "default" : "warning";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={badgeVariant(data.sources.db)}>DB · {data.sources.db}</Badge>
        <Badge variant={badgeVariant(data.sources.sidecar)}>Sidecar · {data.sources.sidecar}</Badge>
        {data.pipeline && (
          <span className="text-[var(--color-ah-text-muted)] font-[var(--font-ah-mono)]">
            {data.pipeline.functionName}
          </span>
        )}
      </div>

      {data.dbError && (
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
          DB unreachable: {data.dbError}
        </div>
      )}

      {data.dbRows.length > 0 && (
        <section aria-label="Database fields">
          <h4 className="text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider mb-1">
            Database ({data.dbRows.length} row{data.dbRows.length === 1 ? "" : "s"})
          </h4>
          {data.dbRows.map((row, i) => (
            <DbRowCard key={i} row={row} index={i + 1} />
          ))}
        </section>
      )}

      {data.sidecar && (
        <section aria-label="Sidecar fields">
          <h4 className="text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider mb-1">Sidecar</h4>
          <pre className="p-2 rounded bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] font-[var(--font-ah-mono)] text-xs overflow-auto max-h-80">
            {JSON.stringify(data.sidecar, null, 2)}
          </pre>
        </section>
      )}

      {data.sources.db !== "ok" && !data.sidecar && (
        <p className="text-xs text-[var(--color-ah-text-muted)]">
          {matchedPipeline
            ? `No metadata yet — ${matchedPipeline.config.functionName} has not produced output for this asset.`
            : "No metadata pipeline is configured for this file kind."}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoTab — matches mockup layout exactly
// ---------------------------------------------------------------------------

function InfoTab({
  info,
  asset,
  exrMeta,
  onAdvanced,
}: {
  info: VersionDetailInfo | null;
  asset: AssetRow;
  exrMeta?: ExrMetadataLookupResultLike | null;
  onAdvanced?: (updatedAsset: AssetRow) => void;
}) {
  // When no version detail is available (asset ingested without VFX hierarchy),
  // show data from the asset record + rich metadata from the frame-metadata-extractor pipeline.
  if (!info && !asset.currentVersionId) {
    const mt = inferMediaType(asset.title, asset.sourceUri);
    const statusLabel = STATUS_LABELS[asset.status] ?? asset.status;
    const exr = exrMeta?.found ? exrMeta : null;
    const summary = exr?.summary;
    const firstPart = exr?.parts?.[0] ?? null;
    const prod = asset.productionMetadata;

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto px-4 pb-4">
          <div className="mt-3 mb-1">
            <h3 className="text-[13px] font-semibold text-[var(--color-ah-text)] truncate">{asset.title}</h3>
            <p className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-accent)] tracking-wide mt-0.5">
              {mt.toUpperCase()}{summary ? " SEQUENCE" : " FILE"}
              {prod?.sequence || prod?.shot
                ? ` \u00b7 ${[prod.sequence, prod.shot].filter(Boolean).join(" / ")}`
                : ""}
            </p>
          </div>

          {/* ════════════════════════════════════════════════════════════
              VIDEO / AUDIO — codec, streams, timecode
              ════════════════════════════════════════════════════════════ */}
          {(mt === "video" || mt === "audio") && (
            <>
              <SectionHeader title="Video" />
              <dl>
                <MetaRow label="Codec" value={asset.metadata?.codec} accent />
                {asset.metadata?.resolution && (
                  <MetaRow label="Resolution" value={`${asset.metadata.resolution.width}\u00d7${asset.metadata.resolution.height}`} />
                )}
                <MetaRow label="Frame Rate" value={asset.metadata?.frame_rate ? `${asset.metadata.frame_rate} fps` : null} />
                {asset.metadata?.frame_range && asset.metadata?.frame_rate && (
                  <MetaRow label="Duration" value={formatDuration((asset.metadata.frame_range.end - asset.metadata.frame_range.start + 1) / asset.metadata.frame_rate)} />
                )}
                <MetaRow label="Bit Depth" value={asset.metadata?.bit_depth ? bitDepthLabel(asset.metadata.bit_depth) : null} />
                <MetaRow label="Compression" value={asset.metadata?.compression_type} />
                <MetaRow label="Pixel Aspect" value={asset.metadata?.pixel_aspect_ratio != null && asset.metadata.pixel_aspect_ratio !== 1 ? String(asset.metadata.pixel_aspect_ratio) : null} />
              </dl>

              {asset.metadata?.color_space && (
                <>
                  <SectionHeader title="Color" />
                  <dl>
                    <MetaRow label="Color Space" value={asset.metadata.color_space} accent />
                  </dl>
                </>
              )}

              {asset.metadata?.channels && asset.metadata.channels.length > 0 && (
                <>
                  <SectionHeader title="Audio" />
                  <dl>
                    <MetaRow label="Channels" value={asset.metadata.channels.join(", ")} />
                  </dl>
                </>
              )}
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              IMAGE / EXR — sequence info, color science, technical
              ════════════════════════════════════════════════════════════ */}
          {mt !== "video" && mt !== "audio" && (
            <>
              <SectionHeader title="Image" />
              <dl>
                {summary?.frameNumber != null && (
                  <MetaRow label="Frame" value={String(summary.frameNumber)} />
                )}
                <MetaRow label="Resolution" value={summary?.resolution !== "unknown" ? summary?.resolution : null} />
                <MetaRow label="Channels" value={summary?.channelCount ? channelLabel(summary.channelCount) : null} accent={!!summary?.channelCount && summary.channelCount > 3} />
                <MetaRow label="Compression" value={summary?.compression !== "unknown" ? summary?.compression : null} />
                {summary?.isDeep && <MetaRow label="Type" value="Deep EXR" accent />}
                {exr?.file?.size_bytes && <MetaRow label="File Size" value={formatFileSize(exr.file.size_bytes)} />}
                {exr?.file?.multipart_count && exr.file.multipart_count > 1 && (
                  <MetaRow label="Parts" value={String(exr.file.multipart_count)} />
                )}
              </dl>

              {/* COLOR SCIENCE */}
              {(summary?.colorSpace && summary.colorSpace !== "unknown") && (
                <>
                  <SectionHeader title="Color Science" />
                  <dl>
                    <MetaRow label="Color Space" value={summary.colorSpace} accent />
                    {/* Pull chromaticities and related from header attributes */}
                    {exr?.attributes?.filter((a) =>
                      ["chromaticities", "whiteLuminance", "adoptedNeutral", "renderingTransform", "lookModTransform", "acesImageContainerFlag"].some(
                        (k) => a.attr_name.toLowerCase().includes(k.toLowerCase())
                      )
                    ).map((a) => (
                      <MetaRow key={a.attr_name} label={a.attr_name} value={attrDisplayValue(a)} />
                    ))}
                  </dl>
                </>
              )}

              {/* TECHNICAL — display/data windows, render info, tiling */}
              {firstPart && (
                <>
                  <SectionHeader title="Technical" />
                  <dl>
                    <MetaRow label="Display Window" value={firstPart.display_window ?? (firstPart.display_width ? `${firstPart.display_width}\u00d7${firstPart.display_height}` : null)} />
                    <MetaRow label="Data Window" value={firstPart.data_window ?? (firstPart.data_x_offset != null ? `offset ${firstPart.data_x_offset}, ${firstPart.data_y_offset}` : null)} />
                    <MetaRow label="Pixel Aspect" value={firstPart.pixel_aspect_ratio != null && firstPart.pixel_aspect_ratio !== 1 ? String(firstPart.pixel_aspect_ratio) : null} />
                    <MetaRow label="Line Order" value={firstPart.line_order} />
                    {firstPart.is_tiled && (
                      <MetaRow label="Tiling" value={`${firstPart.tile_width ?? "?"}x${firstPart.tile_height ?? "?"}${firstPart.tile_depth ? ` (${firstPart.tile_depth})` : ""}`} />
                    )}
                    {firstPart.multi_view && <MetaRow label="Multi-View" value="Yes" accent />}
                  </dl>
                </>
              )}

              {/* RENDER — software, DCC, hostname */}
              {(firstPart?.render_software || exr?.attributes?.some((a) =>
                ["Software", "renderer", "hostname", "oiio", "driverVersion"].some((k) => a.attr_name.toLowerCase().includes(k.toLowerCase()))
              )) && (
                <>
                  <SectionHeader title="Render" />
                  <dl>
                    <MetaRow label="Software" value={firstPart?.render_software} accent />
                    {exr?.attributes?.filter((a) =>
                      ["Software", "hostname", "oiio:ColorSpace", "DateTime"].some(
                        (k) => a.attr_name === k
                      )
                    ).map((a) => (
                      <MetaRow key={a.attr_name} label={a.attr_name} value={attrDisplayValue(a)} />
                    ))}
                  </dl>
                </>
              )}

              {/* CAMERA — lens, exposure, etc. (from EXR header attributes) */}
              {exr?.attributes && exr.attributes.some((a) =>
                ["camera", "lens", "focalLength", "aperture", "focus", "exposure", "isoSpeed"].some(
                  (k) => a.attr_name.toLowerCase().includes(k.toLowerCase())
                )
              ) && (
                <>
                  <SectionHeader title="Camera" />
                  <dl>
                    {exr.attributes.filter((a) =>
                      ["camera", "lens", "focalLength", "aperture", "focus", "exposure", "isoSpeed", "shutterAngle"].some(
                        (k) => a.attr_name.toLowerCase().includes(k.toLowerCase())
                      )
                    ).map((a) => (
                      <MetaRow key={a.attr_name} label={a.attr_name} value={attrDisplayValue(a)} />
                    ))}
                  </dl>
                </>
              )}

              {/* EXR HEADER ATTRIBUTES — remaining attributes, collapsible */}
              {exr?.attributes && exr.attributes.length > 0 && (() => {
                // Filter out attrs already shown in Color Science, Render, Camera sections
                const shownKeys = new Set([
                  "chromaticities", "whiteLuminance", "adoptedNeutral", "renderingTransform",
                  "lookModTransform", "acesImageContainerFlag",
                  "Software", "hostname", "oiio:ColorSpace", "DateTime",
                  "camera", "lens", "focalLength", "aperture", "focus", "exposure",
                  "isoSpeed", "shutterAngle",
                ]);
                const remaining = exr.attributes.filter((a) =>
                  !shownKeys.has(a.attr_name) && ![...shownKeys].some((k) => a.attr_name.toLowerCase().includes(k.toLowerCase()))
                );
                if (remaining.length === 0) return null;
                return (
                  <CollapsibleSection title="EXR Header" count={remaining.length}>
                    <dl>
                      {remaining.map((a) => (
                        <MetaRow key={a.attr_name} label={a.attr_name} value={attrDisplayValue(a)} />
                      ))}
                    </dl>
                  </CollapsibleSection>
                );
              })()}
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              PRODUCTION — always shown
              ════════════════════════════════════════════════════════════ */}
          <SectionHeader title="Production" />
          <dl>
            <MetaRow label="Project" value={prod?.show} />
            <MetaRow label="Sequence" value={prod?.sequence} />
            <MetaRow label="Shot" value={prod?.shot} accent />
            <StatusRow label="Status" statusLabel={statusLabel} />
            {asset.metadata?.file_size_bytes != null && (
              <MetaRow label="Size" value={formatFileSize(asset.metadata.file_size_bytes)} />
            )}
            {asset.createdAt && <MetaRow label="Ingested" value={new Date(asset.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })} />}
          </dl>

          {/* ════════════════════════════════════════════════════════════
              STORAGE — identifiers and paths
              ════════════════════════════════════════════════════════════ */}
          <SectionHeader title="Storage" />
          <dl>
            <MetaRow label="Source" value={asset.sourceUri} copyable />
            <MetaRow label="Asset ID" value={asset.id} copyable />
            {asset.jobId && <MetaRow label="Job ID" value={asset.jobId} copyable />}
            {exr?.file?.file_id && <MetaRow label="EXR File ID" value={String(exr.file.file_id)} copyable />}
          </dl>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 border-t border-[var(--color-ah-border)] p-3 space-y-2 bg-[var(--color-ah-bg-raised)]">
          <button type="button"
            onClick={() => window.open(`rvlink://${asset.sourceUri}`, "_blank")}
            className="w-full py-2 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-accent)] text-[var(--color-ah-bg)] text-xs font-semibold tracking-wide cursor-pointer hover:brightness-110 transition-all flex items-center justify-center gap-2"
          >
            <span className="text-sm">&#9655;</span> Open in RV Player
          </button>
          <div className="grid grid-cols-2 gap-2">
            <ActionBtn icon="&#128203;" label="Copy Path" onClick={() => copyToClipboard(asset.sourceUri)} />
            <ActionBtn icon="&#8635;" label="Re-ingest" />
          </div>
          <DevAdvanceButton asset={asset} onAdvanced={onAdvanced} />
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton height="16px" /><Skeleton height="12px" />
        <Skeleton height="120px" /><Skeleton height="80px" /><Skeleton height="100px" />
      </div>
    );
  }

  const v = info.version;
  const prov = info.provenance[0];
  const prod = asset.productionMetadata;
  const statusLabel = STATUS_LABELS[v.status] ?? STATUS_LABELS[asset.status] ?? asset.status;
  const totalFrames = v.frameRangeEnd && v.frameRangeStart ? v.frameRangeEnd - v.frameRangeStart + 1 : null;

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {/* Asset title + subtitle */}
        <div className="mt-3 mb-1">
          <h3 className="text-[13px] font-semibold text-[var(--color-ah-text)] truncate">{asset.title}</h3>
          <p className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-accent)] tracking-wide mt-0.5">
            {mediaTypeLabel(v.mediaType)} SEQUENCE
            {prod?.sequence || prod?.shot
              ? ` \u00b7 ${[prod.sequence, prod.shot].filter(Boolean).join(" / ")}`
              : ""}
          </p>
        </div>

        {/* ── SEQUENCE ── */}
        <SectionHeader title="Sequence" />
        <dl>
          <MetaRow label="Frames" value={
            v.frameRangeStart != null && v.frameRangeEnd != null
              ? `${v.frameRangeStart} \u2013 ${v.frameRangeEnd} (${totalFrames} fr)`
              : null
          } />
          <MetaRow label="FPS" value={v.frameRate ? v.frameRate.toFixed(2) : null} />
          <MetaRow label="Resolution" value={resolutionTag(v.resolutionW, v.resolutionH)} />
          <MetaRow label="Bit depth" value={bitDepthLabel(v.bitDepth)} />
          <MetaRow label="Channels" value={channelLabel(v.channelCount)} accent={v.channelCount != null && v.channelCount > 3} />
          <MetaRow label="Compression" value={v.compressionType} />
        </dl>

        {/* ── COLOR SCIENCE ── */}
        <SectionHeader title="Color Science" />
        <dl>
          <MetaRow label="Colorspace" value={v.colorSpace} accent />
        </dl>

        {/* ── PRODUCTION ── */}
        <SectionHeader title="Production" />
        <dl>
          <MetaRow label="Project" value={prod?.show} />
          <MetaRow label="Sequence" value={prod?.sequence} />
          <MetaRow label="Shot" value={prod?.shot} accent />
          <MetaRow label="Version" value={v.versionLabel} />
          <StatusRow label="Status" statusLabel={statusLabel} />
          <MetaRow label="Size" value={formatFileSize(v.fileSizeBytes ?? undefined)} />
          <MetaRow label="Ingested" value={v.createdAt ? new Date(v.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : null} />
        </dl>

        {/* ── TAGS ── */}
        <SectionHeader title="Tags" />
        <TagPills asset={asset} info={info} />

        {/* ── PROVENANCE (if available) ── */}
        {prov && (
          <>
            <SectionHeader title="Provenance" />
            <dl>
              <MetaRow label="DCC" value={prov.softwareUsed} />
              <MetaRow label="Version" value={prov.softwareVersion} />
              <MetaRow label="Stage" value={prov.pipelineStage} />
              <MetaRow label="Artist" value={prov.creator} />
            </dl>
          </>
        )}

        {/* ── STORAGE ── */}
        {(v.elementPath || v.vastPath) && (
          <>
            <SectionHeader title="Storage" />
            <dl>
              <MetaRow label="Path" value={v.elementPath ?? v.vastPath} copyable />
              {v.vastElementHandle && <MetaRow label="Handle" value={v.vastElementHandle} copyable />}
              {info.protocols.nfs && <MetaRow label="NFS" value={info.protocols.nfs} copyable />}
              {info.protocols.smb && <MetaRow label="SMB" value={info.protocols.smb} copyable />}
              {info.protocols.s3 && <MetaRow label="S3" value={info.protocols.s3} copyable />}
            </dl>
          </>
        )}
      </div>

      {/* ── Action buttons — sticky footer (matches mockup) ── */}
      <div className="shrink-0 border-t border-[var(--color-ah-border)] p-3 space-y-2 bg-[var(--color-ah-bg-raised)]">
        <button type="button"
          onClick={() => {
            const path = v.elementPath ?? v.vastPath ?? asset.sourceUri;
            if (path) window.open(`rvlink://${path}`, "_blank");
          }}
          className="w-full py-2 rounded-[var(--radius-ah-md)] bg-[var(--color-ah-accent)] text-[var(--color-ah-bg)] text-xs font-semibold tracking-wide cursor-pointer hover:brightness-110 transition-all flex items-center justify-center gap-2"
        >
          <span className="text-sm">&#9655;</span> Open in RV Player
        </button>
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn icon="&#128203;" label="Copy Path" onClick={() => {
            const p = v.elementPath ?? v.vastPath ?? asset.sourceUri;
            if (p) copyToClipboard(p);
          }} />
          <ActionBtn icon="&#8635;" label="Proxy" />
          <ActionBtn icon="&#9881;" label="Pipeline" />
          <ActionBtn icon="&#128465;" label="Delete" danger />
        </div>
        <DevAdvanceButton asset={asset} onAdvanced={onAdvanced} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DevAdvanceButton — shown only in non-production environments when asset
// status is pending or processing (i.e. stuck waiting for a media worker).
// Calls POST /api/v1/assets/:id/dev-advance and reports the result.
// ---------------------------------------------------------------------------

const DEV_ADVANCEABLE_STATUSES = new Set(["pending", "processing"]);
const IS_PRODUCTION = import.meta.env.PROD && !import.meta.env.DEV;

function DevAdvanceButton({
  asset,
  onAdvanced,
}: {
  asset: AssetRow;
  onAdvanced?: (updated: AssetRow) => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (IS_PRODUCTION) return null;
  if (!DEV_ADVANCEABLE_STATUSES.has(asset.status)) return null;

  const handleClick = async () => {
    setAdvancing(true);
    setError(null);
    try {
      const result = await devAdvanceAsset(asset.id);
      onAdvanced?.(result.asset as AssetRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "advance failed");
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={advancing}
        onClick={() => void handleClick()}
        className="w-full py-2 rounded-[var(--radius-ah-md)] border border-yellow-500/40 bg-yellow-500/10 text-yellow-400 text-xs font-semibold tracking-wide cursor-pointer hover:bg-yellow-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        title="DEV ONLY: bypasses media worker — not available in production"
      >
        <span>&#9654;</span>
        {advancing ? "Advancing..." : "Advance to Review"}
        <span className="ml-1 px-1 py-0.5 rounded bg-yellow-500/20 text-[9px] font-bold tracking-widest text-yellow-300">
          DEV ONLY
        </span>
      </button>
      {error && (
        <p className="text-[10px] text-red-400 font-[var(--font-ah-mono)] truncate" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`py-1.5 rounded-[var(--radius-ah-md)] border text-[11px] font-medium cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
        danger
          ? "border-[var(--color-ah-danger,#ef4444)]/30 text-[var(--color-ah-danger,#ef4444)] hover:bg-[var(--color-ah-danger,#ef4444)]/10"
          : "border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)]"
      }`}
    >
      <span dangerouslySetInnerHTML={{ __html: icon }} /> {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// HistoryTab — vertical timeline
// ---------------------------------------------------------------------------

const EVENT_STYLES: Record<string, { icon: string; color: string }> = {
  created: { icon: "+", color: "#06b6d4" },
  published: { icon: "P", color: "#22c55e" },
  pipeline: { icon: "\u2699", color: "#06b6d4" },
  submit_for_review: { icon: "S", color: "#eab308" },
  approve: { icon: "\u2713", color: "#22c55e" },
  reject: { icon: "\u2717", color: "#ef4444" },
  request_changes: { icon: "R", color: "#f97316" },
};

function HistoryTab({ events }: { events: VersionDetailHistoryEvent[] | null }) {
  if (!events) {
    return <div className="p-4 space-y-3"><Skeleton height="40px" /><Skeleton height="40px" /><Skeleton height="40px" /></div>;
  }
  if (events.length === 0) {
    return <div className="p-4 text-xs text-[var(--color-ah-text-subtle)]">No history events.</div>;
  }

  return (
    <div className="overflow-auto px-4 py-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <div className="relative pl-6">
        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--color-ah-border)]" />
        {events.map((event, i) => {
          const s = EVENT_STYLES[event.eventType] ?? { icon: "?", color: "#94a3b8" };
          return (
            <div key={i} className="relative mb-4 last:mb-0">
              <span className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{ backgroundColor: `${s.color}20`, color: s.color, border: `1.5px solid ${s.color}` }}
              >{s.icon}</span>
              <div>
                <p className="text-[11px] text-[var(--color-ah-text)]">{event.detail}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {event.actor && <span className="text-[10px] text-[var(--color-ah-text-muted)]">{event.actor}</span>}
                  <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)]">
                    {new Date(event.at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AovsTab — AOV Layer Map from EXR metadata
// ---------------------------------------------------------------------------

const LAYER_COLORS = [
  "#a855f7", "#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6",
];

function AovsTab({ exrMeta }: { exrMeta: ExrMetadataLookupResultLike | null }) {
  if (!exrMeta?.found || !exrMeta.channels || exrMeta.channels.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--color-ah-text-subtle)]">
        {exrMeta === null ? "Loading EXR metadata..." : "No AOV data available. EXR metadata not found for this asset."}
      </div>
    );
  }

  // Group channels by layer
  const layerMap = new Map<string, ExrChannel[]>();
  for (const ch of exrMeta.channels!) {
    const layer = ch.layer_name || "(root)";
    if (!layerMap.has(layer)) layerMap.set(layer, []);
    layerMap.get(layer)!.push(ch);
  }

  const layers = [...layerMap.entries()];

  return (
    <div className="overflow-auto px-4 py-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <h3 className="text-[13px] font-semibold text-[var(--color-ah-text)]">AOV Layer Map</h3>
      <p className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-accent)] tracking-wide mt-0.5 mb-3">
        {layers.length} LAYERS &middot; MULTI-CHANNEL EXR
      </p>

      <SectionHeader title="Layers" />
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
            <th className="text-left py-1 font-medium">LAYER</th>
            <th className="text-left py-1 font-medium">CHANNELS</th>
            <th className="text-left py-1 font-medium">DEPTH</th>
          </tr>
        </thead>
        <tbody>
          {layers.map(([layer, channels], i) => {
            const components = channels.map((c) => c.component_name || c.channel_name).join("");
            const depth = channels[0]?.channel_type ?? "";
            const depthLabel = depth === "HALF" ? "16f" : depth === "FLOAT" ? "32f" : depth === "UINT" ? "32u" : depth;
            return (
              <tr key={layer} className="border-t border-[var(--color-ah-border-muted)]">
                <td className="py-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: LAYER_COLORS[i % LAYER_COLORS.length] }} />
                  <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">{layer}</span>
                </td>
                <td className="py-1.5 font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{components}</td>
                <td className="py-1.5 font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">{depthLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function attrDisplayValue(attr: ExrAttributeMetadata): string {
  if (attr.value_text != null && attr.value_text !== "") return attr.value_text;
  if (attr.value_float != null) return String(attr.value_float);
  if (attr.value_int != null) return String(attr.value_int);
  return "(empty)";
}

// ---------------------------------------------------------------------------
// VastTab — VAST Storage info
// ---------------------------------------------------------------------------

function VastTab({ asset, exrMeta }: { asset: AssetRow; exrMeta: ExrMetadataLookupResultLike | null }) {
  // Live discovered pipelines — zero hardcoded function names, schemas,
  // or tables. The admin controls which functions handle which file
  // kinds via PlatformSettings, and the control-plane merges that with
  // live VAST function records (description, owner, status) via the
  // /dataengine/pipelines/active endpoint.
  const { pipelines, loading: pipelinesLoading } = useDataEnginePipelines();
  const matchedPipeline = findPipelineForFilename(pipelines, asset.title);

  // File-kind-agnostic readiness signal from the actual sidecar on S3.
  // `exrMeta?.found` is kept as a fallback for legacy EXR pages where the
  // old VastDB lookup path ran without the sidecar hook.
  const { sidecar, loading: sidecarLoading } = useStorageSidecar(asset.sourceUri);
  const sidecarReady = sidecar !== null;
  const legacyExrReady = exrMeta?.found === true;
  const metadataReady = sidecarReady || legacyExrReady;

  return (
    <div className="overflow-auto px-4 py-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <SectionHeader title="VAST Storage" />
      <dl>
        <MetaRow label="Path" value={asset.sourceUri} copyable />
        {asset.elementPath && <MetaRow label="Element" value={asset.elementPath} copyable />}
        <MetaRow label="Protocol" value="S3" />
        {asset.metadata?.file_size_bytes != null && (
          <MetaRow label="Size" value={formatFileSize(asset.metadata.file_size_bytes)} />
        )}
      </dl>

      <SectionHeader title="DataEngine Pipeline" />
      {pipelinesLoading && !matchedPipeline ? (
        <p className="text-[11px] text-[var(--color-ah-text-subtle)]">Loading pipeline config...</p>
      ) : !matchedPipeline ? (
        <p className="text-[11px] text-[var(--color-ah-text-subtle)]">
          This file kind is not processed by any configured DataEngine pipeline.
        </p>
      ) : (
        <div className="space-y-2">
          <div
            className={`flex items-center justify-between px-3 py-2 rounded bg-[var(--color-ah-bg)] border ${metadataReady ? "border-green-500/30" : "border-[var(--color-ah-border-muted)]"}`}
          >
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-[var(--font-ah-mono)] text-[var(--color-ah-text)] truncate">
                {matchedPipeline.config.functionName}
              </span>
              {matchedPipeline.live?.description && (
                <span className="text-[10px] text-[var(--color-ah-text-subtle)] truncate">
                  {matchedPipeline.live.description}
                </span>
              )}
              <span className="text-[10px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-subtle)] truncate">
                → {matchedPipeline.config.targetSchema}.{matchedPipeline.config.targetTable}
              </span>
              {matchedPipeline.status !== "ok" && (
                <span className="text-[10px] text-[var(--color-ah-warning,#f59e0b)] truncate">
                  VAST: {matchedPipeline.status}{matchedPipeline.statusDetail ? ` — ${matchedPipeline.statusDetail}` : ""}
                </span>
              )}
            </div>
            <span className={`text-[10px] font-[var(--font-ah-mono)] ml-2 shrink-0 ${metadataReady ? "text-green-400" : "text-[var(--color-ah-text-subtle)]"}`}>
              {metadataReady ? "done" : "pending"}
            </span>
          </div>
          {!metadataReady && (
            <p className="text-[11px] text-[var(--color-ah-text-subtle)] pt-1">
              {sidecarLoading
                ? `Checking ${matchedPipeline.config.functionName} output...`
                : `Metadata will appear here once ${matchedPipeline.config.functionName} has processed this file.`}
            </p>
          )}
        </div>
      )}

      <SectionHeader title="Asset IDs" />
      <dl>
        <MetaRow label="Asset ID" value={asset.id} copyable />
        {asset.jobId && <MetaRow label="Job ID" value={asset.jobId} copyable />}
        {exrMeta?.found && exrMeta.file?.file_id && (
          <MetaRow label="Metadata File ID" value={String(exrMeta.file.file_id)} copyable />
        )}
        {sidecar && (
          <MetaRow label="Sidecar Key" value={sidecar.sidecar_key} copyable />
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamsTab — Video/Audio stream metadata
// ---------------------------------------------------------------------------

function StreamsTab({ asset }: { asset: AssetRow }) {
  const meta = asset.metadata;
  const ext = asset.title.split(".").pop()?.toLowerCase() ?? "";
  const isVideo = ["mp4", "mov", "mxf", "avi", "mkv", "webm"].includes(ext);

  return (
    <div className="overflow-auto px-4 py-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
      {/* Container info */}
      <SectionHeader title="Container" />
      <dl>
        <MetaRow label="Format" value={ext.toUpperCase()} />
        <MetaRow label="Source" value={asset.sourceUri} copyable />
        {meta?.file_size_bytes != null && <MetaRow label="Size" value={formatFileSize(meta.file_size_bytes)} />}
      </dl>

      {/* Video stream */}
      {isVideo && (
        <>
          <SectionHeader title="Video Stream" />
          <dl>
            <MetaRow label="Codec" value={meta?.codec} accent />
            {meta?.resolution && (
              <MetaRow label="Resolution" value={`${meta.resolution.width}x${meta.resolution.height}`} />
            )}
            <MetaRow label="Frame Rate" value={meta?.frame_rate ? `${meta.frame_rate} fps` : null} />
            <MetaRow label="Bit Depth" value={meta?.bit_depth ? bitDepthLabel(meta.bit_depth) : null} />
            <MetaRow label="Pixel Aspect" value={meta?.pixel_aspect_ratio != null && meta.pixel_aspect_ratio !== 1 ? String(meta.pixel_aspect_ratio) : null} />
            <MetaRow label="Color Space" value={meta?.color_space} accent />
            {meta?.frame_range && (
              <>
                <MetaRow label="Frames" value={`${meta.frame_range.start} \u2013 ${meta.frame_range.end}`} />
                {meta?.frame_rate && (
                  <MetaRow label="Duration" value={formatDuration((meta.frame_range.end - meta.frame_range.start + 1) / meta.frame_rate)} />
                )}
              </>
            )}
          </dl>
        </>
      )}

      {/* Audio stream */}
      <SectionHeader title="Audio Stream" />
      <dl>
        {meta?.channels && meta.channels.length > 0 ? (
          <MetaRow label="Channels" value={meta.channels.join(", ")} />
        ) : (
          <MetaRow label="Channels" value={isVideo ? "Stereo (assumed)" : null} />
        )}
        {!isVideo && meta?.codec && <MetaRow label="Codec" value={meta.codec} accent />}
      </dl>

      {/* Timecode */}
      {meta?.frame_range && meta?.frame_rate && (
        <>
          <SectionHeader title="Timecode" />
          <dl>
            <MetaRow label="TC In" value={formatTC(meta.frame_range.start / meta.frame_rate, meta.frame_rate)} />
            <MetaRow label="TC Out" value={formatTC(meta.frame_range.end / meta.frame_rate, meta.frame_rate)} />
          </dl>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssetDetailPanel — main component
// ---------------------------------------------------------------------------

export function AssetDetailPanel({ asset, onClose, onAdvanced }: AssetDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabId>("metadata");
  const [info, setInfo] = useState<VersionDetailInfo | null>(null);
  const [history, setHistory] = useState<VersionDetailHistoryEvent[] | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Focus management
  useEffect(() => { panelRef.current?.focus(); }, [asset.id]);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && panelRef.current?.contains(document.activeElement)) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch info
  useEffect(() => {
    if (!asset.currentVersionId) { setInfo(null); return; }
    setLoadingInfo(true);
    void fetchVersionDetail(asset.currentVersionId, ["info"]).then((res) => {
      setInfo(res?.info ?? null);
      setLoadingInfo(false);
    });
  }, [asset.currentVersionId]);

  // Derive EXR-like metadata from useAssetMetadata (replaces legacy fetchExrMetadataLookup)
  const panelMetadata = useAssetMetadata(asset.id);
  const exrMeta: ExrMetadataLookupResultLike | null = useMemo(() => {
    if (!panelMetadata.data) return null;
    const sidecar = panelMetadata.data.sidecar as Record<string, unknown> | null;
    const dbRow = panelMetadata.data.dbRows[0] as Record<string, unknown> | undefined;

    const rawChannels = sidecar?.channels;
    const channels: ExrChannel[] = Array.isArray(rawChannels)
      ? (rawChannels as Array<Partial<ExrChannel>>).filter(
          (ch): ch is ExrChannel => typeof ch.channel_name === "string"
        )
      : [];

    const rawParts = sidecar?.parts;
    const parts: ExrPart[] = Array.isArray(rawParts) ? (rawParts as ExrPart[]) : [];

    const summary = (sidecar?.summary as ExrSummary | undefined) ??
      (dbRow
        ? {
            resolution: (dbRow.resolution as string | undefined) ?? "unknown",
            compression: (dbRow.compression as string | undefined) ?? "unknown",
            colorSpace: (dbRow.color_space as string | undefined) ?? "unknown",
            channelCount: (dbRow.channel_count as number | undefined) ?? 0,
            isDeep: (dbRow.is_deep as boolean | undefined) ?? false,
            frameNumber: (dbRow.frame_number as number | undefined) ?? null,
          } satisfies ExrSummary
        : undefined);

    const found = panelMetadata.data.dbRows.length > 0 || !!sidecar;

    return {
      found,
      channels,
      parts,
      summary,
      file: (sidecar?.file as ExrFile | undefined) ?? undefined,
    };
  }, [panelMetadata.data]);

  // Fetch history (lazy)
  useEffect(() => {
    if (activeTab !== "history" || !asset.currentVersionId) return;
    if (history !== null) return;
    setLoadingHistory(true);
    void fetchVersionDetail(asset.currentVersionId, ["history"]).then((res) => {
      setHistory(res?.history ?? null);
      setLoadingHistory(false);
    });
  }, [activeTab, asset.currentVersionId, history]);

  // Media type detection
  const mediaType = inferMediaType(asset.title, asset.sourceUri);
  const tabs = getTabsForMediaType(mediaType);

  // Reset on asset change
  useEffect(() => {
    setInfo(null);
    setHistory(null);
    // Reset to the first available tab for this media type — "metadata"
    // when supported, "info" otherwise.
    const mt = inferMediaType(asset.title, asset.sourceUri);
    setActiveTab(mt === "image" || mt === "video" || mt === "raw" ? "metadata" : "info");
  }, [asset.id, asset.title, asset.sourceUri]);

  return (
    <div ref={panelRef} tabIndex={-1}
      className="h-full flex flex-col bg-[var(--color-ah-bg-raised)] border-l border-[var(--color-ah-border)] outline-none"
      role="complementary" aria-label={`Details for ${asset.title}`}
    >
      <PanelHeader asset={asset} info={info} onClose={onClose} />
      <FrameBar info={info} />

      {/* AOV tag pills — show channel layers from EXR metadata (images only) */}
      {mediaType === "image" && (
        <div className="px-4 py-2 border-b border-[var(--color-ah-border-muted)]">
          <ChannelPills
            channels={panelMetadata.data?.sidecar?.channels}
            mode="dedup-by-layer"
            containerClassName="flex flex-wrap gap-1.5"
            pillClassName="px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
          />
        </div>
      )}

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-hidden">
        {activeTab === "metadata" && <MetadataTab asset={asset} />}
        {activeTab === "info" && <InfoTab info={loadingInfo ? null : info} asset={asset} exrMeta={exrMeta} onAdvanced={onAdvanced} />}
        {activeTab === "streams" && <StreamsTab asset={asset} />}
        {activeTab === "history" && <HistoryTab events={loadingHistory ? null : history} />}
        {activeTab === "aovs" && <AovsTab exrMeta={exrMeta} />}
        {activeTab === "vast" && <VastTab asset={asset} exrMeta={exrMeta} />}
      </div>
    </div>
  );
}
