import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";

import { fetchAssets, fetchVersionDependencies, fetchCatalogUnregistered, ingestAsset, fetchExrMetadataLookup, fetchVideoMetadataLookup, fetchMediaUrls, type AssetRow, type AssetDependencyData, type UnregisteredFile, type ExrMetadataLookupResult, type VideoMetadataLookupResult } from "../api";
import { Badge, Button, Input, Skeleton } from "../design-system";
import { AssetDetailPanel } from "../components/AssetDetailPanel";
import { metadataKindForFilename } from "../utils/metadata-routing";

import { AssetSelectionToolbar } from "../components/AssetSelectionToolbar";
import { CloseIcon } from "../components/CloseIcon";
import { MediaTypeIcon } from "../components/MediaTypeIcon";
import type { PipelineStage } from "../types";
import {
  inferMediaType,
  getTypeBadge,
  getThumbGradient,
  formatFileSize,
  formatDuration,
  extractVastPath,
} from "../utils/media-types";

export type ViewMode = "gallery" | "list" | "compact";

// ---------------------------------------------------------------------------
// Sequence grouping — detect EXR frame sequences and group them
// ---------------------------------------------------------------------------

const FRAME_PATTERN = /^(.+?)(\d{3,8})(\.[^.]+)$/;

interface AssetSequence {
  kind: "sequence";
  key: string;
  baseName: string;       // e.g. "pixar_"
  ext: string;            // e.g. ".exr"
  pattern: string;        // e.g. "pixar_####.exr"
  frameStart: number;
  frameEnd: number;
  frameCount: number;
  padding: number;
  assets: AssetRow[];
  representative: AssetRow; // middle frame for detail panel
}

interface AssetSingle {
  kind: "single";
  key: string;
  asset: AssetRow;
}

type AssetEntry = AssetSequence | AssetSingle;

/** Extract bucket or location prefix from a sourceUri for grouping. */
function extractLocation(sourceUri: string): string {
  // s3://bucket-name/path -> "s3://bucket-name"
  const s3Match = sourceUri.match(/^s3:\/\/([^/]+)/);
  if (s3Match) return `s3://${s3Match[1]}`;
  // /uploads/uuid/file -> "/uploads"
  const pathMatch = sourceUri.match(/^(\/[^/]+)/);
  if (pathMatch) return pathMatch[1];
  return "";
}

function groupIntoSequences(assets: AssetRow[]): AssetEntry[] {
  const seqMap = new Map<string, { baseName: string; ext: string; padding: number; location: string; frames: Array<{ num: number; asset: AssetRow }> }>();
  const singles: AssetRow[] = [];

  for (const asset of assets) {
    const match = FRAME_PATTERN.exec(asset.title);
    if (match) {
      const [, base, frameStr, ext] = match;
      // Include location in key so frames from different buckets stay separate
      const location = extractLocation(asset.sourceUri);
      const key = `${location}|${base}|${ext}`;
      if (!seqMap.has(key)) {
        seqMap.set(key, { baseName: base, ext, padding: frameStr.length, location, frames: [] });
      }
      seqMap.get(key)!.frames.push({ num: parseInt(frameStr, 10), asset });
    } else {
      singles.push(asset);
    }
  }

  const entries: AssetEntry[] = [];

  for (const [, seq] of seqMap) {
    if (seq.frames.length < 2) {
      // Single frame — not a sequence
      singles.push(seq.frames[0].asset);
      continue;
    }
    seq.frames.sort((a, b) => a.num - b.num);
    const hashes = "#".repeat(seq.padding);
    const middleIdx = Math.floor(seq.frames.length / 2);
    entries.push({
      kind: "sequence",
      key: `seq-${seq.baseName}${seq.ext}`,
      baseName: seq.baseName,
      ext: seq.ext,
      pattern: `${seq.baseName}${hashes}${seq.ext}`,
      frameStart: seq.frames[0].num,
      frameEnd: seq.frames[seq.frames.length - 1].num,
      frameCount: seq.frames.length,
      padding: seq.padding,
      assets: seq.frames.map((f) => f.asset),
      representative: seq.frames[middleIdx].asset,
    });
  }

  for (const asset of singles) {
    entries.push({ kind: "single", key: asset.id, asset });
  }

  return entries;
}

const statusVariant = (s: string) => {
  if (s === "completed" || s === "qc_approved") return "success" as const;
  if (s === "failed" || s === "qc_rejected") return "danger" as const;
  if (s === "processing") return "info" as const;
  return "warning" as const;
};


function LazyThumbnail({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <img
      ref={imgRef}
      src={visible ? src : undefined}
      alt={alt}
      className={className}
      loading="lazy"
    />
  );
}

const LIST_ROW_HEIGHT = 44;
const COMPACT_ROW_HEIGHT = 32;

interface ThumbnailCardProps {
  asset: AssetRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onPreview: (asset: AssetRow) => void;
  onDetail: (asset: AssetRow) => void;
}

