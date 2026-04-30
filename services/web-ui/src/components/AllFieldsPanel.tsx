/**
 * AllFieldsPanel — Frame.io-style metadata view used by BOTH the asset
 * side panel (AssetDetailPanel INFO tab) and the full-screen viewer
 * (MediaPreview). Single source of truth for file-kind-aware metadata
 * rendering.
 *
 * Dispatch by file kind / pipeline:
 *   - frame pipeline (EXR / DPX / TIFF / etc.)  → FrameMetadataRenderer
 *     reads dbRows[0] + dbExtras (parts/channels/aovs/...) + sidecar
 *     and surfaces the SEQUENCE / COLOR SCIENCE / CAMERA / PRODUCTION /
 *     TIMECODE / STRUCTURAL / PROVENANCE sections from frame-metadata-groups.
 *   - video pipeline                            → VideoMetadataRenderer
 *     (existing) reads the sidecar payload and renders CONTAINER / VIDEO
 *     / AUDIO / EDITORIAL / CAMERA / PRODUCTION sections from
 *     video-metadata-groups.
 *   - other / unknown                           → simple File summary
 *     (filename + source + size + created), the bare minimum that's
 *     useful for documents, audio without metadata, etc.
 *
 * Empty sections auto-hide via MetaGroup. When NO section has any field,
 * a single "Metadata extraction pending" banner is shown so the panel
 * doesn't feel broken — instead it explains why.
 */

import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { AssetBadges } from "./AssetBadges";
import { FrameMetadataRenderer } from "./metadata/FrameMetadataRenderer";
import { VideoMetadataRenderer } from "./metadata/VideoMetadataRenderer";
import { extractFrameFields } from "./metadata/frame-fields-extractor";
import { MetaGroup } from "./metadata/MetaGroup";
import { MetaRow } from "./metadata/MetaRow";
import { formatFileSize } from "./metadata/formatters";
import type { AssetRow } from "../types";

interface AllFieldsPanelProps {
  asset: AssetRow;
  /** Hide the filename header (caller supplies its own header). */
  hideHeader?: boolean;
}

export function AllFieldsPanel({ asset, hideHeader = false }: AllFieldsPanelProps) {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : undefined;

  // Pipeline routing — matches the unified reader's targetSchema convention.
  const targetSchema = metadata?.pipeline?.targetSchema;
  const fileKind = metadata?.fileKind;
  const isFramePipeline = fileKind === "image" && targetSchema === "frame_metadata";
  const isVideoPipeline = (fileKind === "video" || fileKind === "raw_camera")
    && (targetSchema === "video_metadata" || metadata?.sidecar != null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!hideHeader && (
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-ah-border)]">
          <h3
            className="text-[14px] font-semibold text-[var(--color-ah-text)] truncate"
            title={asset.title}
          >
            {asset.title}
          </h3>
          {asset.createdAt && (
            <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-0.5">
              {new Date(asset.createdAt).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </p>
          )}
          <AssetBadges asset={asset} metadata={metadata} />
        </div>
      )}
      {hideHeader && (
        // Caller (AssetDetailPanel) supplies its own filename header — but
        // the structural / QC badges still need a home so artists see them
        // without scrolling. Render compactly above the tabs' content.
        <div className="px-4 pt-2">
          <AssetBadges asset={asset} metadata={metadata} />
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pt-3 pb-4">
        {result.status === "loading" && (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)] italic" data-testid="loading">
            Loading metadata…
          </p>
        )}
        {result.status === "error" && (
          <p className="text-[11px] text-red-400" data-testid="error">
            Failed to load metadata: {result.error}
          </p>
        )}

        {result.status === "ready" && (
          <>
            {/* Always-on FILE summary so even unknown formats get something useful. */}
            <MetaGroup id="file" title="File" defaultOpen>
              <MetaRow label="Filename" value={asset.title} copyable />
              <MetaRow label="Source" value={asset.sourceUri} copyable />
              <MetaRow label="Size" value={fileSizeFromAny(metadata)} />
              <MetaRow label="Created" value={formatCreated(asset.createdAt)} />
            </MetaGroup>

            {isFramePipeline && (
              <FrameMetadataRenderer metadata={metadata} />
            )}
            {!isFramePipeline && isVideoPipeline && metadata?.sidecar && (
              <VideoMetadataRenderer payload={metadata.sidecar} />
            )}

            {isExtractionPending(metadata, isFramePipeline, isVideoPipeline) && (
              <p
                className="text-[11px] text-[var(--color-ah-text-subtle)] italic mt-3"
                data-testid="extraction-pending"
              >
                Metadata extraction pending — sidecar not generated and
                child tables empty. Re-run the pipeline to populate.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatCreated(createdAt: string | undefined): string | null {
  if (!createdAt) return null;
  return new Date(createdAt).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fileSizeFromAny(metadata: ReturnType<typeof useAssetMetadata>["data"]): string | null {
  if (!metadata) return null;
  const fields = extractFrameFields(metadata);
  if (typeof fields.size_bytes === "number") return formatFileSize(fields.size_bytes);
  // Video: dbRow[0].file_size_bytes
  const row = metadata.dbRows[0] as Record<string, unknown> | undefined;
  if (row && typeof row.file_size_bytes === "number") return formatFileSize(row.file_size_bytes);
  if (row && typeof row.size_bytes === "number") return formatFileSize(row.size_bytes);
  return null;
}

function isExtractionPending(
  metadata: ReturnType<typeof useAssetMetadata>["data"],
  isFrame: boolean,
  isVideo: boolean,
): boolean {
  if (!metadata) return false;
  if (isFrame) {
    // Pending when no parts row was returned AND no sidecar.
    const hasParts = (metadata.dbExtras?.parts?.length ?? 0) > 0;
    return !hasParts && metadata.sidecar == null;
  }
  if (isVideo) {
    return metadata.sidecar == null && metadata.dbRows.length === 0;
  }
  // Unknown kind — never show "pending" since we don't know what to expect.
  return false;
}
