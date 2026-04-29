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
import { useAssetIntegrity } from "../hooks/useAssetIntegrity";
import { VideoMetadataRenderer, detectSchema } from "./metadata";
import { AllFieldsPanel } from "./AllFieldsPanel";
import { AovLayerMapTable } from "./AovLayerMapTable";
import { AssetHeaderBar } from "./AssetHeaderBar";
import { FrameSequenceIntegrity } from "./FrameSequenceIntegrity";

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

type TabId = "info" | "aovs" | "streams" | "vast" | "history" | "integrity";

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
  // INFO is the primary view; it renders the same Frame.io-style "All Fields"
  // panel as the full-screen viewer (file-kind-aware MEDIA section + flat
  // ATTRIBUTES dump from the unified DB+sidecar reader). Tabs that don't
  // apply to the file kind are hidden.
  const base: TabDef[] = [{ id: "info", label: "INFO" }];
  if (mediaType === "image") {
    base.push({ id: "aovs", label: "AOVS" });
  } else if (mediaType === "video" || mediaType === "audio") {
    base.push({ id: "streams", label: "STREAMS" });
  }
  base.push({ id: "vast", label: "VAST" });
  base.push({ id: "integrity", label: "INTEGRITY" });
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
// InfoTab — Frame.io-style "All Fields" view shared with the full-screen
// viewer (MediaPreview). Renders FILE / MEDIA / ATTRIBUTES sections via
// <AllFieldsPanel>; file-kind-specific MEDIA fields surface for image,
// video, and raw_camera. The version-detail header is preserved when the
// asset has a currentVersionId.
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
  // show the shared AllFieldsPanel — same renderer as the full-screen viewer.
  // FILE / MEDIA / ATTRIBUTES groups + sticky action footer.
  if (!info && !asset.currentVersionId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-hidden">
          <AllFieldsPanel asset={asset} hideHeader />
        </div>
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
  const [activeTab, setActiveTab] = useState<TabId>("info");
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
    // INFO is now the primary view (renders AllFieldsPanel — same as
    // the full-screen viewer). Reset on asset change.
    setActiveTab("info");
  }, [asset.id, asset.title, asset.sourceUri]);

  // Phase 6 — AOV pill filter state, owned at this panel level so it
  // survives tab switches but resets when the user picks a different
  // asset (otherwise Asset B's AOVS tab would render filtered by a
  // layer name that may not exist on it).
  const [activeAov, setActiveAov] = useState<string | null>(null);
  useEffect(() => { setActiveAov(null); }, [asset.id]);

  return (
    <div ref={panelRef} tabIndex={-1}
      className="h-full flex flex-col bg-[var(--color-ah-bg-raised)] border-l border-[var(--color-ah-border)] outline-none"
      role="complementary" aria-label={`Details for ${asset.title}`}
    >
      <PanelHeader asset={asset} info={info} onClose={onClose} />
      <FrameBar info={info} />

      <AssetHeaderBar
        metadata={panelMetadata.data ?? null}
        activeAov={activeAov}
        onAovChange={setActiveAov}
      />

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-hidden">
        {activeTab === "info" && <InfoTab info={loadingInfo ? null : info} asset={asset} exrMeta={exrMeta} onAdvanced={onAdvanced} />}
        {activeTab === "streams" && <StreamsTab asset={asset} />}
        {activeTab === "history" && <HistoryTab events={loadingHistory ? null : history} />}
        {activeTab === "aovs" && (
          <div className="overflow-auto h-full">
            <AovLayerMapTable asset={asset} activeAov={activeAov} />
            <FrameSequenceIntegrity asset={asset} />
          </div>
        )}
        {activeTab === "vast" && <VastTab asset={asset} exrMeta={exrMeta} />}
        {activeTab === "integrity" && (
          <IntegrityTabPanel assetId={asset.id} fileKind={inferIntegrityKind(asset)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IntegrityTabPanel — hashes + keyframes from GET /api/v1/assets/:id/integrity
// ---------------------------------------------------------------------------

function inferIntegrityKind(asset: AssetRow): "video" | "raw_camera" | "image" | "other" {
  const t = inferMediaType(asset.title, asset.sourceUri);
  if (t === "video") return "video";
  if (t === "raw") return "raw_camera";
  if (t === "image") return "image";
  return "other";
}

interface IntegrityTabPanelProps {
  assetId: string;
  fileKind: "video" | "raw_camera" | "image" | "other";
}

function IntegrityTabPanel({ assetId, fileKind }: IntegrityTabPanelProps): JSX.Element {
  const state = useAssetIntegrity(assetId);

  if (state.status === "loading") {
    return <div className="p-4 text-sm text-[var(--color-ah-text-muted)]">Loading integrity data…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="p-4">
        <div className="text-sm text-red-400">Unable to load integrity data</div>
        <div className="text-[10px] text-[var(--color-ah-text-subtle)] mt-1 font-[var(--font-ah-mono)]">{state.error}</div>
        <button
          type="button"
          className="mt-3 px-3 py-1 rounded border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] text-[11px] hover:text-[var(--color-ah-text)] cursor-pointer"
          onClick={state.retry}
        >
          Retry
        </button>
      </div>
    );
  }
  if (state.status !== "ready") {
    return <div className="p-4 text-sm text-[var(--color-ah-text-subtle)]">No asset selected.</div>;
  }

  const { hashes, keyframes, sources } = state.data;
  const hashesStatus: "ok" | "empty" | "n/a" = sources.hashes;
  const keyframesStatus: "ok" | "empty" | "n/a" =
    fileKind === "video" || fileKind === "raw_camera" ? sources.keyframes : "n/a";

  return (
    <div className="overflow-auto px-4 py-3 space-y-5" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <div className="flex gap-2">
        <IntegrityStatusPill label="HASHES" status={hashesStatus} />
        <IntegrityStatusPill label="KEYFRAMES" status={keyframesStatus} />
      </div>

      <section>
        <SectionHeader title="Hashes" />
        {hashes ? (
          <dl>
            <MetaRow label="SHA-256" value={truncateHash(hashes.sha256)} copyable />
            {hashes.perceptual_hash && (
              <MetaRow label="Perceptual" value={truncateHash(hashes.perceptual_hash)} />
            )}
            <MetaRow label="Algorithm" value={hashes.algorithm_version} />
            <MetaRow label="Bytes hashed" value={hashes.bytes_hashed.toLocaleString()} />
            <MetaRow
              label="Hashed at"
              value={new Date(hashes.hashed_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
            />
          </dl>
        ) : (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)]">Not yet hashed.</p>
        )}
      </section>

      <section>
        <SectionHeader title="Keyframes" />
        {keyframes ? (
          <dl>
            <MetaRow label="Frames" value={`${keyframes.keyframe_count}`} accent />
            <MetaRow label="Prefix" value={keyframes.keyframe_prefix} copyable />
            {keyframes.thumbnail_key && (
              <MetaRow label="Thumbnail" value={keyframes.thumbnail_key} copyable />
            )}
            {keyframes.extracted_at && (
              <MetaRow
                label="Extracted at"
                value={new Date(keyframes.extracted_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
              />
            )}
          </dl>
        ) : keyframesStatus === "n/a" ? (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)]">Not applicable for this asset kind.</p>
        ) : (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)]">No keyframes.</p>
        )}
      </section>
    </div>
  );
}

function truncateHash(h: string): string {
  if (h.length <= 20) return h;
  return `${h.slice(0, 12)}…${h.slice(-6)}`;
}

function IntegrityStatusPill({ label, status }: { label: string; status: "ok" | "empty" | "n/a" }): JSX.Element {
  const cls =
    status === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : status === "empty"
        ? "bg-[var(--color-ah-bg)] text-[var(--color-ah-text-muted)] border-[var(--color-ah-border)]"
        : "bg-[var(--color-ah-bg)] text-[var(--color-ah-text-subtle)] border-[var(--color-ah-border-muted)]";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border ${cls}`}>
      {label} · {status}
    </span>
  );
}
