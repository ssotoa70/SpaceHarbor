import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton } from "../design-system";
import {
  fetchVersionDetail,
  fetchExrMetadataLookup,
  devAdvanceAsset,
  type VersionDetailInfo,
  type VersionDetailHistoryEvent,
  type ExrMetadataLookupResult,
  type ExrAttributeMetadata,
} from "../api";
import type { AssetRow } from "../types";
import { formatTC } from "../utils/timecode";
import { formatFileSize, formatDuration, inferMediaType } from "../utils/media-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "info" | "fields" | "aovs" | "streams" | "vast" | "history";

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
// Field count — for the "FIELDS (N)" tab label
// ---------------------------------------------------------------------------

function computeFieldCount(asset: AssetRow, exrMeta: ExrMetadataLookupResult | null, info: VersionDetailInfo | null): number {
  let count = 0;
  // Basic: title, sourceUri, id
  count += 3;
  if (asset.jobId) count++;
  if (asset.metadata?.file_size_bytes) count++;
  if (exrMeta?.found) {
    if (exrMeta.file) count += 3; // file_id, size, inspected
    if (exrMeta.summary) count += 5; // resolution, channels, compression, colorSpace, frameNumber
    const fp = exrMeta.parts?.[0];
    if (fp) {
      if (fp.display_window || fp.display_width) count++;
      if (fp.data_window || fp.data_x_offset != null) count++;
      if (fp.pixel_aspect_ratio != null) count++;
      if (fp.line_order) count++;
      if (fp.render_software) count++;
      if (fp.is_tiled) count++;
      if (fp.multi_view) count++;
    }
    count += exrMeta.attributes?.length ?? 0;
  } else if (info?.version) {
    count += 5; // resolution, channels, compression, fps, bitDepth
  }
  return count;
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

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
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

type TabDef = { id: TabId; label: string | ((ctx: { fieldCount?: number }) => string) };

function getTabsForMediaType(mediaType: string): TabDef[] {
  const base: TabDef[] = [
    { id: "info", label: "INFO" },
    { id: "fields", label: (ctx) => `FIELDS${ctx.fieldCount ? ` (${ctx.fieldCount})` : ""}` },
  ];
  if (mediaType === "image") {
    base.push({ id: "aovs", label: "AOVS" });
  } else if (mediaType === "video" || mediaType === "audio") {
    base.push({ id: "streams", label: "STREAMS" });
  }
  base.push({ id: "vast", label: "VAST" });
  base.push({ id: "history", label: "HISTORY" });
  return base;
}

function TabBar({ activeTab, onTabChange, tabContext, tabs }: { activeTab: TabId; onTabChange: (t: TabId) => void; tabContext?: { fieldCount?: number }; tabs: TabDef[] }) {
  const ctx = tabContext ?? {};
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (e.key === "ArrowRight") { e.preventDefault(); onTabChange(tabs[(idx + 1) % tabs.length].id); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onTabChange(tabs[(idx - 1 + tabs.length) % tabs.length].id); }
  }, [activeTab, onTabChange, tabs]);

  return (
    <div role="tablist" aria-label="Detail panel tabs" className="flex border-b border-[var(--color-ah-border)]" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const label = typeof tab.label === "function" ? tab.label(ctx) : tab.label;
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
          >{label}</button>
        );
      })}
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
  exrMeta?: ExrMetadataLookupResult | null;
  onAdvanced?: (updatedAsset: AssetRow) => void;
}) {
  // When no version detail is available (asset ingested without VFX hierarchy),
  // show data from the asset record + EXR metadata from exr-inspector.
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

          {/* Media-type-specific sections */}
          {mt === "video" || mt === "audio" ? (
            <>
              {/* VIDEO / AUDIO */}
              <SectionHeader title="Media" />
              <dl>
                <MetaRow label="Codec" value={asset.metadata?.codec} accent />
                {asset.metadata?.resolution && (
                  <MetaRow label="Resolution" value={`${asset.metadata.resolution.width}x${asset.metadata.resolution.height}`} />
                )}
                <MetaRow label="Frame Rate" value={asset.metadata?.frame_rate ? `${asset.metadata.frame_rate} fps` : null} />
                <MetaRow label="Bit Depth" value={asset.metadata?.bit_depth ? bitDepthLabel(asset.metadata.bit_depth) : null} />
                <MetaRow label="Color Space" value={asset.metadata?.color_space} accent />
                {asset.metadata?.frame_range && asset.metadata?.frame_rate && (
                  <MetaRow label="Duration" value={formatDuration((asset.metadata.frame_range.end - asset.metadata.frame_range.start + 1) / asset.metadata.frame_rate)} />
                )}
                <MetaRow label="Pixel Aspect" value={asset.metadata?.pixel_aspect_ratio != null && asset.metadata.pixel_aspect_ratio !== 1 ? String(asset.metadata.pixel_aspect_ratio) : null} />
                <MetaRow label="Compression" value={asset.metadata?.compression_type} />
              </dl>
            </>
          ) : (
            <>
              {/* IMAGE / EXR — populated from EXR metadata when available */}
              <SectionHeader title="Sequence" />
              <dl>
                {summary?.frameNumber != null && (
                  <MetaRow label="Frame" value={String(summary.frameNumber)} />
                )}
                <MetaRow label="Resolution" value={summary?.resolution !== "unknown" ? summary?.resolution : null} />
                <MetaRow label="Channels" value={summary?.channelCount ? channelLabel(summary.channelCount) : null} accent={!!summary?.channelCount && summary.channelCount > 3} />
                <MetaRow label="Compression" value={summary?.compression !== "unknown" ? summary?.compression : null} />
                {summary?.isDeep && <MetaRow label="Type" value="Deep EXR" />}
              </dl>

              {/* COLOR SCIENCE — from EXR metadata */}
              {summary?.colorSpace && summary.colorSpace !== "unknown" && (
                <>
                  <SectionHeader title="Color Science" />
                  <dl>
                    <MetaRow label="Colorspace" value={summary.colorSpace} accent />
                  </dl>
                </>
              )}

              {/* EXR TECHNICAL — rich parts data */}
              {firstPart && (
                <>
                  <SectionHeader title="Technical" />
                  <dl>
                    <MetaRow label="Display Window" value={firstPart.display_window ?? (firstPart.display_width ? `${firstPart.display_width}x${firstPart.display_height}` : null)} />
                    <MetaRow label="Data Window" value={firstPart.data_window ?? (firstPart.data_x_offset != null ? `offset ${firstPart.data_x_offset}, ${firstPart.data_y_offset}` : null)} />
                    <MetaRow label="Pixel Aspect" value={firstPart.pixel_aspect_ratio != null && firstPart.pixel_aspect_ratio !== 1 ? String(firstPart.pixel_aspect_ratio) : null} />
                    <MetaRow label="Line Order" value={firstPart.line_order} />
                    <MetaRow label="Render Software" value={firstPart.render_software} accent />
                    {firstPart.is_tiled && (
                      <MetaRow label="Tiling" value={`${firstPart.tile_width ?? "?"}x${firstPart.tile_height ?? "?"}${firstPart.tile_depth ? ` (${firstPart.tile_depth})` : ""}`} />
                    )}
                    {firstPart.multi_view && <MetaRow label="Multi-View" value="Yes" accent />}
                  </dl>
                </>
              )}
            </>
          )}

          {/* PRODUCTION */}
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

          {/* STORAGE */}
          <SectionHeader title="Storage" />
          <dl>
            <MetaRow label="Source" value={asset.sourceUri} copyable />
            <MetaRow label="Asset ID" value={asset.id} copyable />
            {asset.jobId && <MetaRow label="Job ID" value={asset.jobId} copyable />}
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
            <ActionBtn icon="&#128203;" label="Copy Path" onClick={() => void navigator.clipboard.writeText(asset.sourceUri)} />
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
            if (p) void navigator.clipboard.writeText(p);
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

function AovsTab({ exrMeta }: { exrMeta: ExrMetadataLookupResult | null }) {
  if (!exrMeta?.found || !exrMeta.channels || exrMeta.channels.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--color-ah-text-subtle)]">
        {exrMeta === null ? "Loading EXR metadata..." : "No AOV data available. EXR metadata not found for this asset."}
      </div>
    );
  }

  // Group channels by layer
  const layerMap = new Map<string, typeof exrMeta.channels>();
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

