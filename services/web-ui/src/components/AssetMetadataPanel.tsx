import { useCallback, useState } from "react";

import { Badge } from "../design-system";
import { extractVastPath, formatFileSize } from "../utils/media-types";
import { formatTC } from "../utils/timecode";
import type { AssetRow } from "../types";

interface AssetMetadataPanelProps {
  asset: AssetRow;
  /** Render as a collapsible bottom section (for MediaPreview) vs. full panel */
  variant?: "panel" | "inline";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may fail in insecure contexts
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="ml-1 text-[10px] text-[var(--color-ah-accent)] hover:text-[var(--color-ah-text)] transition-colors shrink-0"
      aria-label={`Copy ${value}`}
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MetaRow({ label, value, copyable }: { label: string; value: string | undefined | null; copyable?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <dt className="text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">{label}</dt>
      <dd className="text-[11px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] text-right truncate flex items-center gap-0.5">
        <span className="truncate">{value}</span>
        {copyable && <CopyButton value={value} />}
      </dd>
    </div>
  );
}

const statusVariant = (s: string) => {
  if (s === "completed" || s === "qc_approved") return "success" as const;
  if (s === "failed" || s === "qc_rejected") return "danger" as const;
  if (s === "processing") return "info" as const;
  return "warning" as const;
};

export function AssetMetadataPanel({ asset, variant = "panel" }: AssetMetadataPanelProps) {
  const vastPath = extractVastPath(asset.sourceUri);
  const meta = asset.metadata;
  const prod = asset.productionMetadata;

  const resolution = meta?.resolution
    ? `${meta.resolution.width} x ${meta.resolution.height}`
    : undefined;

  const frameRange = meta?.frame_range
    ? `${meta.frame_range.start} - ${meta.frame_range.end}`
    : undefined;

  const frameRangeTC = meta?.frame_range && meta?.frame_rate
    ? `${formatTC(meta.frame_range.start / meta.frame_rate, meta.frame_rate)} - ${formatTC(meta.frame_range.end / meta.frame_rate, meta.frame_rate)}`
    : undefined;

  const containerClass = variant === "panel"
    ? "h-full overflow-auto"
    : "";

  return (
    <div className={containerClass} data-testid="asset-metadata-panel">
      {/* ── File Info ── */}
      <details open className="group">
        <summary className="flex items-center gap-2 cursor-pointer py-2 px-1 text-xs font-medium text-[var(--color-ah-text-muted)] tracking-wide uppercase select-none hover:text-[var(--color-ah-text)]">
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 transition-transform group-open:rotate-90">
            <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          File Info
        </summary>
        <dl className="px-1 pb-3 border-b border-[var(--color-ah-border-muted)]">
          <MetaRow label="Status" value={asset.status} />
          <MetaRow label="Source URI" value={asset.sourceUri} copyable />
          <MetaRow label="VAST Path" value={vastPath !== asset.sourceUri ? vastPath : undefined} copyable />
          <MetaRow label="Asset ID" value={asset.id} copyable />
          <MetaRow label="Job ID" value={asset.jobId} copyable />
          <MetaRow label="Resolution" value={resolution} />
          <MetaRow label="Frame Rate" value={meta?.frame_rate ? `${meta.frame_rate} fps` : undefined} />
          <MetaRow label="Frame Range" value={frameRange} />
          <MetaRow label="Timecode Range" value={frameRangeTC} />
          <MetaRow label="Codec" value={meta?.codec} />
          <MetaRow label="Color Space" value={meta?.color_space} />
          <MetaRow label="Bit Depth" value={meta?.bit_depth ? `${meta.bit_depth}-bit` : undefined} />
          <MetaRow label="Compression" value={meta?.compression_type} />
          <MetaRow label="Channels" value={meta?.channels?.join(", ")} />
          <MetaRow label="Pixel Aspect" value={meta?.pixel_aspect_ratio ? String(meta.pixel_aspect_ratio) : undefined} />
          <MetaRow label="File Size" value={formatFileSize(meta?.file_size_bytes)} />
          <MetaRow label="Checksum (MD5)" value={meta?.md5_checksum} copyable />
          {asset.proxy && (
            <>
              <MetaRow label="Proxy Codec" value={asset.proxy.codec} />
              <MetaRow label="Proxy Duration" value={asset.proxy.durationSeconds ? `${asset.proxy.durationSeconds}s` : undefined} />
              <MetaRow label="Proxy Generated" value={asset.proxy.generatedAt ? new Date(asset.proxy.generatedAt).toLocaleDateString() : undefined} />
            </>
          )}
          <MetaRow label="Created" value={asset.createdAt ? new Date(asset.createdAt).toLocaleString() : undefined} />
        </dl>
      </details>

      {/* ── Production Info ── */}
      <details open className="group">
        <summary className="flex items-center gap-2 cursor-pointer py-2 px-1 text-xs font-medium text-[var(--color-ah-text-muted)] tracking-wide uppercase select-none hover:text-[var(--color-ah-text)]">
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 transition-transform group-open:rotate-90">
            <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          Production Info
        </summary>
        <dl className="px-1 pb-3 border-b border-[var(--color-ah-border-muted)]">
          <MetaRow label="Show" value={prod?.show} />
          <MetaRow label="Episode" value={prod?.episode} />
          <MetaRow label="Sequence" value={prod?.sequence} />
          <MetaRow label="Shot" value={prod?.shot} />
          <MetaRow label="Version" value={prod?.version != null ? `v${prod.version}` : asset.version?.version_label} />
          <MetaRow label="Owner" value={prod?.owner} />
          <MetaRow label="Vendor" value={prod?.vendor} />
          <MetaRow label="Priority" value={prod?.priority} />
          <MetaRow label="Due Date" value={prod?.dueDate ? new Date(prod.dueDate).toLocaleDateString() : undefined} />
          {asset.reviewStatus && (
            <div className="flex items-start justify-between gap-2 py-1">
              <dt className="text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">Review Status</dt>
              <dd>
                <Badge variant={statusVariant(asset.reviewStatus)}>{asset.reviewStatus}</Badge>
              </dd>
            </div>
          )}
        </dl>
      </details>

      {/* ── Pipeline Info ── */}
      <details open className="group">
        <summary className="flex items-center gap-2 cursor-pointer py-2 px-1 text-xs font-medium text-[var(--color-ah-text-muted)] tracking-wide uppercase select-none hover:text-[var(--color-ah-text)]">
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 transition-transform group-open:rotate-90">
            <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          Pipeline Info
        </summary>
        <dl className="px-1 pb-3">
          <MetaRow label="Pipeline Stage" value={prod?.pipeline_stage} />
          {asset.annotationHook && (
            <>
              <MetaRow label="Annotations" value={asset.annotationHook.enabled ? "Enabled" : "Disabled"} />
              <MetaRow label="Annotation Provider" value={asset.annotationHook.provider} />
              <MetaRow label="Context ID" value={asset.annotationHook.contextId} copyable />
            </>
          )}
          {asset.handoff && (
            <>
              <MetaRow label="Handoff Status" value={asset.handoff.status} />
              <MetaRow label="Handoff Owner" value={asset.handoff.owner} />
            </>
          )}
          {asset.handoffChecklist && (
            <div className="mt-1 space-y-0.5">
              <dt className="text-[11px] text-[var(--color-ah-text-subtle)]">Handoff Checklist</dt>
              {Object.entries(asset.handoffChecklist).map(([key, val]) => (
                <dd key={key} className="flex items-center gap-1.5 text-[11px] text-[var(--color-ah-text-muted)] pl-2">
                  <span className={val ? "text-[var(--color-ah-success)]" : "text-[var(--color-ah-text-subtle)]"}>
                    {val ? "\u2713" : "\u2717"}
                  </span>
                  {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                </dd>
              ))}
            </div>
          )}
        </dl>
      </details>
    </div>
  );
}