function ThumbnailCard({ asset, selected, onSelect, onPreview, onDetail }: ThumbnailCardProps) {
  const [hovered, setHovered] = useState(false);
  const [resolvedThumb, setResolvedThumb] = useState<string | null>(null);
  const mediaType = inferMediaType(asset.title, asset.sourceUri);
  const badge = getTypeBadge(mediaType);
  const gradient = getThumbGradient(mediaType);
  const vastPath = extractVastPath(asset.sourceUri);
  const duration = asset.proxy?.durationSeconds;
  const isProcessing = asset.status === "processing";

  // Lazy-resolve thumbnail from S3 when asset record has none.
  // Retries every 15s while proxies are being generated.
  useEffect(() => {
    if (asset.thumbnail?.uri || !asset.sourceUri) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      void fetchMediaUrls(asset.sourceUri).then((urls) => {
        if (cancelled) return;
        if (urls.thumbnail) { setResolvedThumb(urls.thumbnail); return; }
        // Retry — proxies may still be generating
        retryTimer = setTimeout(attempt, 15_000);
      });
    };
    attempt();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [asset.sourceUri, asset.thumbnail?.uri]);

  return (
    <div
      className={`relative cursor-pointer transition-all overflow-hidden rounded-[9px] border ${
        selected
          ? "border-[var(--color-ah-accent)] shadow-[0_0_0_1px_var(--color-ah-accent),0_0_22px_rgba(6,182,212,0.17)]"
          : "border-[var(--color-ah-border)] hover:border-[var(--color-ah-accent)]/40 hover:shadow-[0_4px_22px_rgba(0,0,0,.45),0_0_14px_rgba(6,182,212,.09)] hover:-translate-y-0.5"
      } bg-[var(--color-ah-bg-raised)]`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onDetail(asset)}
      onDoubleClick={() => onPreview(asset)}
    >
      {/* ── Thumbnail area ── */}
      <div
        className="relative aspect-video flex items-center justify-center overflow-hidden"
        style={{ background: gradient }}
      >
        {(asset.thumbnail?.uri || resolvedThumb) ? (
          hovered && asset.proxy?.uri ? (
            <video src={asset.proxy.uri} autoPlay muted loop className="w-full h-full object-cover" />
          ) : (
            <LazyThumbnail src={(asset.thumbnail?.uri ?? resolvedThumb)!} alt={asset.title} className="w-full h-full object-cover" />
          )
        ) : (
          <MediaTypeIcon type={mediaType} size={52} className="text-[var(--color-ah-text-muted)]" />
        )}

        {/* Type badge — top-left */}
        <span
          className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wider font-[var(--font-ah-mono)]"
          style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.border, borderWidth: 1 }}
        >
          {mediaType === "video" && asset.title.toLowerCase().includes("4k") ? "4K VIDEO" : badge.label}
        </span>

        {/* Duration — bottom-right */}
        {duration !== undefined && duration > 0 && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-accent)]">
            {formatDuration(duration)}
          </span>
        )}

        {/* Selection checkbox — top-right */}
        {(hovered || selected) && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onSelect(asset.id); }}
            className="absolute top-2 right-2 w-4 h-4 accent-[var(--color-ah-accent)] cursor-pointer"
            aria-label={`Select ${asset.title}`}
          />
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-[var(--color-ah-accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-medium tracking-widest text-[var(--color-ah-accent)] font-[var(--font-ah-mono)]">TRANSCODING</span>
          </div>
        )}
      </div>

      {/* ── Card body ── */}
      <div className="px-2.5 py-2 space-y-0.5">
        {/* Filename */}
        <div className="text-xs font-medium text-[var(--color-ah-text)] truncate">{asset.title}</div>
        {/* Sequence/Shot + Owner */}
        {(asset.productionMetadata?.sequence || asset.productionMetadata?.shot || asset.productionMetadata?.owner) && (
          <div className="flex items-center justify-between">
            {(asset.productionMetadata.sequence || asset.productionMetadata.shot) && (
              <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-muted)]">
                {[asset.productionMetadata.sequence, asset.productionMetadata.shot].filter(Boolean).join(" / ")}
              </span>
            )}
            {asset.productionMetadata.owner && (
              <span className="w-5 h-5 rounded-full bg-[var(--color-ah-accent-muted)]/20 text-[9px] font-bold text-[var(--color-ah-accent)] flex items-center justify-center shrink-0" title={asset.productionMetadata.owner}>
                {asset.productionMetadata.owner.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
              </span>
            )}
          </div>
        )}
        {/* Size + codec */}
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-muted)]">
            {formatFileSize(asset.metadata?.file_size_bytes) || badge.label.toLowerCase()}
          </span>
          {asset.proxy?.codec && (
            <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-subtle)]">{asset.proxy.codec}</span>
          )}
        </div>
        {/* Proxy generatedAt */}
        {asset.proxy?.generatedAt && (
          <div className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)]">
            proxy: {asset.proxy.codec}{asset.proxy.generatedAt ? ` \u00B7 ${new Date(asset.proxy.generatedAt).toLocaleDateString()}` : ""}
          </div>
        )}
        {/* Storage path */}
        <div className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-accent)]/60 truncate">
          {asset.elementPath ?? vastPath}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SequenceCard — grouped EXR sequence thumbnail card (like Frame.io)
// ---------------------------------------------------------------------------

interface SequenceCardProps {
  sequence: AssetSequence;
  onPreview: (asset: AssetRow) => void;
  onDetail: (asset: AssetRow) => void;
}

function SequenceCard({ sequence, onPreview, onDetail }: SequenceCardProps) {
  const gradient = getThumbGradient("image");
  const rep = sequence.representative;
  const totalSize = sequence.assets.reduce((sum, a) => sum + (a.metadata?.file_size_bytes ?? 0), 0);
  const [resolvedThumb, setResolvedThumb] = useState<string | null>(null);

  useEffect(() => {
    if (rep.thumbnail?.uri || !rep.sourceUri) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      void fetchMediaUrls(rep.sourceUri).then((urls) => {
        if (cancelled) return;
        if (urls.thumbnail) { setResolvedThumb(urls.thumbnail); return; }
        retryTimer = setTimeout(attempt, 15_000);
      });
    };
    attempt();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [rep.sourceUri, rep.thumbnail?.uri]);

  return (
    <div
      className="group relative cursor-pointer transition-all overflow-hidden rounded-[9px] border border-[var(--color-ah-border)] hover:border-[var(--color-ah-accent)]/40 hover:shadow-[0_4px_22px_rgba(0,0,0,.45),0_0_14px_rgba(6,182,212,.09)] hover:-translate-y-0.5 bg-[var(--color-ah-bg-raised)]"
      onClick={() => onDetail(rep)}
      onDoubleClick={() => onPreview(rep)}
    >
      {/* Thumbnail area */}
      <div
        className="relative aspect-video flex items-center justify-center overflow-hidden"
        style={{ background: gradient }}
      >
        {(rep.thumbnail?.uri || resolvedThumb) ? (
          <LazyThumbnail src={(rep.thumbnail?.uri ?? resolvedThumb)!} alt={sequence.pattern} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1">
            <MediaTypeIcon type="image" size={36} className="text-[var(--color-ah-text-muted)]" />
            <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)]">
              {sequence.frameCount} frames
            </span>
          </div>
        )}

        {/* EXR SEQ badge */}
        <span
          className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wider font-[var(--font-ah-mono)]"
          style={{ color: "#a855f7", backgroundColor: "rgba(168,85,247,0.12)", borderColor: "rgba(168,85,247,0.25)", borderWidth: 1 }}
        >
          EXR SEQ
        </span>

        {/* Frame range — bottom */}
        <div className="absolute bottom-0 inset-x-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
          <span className="font-[var(--font-ah-mono)] text-[10px] text-gray-300">
            {sequence.frameStart}&ndash;{sequence.frameEnd} &middot; {sequence.frameCount} frames
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="px-2.5 py-2 space-y-0.5">
        <div className="text-xs font-medium text-[var(--color-ah-text)] truncate">{sequence.pattern}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-[var(--font-ah-mono)] bg-[var(--color-ah-bg)] border border-[var(--color-ah-border)] text-[var(--color-ah-text-muted)]">
            {sequence.frameCount} frames
          </span>
          {totalSize > 0 && (
            <span className="font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-text-muted)]">
              {formatFileSize(totalSize)}
            </span>
          )}
        </div>
        <div className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-accent)]/60 truncate flex items-center gap-1">
          <span className="truncate">{extractVastPath(rep.sourceUri).replace(/[^/]+$/, sequence.pattern)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const text = extractVastPath(rep.sourceUri).replace(/[^/]+$/, sequence.pattern);
              if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
              else { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
            }}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-ah-accent)] cursor-pointer"
            title="Copy path"
          >
            &#128203;
          </button>
        </div>
      </div>
    </div>
  );
}

