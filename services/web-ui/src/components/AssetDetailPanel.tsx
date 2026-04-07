import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton } from "../design-system";
import {
  fetchVersionDetail,
  fetchExrMetadataLookup,
  devAdvanceAsset,
  type VersionDetailInfo,
  type VersionDetailHistoryEvent,
  type ExrMetadataLookupResult,
} from "../api";
import type { AssetRow } from "../types";
import { formatTC } from "../utils/timecode";
import { formatFileSize, inferMediaType } from "../utils/media-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "info" | "aovs" | "vast" | "history";

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

const TABS: { id: TabId; label: string }[] = [
  { id: "info", label: "INFO" },
  { id: "aovs", label: "AOVS" },
  { id: "vast", label: "VAST" },
  { id: "history", label: "HISTORY" },
];

function TabBar({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (t: TabId) => void }) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    if (e.key === "ArrowRight") { e.preventDefault(); onTabChange(TABS[(idx + 1) % TABS.length].id); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onTabChange(TABS[(idx - 1 + TABS.length) % TABS.length].id); }
  }, [activeTab, onTabChange]);

  return (
    <div role="tablist" aria-label="Detail panel tabs" className="flex border-b border-[var(--color-ah-border)]" onKeyDown={handleKeyDown}>
      {TABS.map((tab) => (
        <button key={tab.id} role="tab" type="button"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 px-3 py-2.5 text-[11px] font-medium tracking-[0.08em] cursor-pointer transition-colors ${
            activeTab === tab.id
              ? "text-[var(--color-ah-accent)] border-b-2 border-[var(--color-ah-accent)]"
              : "text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text-muted)]"
          }`}
        >{tab.label}</button>
      ))}
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

          {/* SEQUENCE section — populated from EXR metadata when available */}
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

  // Reset on asset change
  useEffect(() => { setInfo(null); setHistory(null); setExrMeta(null); setActiveTab("info"); }, [asset.id]);

  return (
    <div ref={panelRef} tabIndex={-1}
      className="h-full flex flex-col bg-[var(--color-ah-bg-raised)] border-l border-[var(--color-ah-border)] outline-none"
      role="complementary" aria-label={`Details for ${asset.title}`}
    >
      <PanelHeader asset={asset} info={info} onClose={onClose} />
      <FrameBar info={info} />

      {/* AOV tag pills — show channel layers from EXR metadata */}
      {exrMeta?.found && exrMeta.channels && exrMeta.channels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-[var(--color-ah-border-muted)]">
          {[...new Set(exrMeta.channels.map((c) => c.layer_name || c.channel_name))].map((name) => (
            <span key={name}
              className="px-2 py-0.5 rounded-full text-[10px] font-[var(--font-ah-mono)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)] bg-[var(--color-ah-bg)]"
            >{name}</span>
          ))}
        </div>
      )}

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-hidden">
        {activeTab === "info" && <InfoTab info={loadingInfo ? null : info} asset={asset} exrMeta={exrMeta} onAdvanced={onAdvanced} />}
        {activeTab === "history" && <HistoryTab events={loadingHistory ? null : history} />}
        {activeTab === "aovs" && <AovsTab exrMeta={exrMeta} />}
        {activeTab === "vast" && <VastTab asset={asset} exrMeta={exrMeta} />}
      </div>
    </div>
  );
}