// ---------------------------------------------------------------------------
// FieldsTab — Dynamic "All Fields" view (Frame.io style)
// Groups: File Info, Image, Color Science, Technical, Render, Attributes
// ---------------------------------------------------------------------------

/** Categorize EXR attributes into display groups */
const ATTR_GROUPS: Record<string, string[]> = {
  "Color Science": ["chromaticities", "whiteLuminance", "adoptedNeutral", "renderingTransform", "lookModTransform"],
  "Camera": ["camera", "lens", "focalLength", "aperture", "focus", "exposure", "isoSpeed", "shutterAngle"],
  "Timecode": ["timecode", "timeCode", "keyCode", "framesPerSecond"],
  "Render": ["renderer", "renderSoftware", "driverVersion", "hostname", "oiio"],
};

function categorizeAttr(name: string): string {
  for (const [group, keywords] of Object.entries(ATTR_GROUPS)) {
    if (keywords.some((kw) => name.toLowerCase().includes(kw.toLowerCase()))) return group;
  }
  return "Header Attributes";
}

function attrDisplayValue(attr: ExrAttributeMetadata): string {
  if (attr.value_text != null && attr.value_text !== "") return attr.value_text;
  if (attr.value_float != null) return String(attr.value_float);
  if (attr.value_int != null) return String(attr.value_int);
  return "(empty)";
}