interface MediaPreviewProps {
  asset: AssetRow;
  assets: AssetRow[];
  onClose: () => void;
  onNavigate: (asset: AssetRow) => void;
}

function attrDisplayValue(attr: { value_text?: string | null; value_float?: number | null; value_int?: number | null }): string {
  if (attr.value_text != null && attr.value_text !== "") return attr.value_text;
  if (attr.value_float != null) return String(attr.value_float);
  if (attr.value_int != null) return String(attr.value_int);
  return "(empty)";
}

// Dynamic-field helpers used by the video metadata rendering path. Both are
// schema-agnostic: humanizeMetaLabel turns snake_case / camelCase column
// names into "Title Case" display labels, and formatMetaFieldValue coerces
// any JSON value (string / number / bool / array / nested object) to a safe
// display string. Keeps the sidebar robust to whatever shape the
// video-metadata-extractor function decides to emit.
function humanizeMetaLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetaFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => formatMetaFieldValue(v)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function MediaPreview({ asset, assets, onClose, onNavigate }: MediaPreviewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [exrMeta, setExrMeta] = useState<ExrMetadataLookupResult | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMetadataLookupResult | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  const currentIndex = assets.findIndex((a) => a.id === asset.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < assets.length - 1;
  const goPrev = () => { if (hasPrev) onNavigate(assets[currentIndex - 1]); };
  const goNext = () => { if (hasNext) onNavigate(assets[currentIndex + 1]); };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "i" || e.key === "I") setSidebarOpen((p) => !p);
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Load presigned URLs — progressive: show thumb fast, swap in full-res preview
  useEffect(() => {
    setThumbUrl(null);
    setPreviewUrl(null);
    setPreviewLoaded(false);
    void fetchMediaUrls(asset.sourceUri).then((urls) => {
      const mt = inferMediaType(asset.title, asset.sourceUri);
      if (mt === "video" && urls.proxy) {
        setPreviewUrl(urls.proxy);
        setPreviewLoaded(true);
      } else {
        // Show thumbnail immediately as placeholder
        if (urls.thumbnail) setThumbUrl(urls.thumbnail);
        // Full-res: preview > source (for browser-native images)
        const fullRes = urls.preview ?? urls.source;
        if (fullRes && fullRes !== urls.thumbnail) {
          setPreviewUrl(fullRes);
          // previewLoaded stays false until <img onLoad> fires
        } else if (urls.thumbnail) {
          // No higher-res available — thumb is the best we have
          setPreviewUrl(urls.thumbnail);
          setPreviewLoaded(true);
        }
      }
    });
  }, [asset.sourceUri, asset.title]);

  // Load metadata — routed by file extension to the right DataEngine lookup.
  // EXR files go through fetchExrMetadataLookup (oiio-inspector schema),
  // video + raw camera files go through fetchVideoMetadataLookup
  // (video-metadata-extractor schema). The extension→kind mapping lives in
  // utils/metadata-routing so the Storage Browser and this view stay in sync.
  useEffect(() => {
    setExrMeta(null);
    setVideoMeta(null);
    if (!asset.sourceUri) return;

    const filename = asset.title || asset.sourceUri.split("/").pop() || "";
    const kind = metadataKindForFilename(filename);

    if (kind === "image") {
      void fetchExrMetadataLookup(asset.sourceUri).then((res) => {
        if (res.found) { setExrMeta(res); return; }
        // Fallback: try the bare filename (the exr_metadata table may store
        // filenames without the full s3:// prefix).
        if (filename && filename !== asset.sourceUri) {
          void fetchExrMetadataLookup(filename).then(setExrMeta);
        } else {
          setExrMeta(res);
        }
      });
    } else if (kind === "video") {
      void fetchVideoMetadataLookup(asset.sourceUri).then((res) => {
        if (res.found) { setVideoMeta(res); return; }
        if (filename && filename !== asset.sourceUri) {
          void fetchVideoMetadataLookup(filename).then(setVideoMeta);
        } else {
          setVideoMeta(res);
        }
      });
    }
    // kind === "none" — no metadata expected, leave both null.
  }, [asset.sourceUri, asset.title]);

  const exr = exrMeta?.found ? exrMeta : null;
  const summary = exr?.summary;
  const firstPart = exr?.parts?.[0];
  const mediaType = inferMediaType(asset.title, asset.sourceUri);

  // Build dynamic fields
  const fields: Array<{ group: string; label: string; value: string }> = [];
  const addField = (group: string, label: string, value: string | number | null | undefined) => {
    if (value == null || value === "" || value === "unknown") return;
    fields.push({ group, label, value: String(value) });
  };

  addField("File", "Filename", asset.title);
  addField("File", "Source", asset.sourceUri);
  if (asset.metadata?.file_size_bytes) addField("File", "Size", formatFileSize(asset.metadata.file_size_bytes));
  else if (exr?.file?.size_bytes) addField("File", "Size", formatFileSize(exr.file.size_bytes));
  if (asset.createdAt) addField("File", "Created", new Date(asset.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }));

  if (summary) {
    addField("Image", "Resolution", summary.resolution);
    addField("Image", "Compression", summary.compression);
    addField("Image", "Channels", String(summary.channelCount));
    addField("Image", "Color Space", summary.colorSpace);
    if (summary.isDeep) addField("Image", "Type", "Deep EXR");
    if (summary.frameNumber != null) addField("Image", "Frame", String(summary.frameNumber));
  }

  if (firstPart) {
    if (firstPart.render_software) addField("Technical", "Render Software", firstPart.render_software);
    if (firstPart.display_window) addField("Technical", "Display Window", firstPart.display_window);
    else if (firstPart.display_width) addField("Technical", "Display Window", `${firstPart.display_width}x${firstPart.display_height}`);
    if (firstPart.data_window) addField("Technical", "Data Window", firstPart.data_window);
    if (firstPart.pixel_aspect_ratio != null && firstPart.pixel_aspect_ratio !== 1) addField("Technical", "Pixel Aspect", String(firstPart.pixel_aspect_ratio));
    if (firstPart.line_order) addField("Technical", "Line Order", firstPart.line_order);
    if (firstPart.is_tiled) addField("Technical", "Tiling", `${firstPart.tile_width ?? "?"}x${firstPart.tile_height ?? "?"}`);
    if (firstPart.multi_view) addField("Technical", "Multi-View", "Yes");
  }

  if (exr?.attributes) {
    for (const attr of exr.attributes) {
      addField("Attributes", attr.attr_name, attrDisplayValue(attr));
    }
  }

  // Video metadata — dynamic rendering since the video_metadata schema is
  // owned by the functions team and we don't want to hardcode field names.
  // summary goes into a "Media" group for prominence; every other column
  // from the raw row falls through to a generic "Attributes" group via the
  // attributes array.
  const video = videoMeta?.found ? videoMeta : null;
  if (video?.summary) {
    for (const [key, value] of Object.entries(video.summary)) {
      if (value === undefined || value === null || value === "") continue;
      addField("Media", humanizeMetaLabel(key), formatMetaFieldValue(value));
    }
  }
  if (video?.attributes) {
    for (const attr of video.attributes) {
      addField("Attributes", humanizeMetaLabel(attr.name), formatMetaFieldValue(attr.value));
    }
  }

  const grouped = new Map<string, typeof fields>();
  for (const f of fields) {
    if (!grouped.has(f.group)) grouped.set(f.group, []);
    grouped.get(f.group)!.push(f);
  }

  const effectiveProxy = asset.proxy?.uri ?? (mediaType === "video" ? previewUrl : null);
  // Progressive: show thumb while full-res loads
  const displayUrl = previewLoaded ? previewUrl : (thumbUrl ?? previewUrl);
  const isLoading = !thumbUrl && !previewUrl && asset.sourceUri.startsWith("s3://");

  return (
    <div className="fixed inset-0 z-50 flex bg-[#0d0d0f]" role="dialog" aria-label={`Preview: ${asset.title}`}>

      {/* ── Left: full-bleed media viewer ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Top bar — breadcrumb style like Frame.io */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#0d0d0f]/80 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2 min-w-0">
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white transition-colors cursor-pointer mr-1" title="Back to library">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 15L7 10L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span className="text-[13px] text-gray-500">Library</span>
            <span className="text-gray-600 text-xs">/</span>
            <h2 className="text-[13px] font-medium text-white truncate">{asset.title}</h2>
            {summary && (
              <span className="text-[10px] font-[var(--font-ah-mono)] text-gray-500 shrink-0 ml-2">
                {summary.resolution} &middot; {summary.compression}
                {summary.colorSpace !== "unknown" ? ` \u00b7 ${summary.colorSpace}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Prev/Next navigation */}
            <div className="flex items-center gap-1">
              <button type="button" onClick={goPrev} disabled={!hasPrev}
                className={`w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors ${hasPrev ? "text-gray-300 hover:text-white hover:bg-white/10" : "text-gray-700 cursor-default"}`}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <span className="text-[11px] text-gray-500 font-[var(--font-ah-mono)] min-w-[60px] text-center">
                {currentIndex >= 0 ? `${currentIndex + 1} of ${assets.length}` : ""}
              </span>
              <button type="button" onClick={goNext} disabled={!hasNext}
                className={`w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors ${hasNext ? "text-gray-300 hover:text-white hover:bg-white/10" : "text-gray-700 cursor-default"}`}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
            <button type="button" onClick={() => setSidebarOpen((p) => !p)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                sidebarOpen ? "bg-white/10 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
              }`} title="Toggle info sidebar (I)">
              {sidebarOpen ? "Hide Info" : "Show Info"}
            </button>
          </div>
        </div>

        {/* Media viewport — image fills the space */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {/* Hidden preload: load full-res in background, swap on ready */}
          {previewUrl && !previewLoaded && (
            <img src={previewUrl} alt="" className="hidden" onLoad={() => setPreviewLoaded(true)} />
          )}
          {effectiveProxy ? (
            <video src={effectiveProxy} controls autoPlay className="w-full h-full object-contain" />
          ) : displayUrl ? (
            <img src={displayUrl} alt={asset.title} className="w-full h-full object-contain select-none" draggable={false} />
          ) : isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-gray-700 border-t-[var(--color-ah-accent)] rounded-full animate-spin" />
              <span className="text-sm text-gray-500">Loading preview...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-600">
              <MediaTypeIcon type={mediaType} size={72} className="text-gray-700" />
              <span className="text-sm">No preview available</span>
              <span className="text-[10px] font-[var(--font-ah-mono)] text-gray-700">{asset.sourceUri}</span>
            </div>
          )}

          {/* Hover nav arrows — large click targets on edges */}
          {hasPrev && (
            <button type="button" onClick={goPrev}
              className="absolute left-0 top-0 bottom-0 w-16 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer group">
              <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition-colors">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 15L7 10L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </button>
          )}
          {hasNext && (
            <button type="button" onClick={goNext}
              className="absolute right-0 top-0 bottom-0 w-16 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer group">
              <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition-colors">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 5L13 10L8 15" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </button>
          )}
        </div>

        {/* Bottom bar — actions */}
        <div className="flex items-center justify-center gap-3 px-5 py-2.5 bg-[#0d0d0f]/80 backdrop-blur-sm">
          <button type="button"
            onClick={() => window.open(`rvlink://${asset.sourceUri}`, "_blank")}
            className="px-3 py-1.5 rounded bg-[var(--color-ah-accent)] text-[var(--color-ah-bg)] text-[11px] font-semibold cursor-pointer hover:brightness-110 transition-all flex items-center gap-1.5">
            <span>&#9655;</span> Open in RV
          </button>
          <button type="button"
            onClick={() => void navigator.clipboard.writeText(asset.sourceUri)}
            className="px-3 py-1.5 rounded border border-gray-700 text-gray-300 text-[11px] font-medium cursor-pointer hover:bg-white/5 transition-colors">
            Copy Path
          </button>
        </div>
      </div>

      {/* ── Right sidebar — metadata fields ── */}
      {sidebarOpen && (
        <div className="w-[340px] shrink-0 bg-[#141418] border-l border-[#1e1e24] flex flex-col overflow-hidden">
          {/* Header with filename + format/resolution badges */}
          <div className="px-5 pt-5 pb-4 border-b border-[#1e1e24]">
            <h3 className="text-[14px] font-semibold text-white mb-1 truncate">{asset.title}</h3>
            {asset.createdAt && (
              <p className="text-[11px] text-gray-500 mb-3">
                Created {new Date(asset.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            )}
            {summary && (
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-[9px] font-[var(--font-ah-mono)] tracking-[0.12em] text-gray-500 uppercase mb-0.5">Format</div>
                  <div className="text-[13px] font-semibold text-white">{summary.compression?.toUpperCase() || "EXR"}</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] font-[var(--font-ah-mono)] tracking-[0.12em] text-gray-500 uppercase mb-0.5">Resolution</div>
                  <div className="text-[13px] font-semibold text-white">{summary.resolution}</div>
                </div>
              </div>
            )}
          </div>

          {/* Scrollable fields */}
          <div className="flex-1 overflow-auto px-5 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-medium text-gray-300">All Fields ({fields.length})</span>
            </div>
            {[...grouped.entries()].map(([group, gFields]) => (
              <div key={group} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.14em] text-gray-500 uppercase">
                    {group}
                  </span>
                  <span className="font-[var(--font-ah-mono)] text-[9px] text-gray-600">({gFields.length})</span>
                  <div className="flex-1 h-px bg-[#1e1e24]" />
                </div>
                <dl>
                  {gFields.map((f) => (
                    <div key={f.label} className="flex items-baseline justify-between gap-3 py-[4px]">
                      <dt className="font-[var(--font-ah-mono)] text-[11px] text-gray-500 shrink-0">{f.label}</dt>
                      <dd className="text-[11px] font-[var(--font-ah-mono)] text-gray-200 text-right truncate max-w-[180px]" title={f.value}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {fields.length === 0 && (
              <p className="text-[11px] text-gray-600 py-4 text-center">
                {exrMeta === null ? "Loading metadata..." : "No metadata available."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface FilterBarProps {
  search: string;
  statusFilter: string;
  sortBy: string;
  pipelineStage: string;
  mediaTypeFilter: string;
  statusOptions: StatusOption[];
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onSortChange: (v: string) => void;
  onPipelineStageChange: (v: string) => void;
  onMediaTypeChange: (v: string) => void;
}

export interface StatusOption {
  /** Raw status value, e.g. "pending", "qc_approved". Matches AssetRow.status. */
  value: string;
  /** Humanized label, e.g. "Pending", "QC Approved". */
  label: string;
  /** Number of assets in the loaded list with this status. */
  count: number;
}

/** Canonical ordering for known workflow statuses — unknown/new statuses
 *  sort alphabetically after these in the dropdown. Keep this in sync
 *  with VALID_STATUSES in services/control-plane/src/routes/assets.ts. */
const STATUS_SORT_ORDER: readonly string[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "needs_replay",
  "qc_pending",
  "qc_in_review",
  "qc_approved",
  "qc_rejected",
  "revision_required",
  "retake",
  "client_submitted",
  "client_approved",
  "client_rejected",
];

/** Convert a snake_case workflow status into a human-friendly label. */
export function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ")
    .replace(/^Qc\b/, "QC");
}

/**
 * Build the status dropdown options from the currently-loaded asset list.
 * Data-driven so the dropdown never drifts from the backend's status set —
 * a new status appears automatically the first time an asset carries it,
 * and disappears when no assets have it anymore.
 */
export function buildStatusOptions(assets: { status: string }[]): StatusOption[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const s = asset.status;
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).map(([value, count]) => ({
    value,
    count,
    label: humanizeStatus(value),
  }));
  entries.sort((a, b) => {
    const aIdx = STATUS_SORT_ORDER.indexOf(a.value);
    const bIdx = STATUS_SORT_ORDER.indexOf(b.value);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.value.localeCompare(b.value);
  });
  return entries;
}

const PIPELINE_STAGES: PipelineStage[] = ["animation", "lighting", "comp", "fx", "lookdev", "roto", "paint", "editorial"];

const MEDIA_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Document" },
  { value: "3d", label: "3D" },
  { value: "raw", label: "Raw" },
  { value: "vfx", label: "VFX" },
  { value: "ai", label: "AI" },
];

function FilterBar({ search, statusFilter, sortBy, pipelineStage, mediaTypeFilter, statusOptions, onSearchChange, onStatusChange, onSortChange, onPipelineStageChange, onMediaTypeChange }: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(search);

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <Input label="Search" value={localSearch} onChange={(e) => { setLocalSearch(e.target.value); onSearchChange(e.target.value); }} placeholder="Filter assets..." />
      <div className="grid gap-1.5">
        <label htmlFor="filter-type" className="text-sm font-medium text-[var(--color-ah-text-muted)]">Type</label>
        <select
          id="filter-type"
          value={mediaTypeFilter}
          onChange={(e) => onMediaTypeChange(e.target.value)}
          className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]"
        >
          {MEDIA_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="filter-status" className="text-sm font-medium text-[var(--color-ah-text-muted)]">Status</label>
        <select
          id="filter-status"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]"
        >
          <option value="">All ({statusOptions.reduce((sum, o) => sum + o.count, 0)})</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="filter-pipeline" className="text-sm font-medium text-[var(--color-ah-text-muted)]">Department</label>
        <select
          id="filter-pipeline"
          value={pipelineStage}
          onChange={(e) => onPipelineStageChange(e.target.value)}
          className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]"
        >
          <option value="">All</option>
          {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="filter-sort" className="text-sm font-medium text-[var(--color-ah-text-muted)]">Sort</label>
        <select
          id="filter-sort"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)]"
        >
          <option value="name">Name</option>
          <option value="date">Date</option>
          <option value="status">Status</option>
        </select>
      </div>
    </div>
  );
}

/* ── Propagation Alert Banner ── */

interface StaleRenderAlert {
  assetId: string;
  assetTitle: string;
  dependencyId: string;
  dependencyType: string;
}

function PropagationAlertBanner({ assets }: { assets: AssetRow[] }) {
  const [alerts, setAlerts] = useState<StaleRenderAlert[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Check assets for stale upstream dependencies.
    // Compares upstream dependency modification dates against the asset's last render date.
    async function checkStaleDeps() {
      const staleAlerts: StaleRenderAlert[] = [];

      for (const asset of assets.slice(0, 10)) {
        if (!asset.version?.parent_version_id) continue;
        try {
          const deps = await fetchVersionDependencies(asset.id);
          for (const dep of deps) {
            // Flag when upstream dependency was discovered after the asset's creation
            if (asset.createdAt && dep.discoveredAt > asset.createdAt) {
              staleAlerts.push({
                assetId: asset.id,
                assetTitle: asset.title,
                dependencyId: dep.targetEntityId,
                dependencyType: dep.dependencyType,
              });
            }
          }
        } catch {
          // Ignore fetch errors
        }
      }

      if (cancelled) return;
      setAlerts(staleAlerts);
    }

    void checkStaleDeps();
    return () => { cancelled = true; };
  }, [assets]);

  if (dismissed || alerts.length === 0) return null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 mt-4 rounded-[var(--radius-ah-md)] border"
      style={{
        backgroundColor: "rgba(249, 115, 22, 0.06)",
        borderColor: "var(--color-ah-orange)",
      }}
      data-testid="propagation-alert"
    >
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
        style={{
          backgroundColor: "rgba(249, 115, 22, 0.2)",
          color: "var(--color-ah-orange)",
        }}
      >
        !
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ah-orange)" }}>
          Propagation Alert: {alerts.length} asset{alerts.length !== 1 ? "s have" : " has"} stale upstream dependencies
        </p>
        <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5">
          Upstream dependencies were modified more recently than these assets' last render dates.
        </p>
        <ul className="mt-2 grid gap-1">
          {alerts.slice(0, 3).map((alert) => (
            <li key={`${alert.assetId}-${alert.dependencyId}`} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--color-ah-orange)" }} />
              <span className="font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] truncate">{alert.assetTitle}</span>
              <span className="text-[var(--color-ah-text-subtle)]">
                — {alert.dependencyType.replace(/_/g, " ")}
              </span>
            </li>
          ))}
          {alerts.length > 3 && (
            <li className="text-xs text-[var(--color-ah-text-subtle)] ml-3.5">
              ...and {alerts.length - 3} more
            </li>
          )}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text)] cursor-pointer text-sm"
        aria-label="Dismiss propagation alert"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-3">
      <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.12em] text-[var(--color-ah-text-subtle)] uppercase whitespace-nowrap">
        {label} — {count} asset{count !== 1 ? "s" : ""}
      </span>
      <div className="flex-1 h-px bg-[var(--color-ah-border-muted)]" />
    </div>
  );
}


/* -- Unregistered Files Discovery Panel (C.10) -- */

function UnregisteredFilesPanel() {
  const [files, setFiles] = useState<UnregisteredFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [registering, setRegistering] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    void fetchCatalogUnregistered("/").then((f) => {
      setFiles(f);
      setLoading(false);
    });
  }, []);

  const handleRegister = useCallback(async (file: UnregisteredFile) => {
    setRegistering((prev) => new Set(prev).add(file.elementHandle));
    try {
      const filename = file.path.split("/").pop() ?? file.path;
      await ingestAsset({
        title: filename,
        sourceUri: file.path.startsWith("/") ? file.path : `/${file.path}`,
      });
      setFiles((prev) => prev.filter((f) => f.elementHandle !== file.elementHandle));
    } catch {
      // Registration failed - remove from registering set
    } finally {
      setRegistering((prev) => {
        const next = new Set(prev);
        next.delete(file.elementHandle);
        return next;
      });
    }
  }, []);

  if (files.length === 0 && !loading) return null;

  return (
    <div className="mt-4 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border-muted)] bg-[var(--color-ah-bg-raised)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ backgroundColor: "rgba(6, 182, 212, 0.15)", color: "var(--color-ah-accent)" }}
          >
            {files.length}
          </span>
          <span className="text-sm font-medium text-[var(--color-ah-text)]">
            Unregistered Files on VAST
          </span>
          <span className="text-xs text-[var(--color-ah-text-subtle)]">
            Files found via VAST Catalog that are not registered in SpaceHarbor
          </span>
        </div>
        <span className="text-[var(--color-ah-text-muted)] text-sm">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-ah-border-muted)] max-h-64 overflow-auto">
          {loading ? (
            <div className="px-4 py-3 text-sm text-[var(--color-ah-text-subtle)]">Scanning VAST Catalog...</div>
          ) : (
            <table className="w-full text-xs" data-testid="unregistered-files-table">
              <thead>
                <tr className="border-b border-[var(--color-ah-border-muted)] text-[var(--color-ah-text-muted)]">
                  <th className="px-4 py-2 text-left font-medium">Path</th>
                  <th className="px-2 py-2 text-left font-medium w-20">Type</th>
                  <th className="px-2 py-2 text-right font-medium w-24">Size</th>
                  <th className="px-2 py-2 text-right font-medium w-36">Modified</th>
                  <th className="px-4 py-2 text-right font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {files.slice(0, 20).map((file) => (
                  <tr key={file.elementHandle} className="border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]">
                    <td className="px-4 py-2 font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]/70 truncate max-w-sm">{file.path}</td>
                    <td className="px-2 py-2">
                      <Badge variant="info">{file.inferredMediaType}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)]">
                      {file.sizeBytes >= 1e9 ? (file.sizeBytes / 1e9).toFixed(1) + " GB"
                        : file.sizeBytes >= 1e6 ? (file.sizeBytes / 1e6).toFixed(1) + " MB"
                        : (file.sizeBytes / 1e3).toFixed(1) + " KB"}
                    </td>
                    <td className="px-2 py-2 text-right text-[var(--color-ah-text-subtle)]">
                      {file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="primary"
                        onClick={() => void handleRegister(file)}
                        disabled={registering.has(file.elementHandle)}
                      >
                        {registering.has(file.elementHandle) ? "..." : "Register"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {files.length > 20 && (
            <div className="px-4 py-2 text-xs text-[var(--color-ah-text-subtle)]">
              Showing 20 of {files.length} unregistered files
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AssetBrowser() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewAsset, setPreviewAsset] = useState<AssetRow | null>(null);
  const [detailAsset, setDetailAsset] = useState<AssetRow | null>(null);
  const [groupSequences, setGroupSequences] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchText, setSearchText] = useState(searchParams.get("q") ?? "");
  const statusFilter = searchParams.get("status") ?? "";
  const sortBy = searchParams.get("sort") ?? "name";
  const viewMode = (searchParams.get("view") as ViewMode) ?? "gallery";
  const pipelineStage = searchParams.get("stage") ?? "";
  const mediaTypeFilter = searchParams.get("type") ?? "";

  const setSearch = useCallback((value: string) => {
    setSearchText(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("q", value); else next.delete("q");
        return next;
      }, { replace: true });
    }, 200);
  }, [setSearchParams]);

  const setStatusFilter = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("status", value); else next.delete("status");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSortBy = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "name") next.set("sort", value); else next.delete("sort");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setViewMode = useCallback((value: ViewMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value !== "gallery") next.set("view", value); else next.delete("view");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPipelineStage = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("stage", value); else next.delete("stage");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setMediaTypeFilter = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("type", value); else next.delete("type");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    void fetchAssets()
      .then((a) => {
        setAssets(a);
        setApiError(false);
        setLoading(false);
      })
      .catch(() => {
        setAssets([]);
        setApiError(true);
        setLoading(false);
      });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const statusOptions = buildStatusOptions(assets);
  const filtered = assets
    .filter((a) => !searchText || a.title.toLowerCase().includes(searchText.toLowerCase()))
    .filter((a) => !statusFilter || a.status === statusFilter)
    .filter((a) => !pipelineStage || a.productionMetadata?.pipeline_stage === pipelineStage)
    .filter((a) => !mediaTypeFilter || inferMediaType(a.title, a.sourceUri) === mediaTypeFilter)
    .sort((a, b) => {
      if (sortBy === "status") return a.status.localeCompare(b.status);
      return a.title.localeCompare(b.title);
    });

  // Group EXR sequences for gallery mode, or show individual frames
  const entries: AssetEntry[] = groupSequences
    ? groupIntoSequences(filtered)
    : filtered.map((a) => ({ kind: "single" as const, key: a.id, asset: a }));

  const panelOpen = detailAsset !== null;

  const isGallery = viewMode === "gallery";
  const isCompact = viewMode === "compact";
  const estimateSize = isCompact ? COMPACT_ROW_HEIGHT : LIST_ROW_HEIGHT;

  // Virtualizer is only used for list/compact modes (fixed row heights, potentially
  // thousands of rows). Gallery uses plain CSS Grid + IntersectionObserver-based
  // lazy loading, which handles hundreds of items without virtualization overhead.
  const rowVirtualizer = useVirtualizer({
    count: isGallery ? 0 : filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 5,
  });

  const isEmpty = !apiError && assets.length === 0 && !loading;

  return (
    <section aria-label="Asset browser" className="flex gap-0 h-full">
      {/* ── Main content area ── */}
      <div className={`flex-1 min-w-0 ${panelOpen ? "pr-0" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Assets</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate("/library/storage")}>
            Add files
          </Button>
          <Button
            variant={groupSequences ? "primary" : "ghost"}
            onClick={() => setGroupSequences(!groupSequences)}
            aria-pressed={groupSequences}
          >
            {groupSequences ? "Sequences" : "Frames"}
          </Button>
          <div className="flex gap-1" role="toolbar" aria-label="View mode">
            {(["gallery", "list", "compact"] as const).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "primary" : "ghost"}
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <FilterBar
        search={searchText}
        statusFilter={statusFilter}
        sortBy={sortBy}
        pipelineStage={pipelineStage}
        mediaTypeFilter={mediaTypeFilter}
        statusOptions={statusOptions}
        onSearchChange={setSearch}
        onStatusChange={setStatusFilter}
        onSortChange={setSortBy}
        onPipelineStageChange={setPipelineStage}
        onMediaTypeChange={setMediaTypeFilter}
      />

      <AssetSelectionToolbar
        count={selected.size}
        onClear={() => setSelected(new Set())}
      />

      {!loading && !apiError && !isEmpty && <PropagationAlertBanner assets={filtered} />}
      {!loading && !apiError && !isEmpty && <UnregisteredFilesPanel />}

      {/* Error state — API unreachable */}
      {!loading && apiError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">Unable to load assets</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">
            The API could not be reached. Check your connection and try again.
          </p>
          <Button variant="primary" onClick={() => { setLoading(true); setApiError(false); void fetchAssets().then((a) => { setAssets(a); setLoading(false); }).catch(() => { setAssets([]); setApiError(true); setLoading(false); }); }}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state — real empty (API connected, no assets) */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-ah-accent)]/10 flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="var(--color-ah-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4v8M4 8h8" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-1">No assets yet</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] mb-4 max-w-sm">
            Upload files from the Storage Browser to get them processed and registered as assets. Files added to connected VAST storage will appear here automatically.
          </p>
          <Button variant="primary" onClick={() => navigate("/library/storage")}>
            Go to Storage Browser
          </Button>
        </div>
      )}

      {/* No-results state — data exists but all filters combined narrow to zero */}
      {!loading && !apiError && !isEmpty && filtered.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-16 text-center"
          data-testid="asset-browser-no-results"
        >
          <div className="w-14 h-14 rounded-full bg-[var(--color-ah-bg-raised)] flex items-center justify-center mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-ah-text-subtle)]">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-ah-text)] mb-1">No results match the current filters</h3>
          <p className="text-xs text-[var(--color-ah-text-muted)] max-w-md mb-4">
            {assets.length} total asset{assets.length === 1 ? "" : "s"} loaded. Adjust or clear filters to see them.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setSearchText("");
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("q");
                next.delete("status");
                next.delete("stage");
                next.delete("type");
                return next;
              }, { replace: true });
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {loading ? (
        <div
          className="grid gap-3 mt-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
        >
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} height="140px" />)}
        </div>
      ) : (
        <>
          {isGallery && filtered.length > 0 && (
            <SectionHeader
              label="ALL ASSETS"
              count={filtered.length}
            />
          )}

          {/* ── Gallery mode: plain CSS Grid with sequence grouping ── */}
          {isGallery && (
            <div
              className="grid gap-[11px] mt-1"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
              data-testid="gallery-grid"
            >
              {entries.map((entry) =>
                entry.kind === "sequence" ? (
                  <SequenceCard
                    key={entry.key}
                    sequence={entry}
                    onPreview={setPreviewAsset}
                    onDetail={setDetailAsset}
                  />
                ) : (
                  <ThumbnailCard
                    key={entry.key}
                    asset={entry.asset}
                    selected={selected.has(entry.asset.id)}
                    onSelect={toggleSelect}
                    onPreview={setPreviewAsset}
                    onDetail={setDetailAsset}
                  />
                )
              )}
            </div>
          )}

          {/* ── List / Compact modes: virtualizer ── */}
          {!isGallery && (
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{ maxHeight: "calc(100vh - 320px)" }}
            data-testid="virtual-scroll-container"
          >
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
              {isCompact ? (
                <>
                  <div className="flex border-b border-[var(--color-ah-border)] text-xs text-[var(--color-ah-text-muted)]" style={{ height: `${COMPACT_ROW_HEIGHT}px`, alignItems: "center" }}>
                    <span className="w-6 px-1" />
                    <span className="flex-[2] px-1 font-medium">Name</span>
                    <span className="w-20 px-1 font-medium">Status</span>
                    <span className="flex-1 px-1 font-medium">VAST Path</span>
                  </div>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const asset = filtered[virtualRow.index];
                    if (!asset) return null;
                    const mt = inferMediaType(asset.title, asset.sourceUri);
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        className="flex items-center border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer text-xs"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start + COMPACT_ROW_HEIGHT}px)`,
                        }}
                        onClick={() => setDetailAsset(asset)}
                        onDoubleClick={() => setPreviewAsset(asset)}
                      >
                        <span className="w-6 px-1 flex items-center justify-center"><MediaTypeIcon type={mt} size={14} className="text-[var(--color-ah-text-muted)]" /></span>
                        <span className="flex-[2] px-1 truncate">{asset.title}</span>
                        <span className="w-20 px-1"><Badge variant={statusVariant(asset.status)}>{asset.status}</Badge></span>
                        <span className="flex-1 px-1 truncate font-[var(--font-ah-mono)] text-[var(--color-ah-accent)]/60">{extractVastPath(asset.sourceUri)}</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="flex border-b border-[var(--color-ah-border)] text-sm text-[var(--color-ah-text-muted)]" style={{ height: `${LIST_ROW_HEIGHT}px`, alignItems: "center" }}>
                    <span className="flex-[2] px-2 font-medium">Name</span>
                    <span className="w-28 px-2 font-medium">Seq / Shot</span>
                    <span className="w-24 px-2 font-medium">Status</span>
                    <span className="flex-1 px-2 font-medium">Source</span>
                  </div>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const asset = filtered[virtualRow.index];
                    if (!asset) return null;
                    const seqShot = [asset.productionMetadata?.sequence, asset.productionMetadata?.shot].filter(Boolean).join(" / ");
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        className="flex items-center border-b border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer text-sm"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start + LIST_ROW_HEIGHT}px)`,
                        }}
                        onClick={() => setDetailAsset(asset)}
                        onDoubleClick={() => setPreviewAsset(asset)}
                      >
                        <span className="flex-[2] px-2 truncate">{asset.title}</span>
                        <span className="w-28 px-2 font-[var(--font-ah-mono)] text-xs text-[var(--color-ah-text-muted)]">{seqShot || "-"}</span>
                        <span className="w-24 px-2"><Badge variant={statusVariant(asset.status)}>{asset.status}</Badge></span>
                        <span className="flex-1 px-2 truncate font-[var(--font-ah-mono)] text-xs">{asset.sourceUri}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          )}{/* end list/compact virtualizer block */}
        </>
      )}

      {previewAsset && <MediaPreview asset={previewAsset} assets={assets} onClose={() => setPreviewAsset(null)} onNavigate={setPreviewAsset} />}
      </div>{/* end main content */}

      {/* ── Detail panel — slides in as fixed-width column; grid reflows naturally ── */}
      <div
        className="shrink-0 overflow-hidden h-[calc(100vh-2rem)] sticky top-4"
        style={{
          width: detailAsset ? 320 : 0,
          transition: "width 0.28s ease",
        }}
        aria-hidden={!detailAsset}
      >
        <div style={{ width: 320, height: "100%" }}>
          {detailAsset && (
            <AssetDetailPanel
              asset={detailAsset}
              onClose={() => setDetailAsset(null)}
              onAdvanced={(updatedAsset) => {
                setDetailAsset(updatedAsset);
                void fetchAssets().then(setAssets);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