function FieldsTab({
  asset,
  exrMeta,
  info,
}: {
  asset: AssetRow;
  exrMeta: ExrMetadataLookupResult | null;
  info: VersionDetailInfo | null;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(["File Info", "Image", "Color Science", "Technical"]));

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // Build field groups from all available data
  const groups = new Map<string, Array<{ label: string; value: string }>>();

  const addField = (group: string, label: string, value: string | number | null | undefined) => {
    if (value == null || value === "" || value === "unknown") return;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ label, value: String(value) });
  };

  // File Info
  addField("File Info", "Filename", asset.title);
  addField("File Info", "Source URI", asset.sourceUri);
  addField("File Info", "Asset ID", asset.id);
  addField("File Info", "Job ID", asset.jobId);
  if (exrMeta?.found && exrMeta.file) {
    addField("File Info", "File ID", exrMeta.file.file_id);
    addField("File Info", "Size", exrMeta.file.size_bytes ? formatFileSize(exrMeta.file.size_bytes) : null);
    addField("File Info", "Multipart Count", exrMeta.file.multipart_count > 1 ? exrMeta.file.multipart_count : null);
    addField("File Info", "Inspected", exrMeta.file.inspection_timestamp);
  } else if (asset.metadata?.file_size_bytes) {
    addField("File Info", "Size", formatFileSize(asset.metadata.file_size_bytes));
  }

  // Media-type-specific fields
  const mt = inferMediaType(asset.title, asset.sourceUri);
  const exr = exrMeta?.found ? exrMeta : null;
  const summary = exr?.summary;
  const firstPart = exr?.parts?.[0];
  const v = info?.version;
  const meta = asset.metadata;

  if (mt === "video" || mt === "audio") {
    // Video/Audio fields
    addField("Video Stream", "Codec", meta?.codec);
    if (meta?.resolution) addField("Video Stream", "Resolution", `${meta.resolution.width}x${meta.resolution.height}`);
    addField("Video Stream", "Frame Rate", meta?.frame_rate ? `${meta.frame_rate} fps` : null);
    addField("Video Stream", "Bit Depth", meta?.bit_depth ? bitDepthLabel(meta.bit_depth) : null);
    addField("Video Stream", "Compression", meta?.compression_type);
    addField("Video Stream", "Pixel Aspect", meta?.pixel_aspect_ratio != null && meta.pixel_aspect_ratio !== 1 ? String(meta.pixel_aspect_ratio) : null);
    if (meta?.frame_range && meta?.frame_rate) {
      addField("Video Stream", "Duration", formatDuration((meta.frame_range.end - meta.frame_range.start + 1) / meta.frame_rate));
      addField("Video Stream", "Frame Range", `${meta.frame_range.start} \u2013 ${meta.frame_range.end}`);
    }
    addField("Color", "Color Space", meta?.color_space);
    if (meta?.channels && meta.channels.length > 0) {
      addField("Audio Stream", "Channels", meta.channels.join(", "));
    }
  } else if (summary) {
    // EXR/Image fields from exr-inspector
    addField("Image", "Resolution", summary.resolution);
    addField("Image", "Channels", summary.channelCount ? channelLabel(summary.channelCount) : null);
    addField("Image", "Compression", summary.compression);
    addField("Image", "Deep", summary.isDeep ? "Yes" : null);
    addField("Image", "Frame Number", summary.frameNumber);
    addField("Color", "Color Space", summary.colorSpace);
  } else if (v) {
    addField("Image", "Resolution", resolutionTag(v.resolutionW, v.resolutionH));
    addField("Image", "Channels", channelLabel(v.channelCount));
    addField("Image", "Compression", v.compressionType);
    addField("Image", "Bit Depth", bitDepthLabel(v.bitDepth));
    addField("Image", "FPS", v.frameRate?.toFixed(2));
    addField("Color", "Color Space", v.colorSpace);
  }

  // Technical — from EXR parts (only for images)
  if (firstPart && mt === "image") {
    addField("Technical", "Display Window", firstPart.display_window ?? (firstPart.display_width ? `${firstPart.display_width}x${firstPart.display_height}` : null));
    addField("Technical", "Data Window", firstPart.data_window ?? (firstPart.data_x_offset != null ? `offset ${firstPart.data_x_offset}, ${firstPart.data_y_offset}` : null));
    addField("Technical", "Pixel Aspect Ratio", firstPart.pixel_aspect_ratio != null ? String(firstPart.pixel_aspect_ratio) : null);
    addField("Technical", "Line Order", firstPart.line_order);
    addField("Technical", "Render Software", firstPart.render_software);
    addField("Technical", "Tiled", firstPart.is_tiled ? `${firstPart.tile_width ?? "?"}x${firstPart.tile_height ?? "?"}${firstPart.tile_depth ? ` (${firstPart.tile_depth})` : ""}` : null);
    addField("Technical", "Multi-View", firstPart.multi_view ? "Yes" : null);
  }

  // EXR header attributes — grouped by category
  if (exr?.attributes && exr.attributes.length > 0) {
    for (const attr of exr.attributes) {
      const group = categorizeAttr(attr.attr_name);
      addField(group, attr.attr_name, attrDisplayValue(attr));
    }
  }

  // Total field count
  let totalFields = 0;
  for (const fields of groups.values()) totalFields += fields.length;

  const groupEntries = [...groups.entries()];

  return (
    <div className="overflow-auto px-4 py-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-ah-text)]">All Fields</h3>
        <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-subtle)]">
          {totalFields} fields
        </span>
      </div>

      {groupEntries.map(([group, fields]) => {
        const expanded = expandedGroups.has(group);
        return (
          <div key={group} className="mb-1">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center gap-2 py-1.5 cursor-pointer group"
            >
              <span className="text-[10px] text-[var(--color-ah-text-subtle)] transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                &#9654;
              </span>
              <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--color-ah-text-subtle)] uppercase">
                {group}
              </span>
              <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)]">
                ({fields.length})
              </span>
              <div className="flex-1 h-px bg-[var(--color-ah-border-muted)]" />
            </button>
            {expanded && (
              <dl className="ml-3">
                {fields.map((f) => (
                  <MetaRow key={f.label} label={f.label} value={f.value} />
                ))}
              </dl>
            )}
          </div>
        );
      })}

      {totalFields === 0 && (
        <p className="text-[11px] text-[var(--color-ah-text-subtle)]">No metadata fields available.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VastTab — VAST Storage info
// ---------------------------------------------------------------------------

function VastTab({ asset, exrMeta }: { asset: AssetRow; exrMeta: ExrMetadataLookupResult | null }) {
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

      <SectionHeader title="DataEngine Jobs" />
      {exrMeta?.found ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2 rounded bg-[var(--color-ah-bg)] border border-green-500/30">
            <span className="text-[11px] font-[var(--font-ah-mono)] text-[var(--color-ah-text)]">exr-metadata</span>
            <span className="text-[10px] font-[var(--font-ah-mono)] text-green-400">done</span>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-ah-text-subtle)]">
          No DataEngine results yet. EXR metadata will appear here once the exr-inspector function has processed this file.
        </p>
      )}

      <SectionHeader title="Asset IDs" />
      <dl>
        <MetaRow label="Asset ID" value={asset.id} copyable />
        {asset.jobId && <MetaRow label="Job ID" value={asset.jobId} copyable />}
        {exrMeta?.found && exrMeta.file?.file_id && (
          <MetaRow label="EXR File ID" value={String(exrMeta.file.file_id)} copyable />
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
  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [info, setInfo] = useState<VersionDetailInfo | null>(null);
  const [history, setHistory] = useState<VersionDetailHistoryEvent[] | null>(null);
  const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
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

  // Fetch EXR metadata from exr-inspector tables (non-blocking background)
  useEffect(() => {
    if (!asset.sourceUri) return;
    void fetchExrMetadataLookup(asset.sourceUri).then(setExrMeta);
  }, [asset.sourceUri]);

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
  useEffect(() => { setInfo(null); setHistory(null); setExrMeta(null); setActiveTab("info"); }, [asset.id]);

  return (
    <div ref={panelRef} tabIndex={-1}
      className="h-full flex flex-col bg-[var(--color-ah-bg-raised)] border-l border-[var(--color-ah-border)] outline-none"
      role="complementary" aria-label={`Details for ${asset.title}`}
    >
      <PanelHeader asset={asset} info={info} onClose={onClose} />
      <FrameBar info={info} />

      {/* AOV tag pills — show channel layers from EXR metadata (images only) */}
      {mediaType === "image" && exrMeta?.found && exrMeta.channels && exrMeta.channels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-[var(--color-ah-border-muted)]">
          {[...new Set(exrMeta.channels.map((c) => c.layer_name || c.channel_name))].map((name) => (
            <span key={name}
              className="px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
            >{name}</span>
          ))}
        </div>
      )}

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} tabContext={{ fieldCount: computeFieldCount(asset, exrMeta, info) }} tabs={tabs} />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-hidden">
        {activeTab === "info" && <InfoTab info={loadingInfo ? null : info} asset={asset} exrMeta={exrMeta} onAdvanced={onAdvanced} />}
        {activeTab === "fields" && <FieldsTab asset={asset} exrMeta={exrMeta} info={loadingInfo ? null : info} />}
        {activeTab === "streams" && <StreamsTab asset={asset} />}
        {activeTab === "history" && <HistoryTab events={loadingHistory ? null : history} />}
        {activeTab === "aovs" && <AovsTab exrMeta={exrMeta} />}
        {activeTab === "vast" && <VastTab asset={asset} exrMeta={exrMeta} />}
      </div>
    </div>
  );
}
