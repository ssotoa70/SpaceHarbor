/**
 * Build a flat FrameMetadataFields bag from the unified asset-metadata
 * response (DB row + child tables + sidecar). The renderer then reads
 * by key without descending into nested objects, mirroring the video
 * extractor pattern.
 *
 * Source priority for a single field (most to least authoritative):
 *   1. dbRow value (the canonical write from frame-metadata-extractor)
 *   2. dbExtras child-table value (parts[0], color[0], etc.)
 *   3. sidecar nested value (sidecar.camera.make, etc.)
 *
 * dbExtras tables that don't yet exist are absent — extractor handles
 * that gracefully because every field is optional.
 */

import type { AssetMetadataResponse } from "../../api";
import type { FrameMetadataFields } from "./schemas";

type Row = Record<string, unknown>;

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const asBoolean = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/**
 * Map an OIIO channel `type` (HALF / FLOAT / UINT8 / UINT16 / UINT32) to a
 * compact display label matching the AOV-extractor convention used in the
 * mockup (`32f`, `16f`, `8u`, `16u`, `32u`).
 */
export function depthLabelFromChannelType(type: string | undefined): string | null {
  if (!type) return null;
  const t = type.toUpperCase();
  if (t === "HALF") return "16f";
  if (t === "FLOAT") return "32f";
  if (t === "UINT8") return "8u";
  if (t === "UINT16") return "16u";
  if (t === "UINT32") return "32u";
  return type.toLowerCase();
}

/**
 * Reduce channels[] to a single bit_depth_label. For mixed precision
 * (e.g. some HALF + some FLOAT, common in production EXRs), report the
 * dominant type's label and append "mixed".
 */
function rollupBitDepth(channels: readonly Row[] | undefined): string | undefined {
  if (!channels || channels.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const c of channels) {
    const t = asString(c.channel_type) ?? asString(c.type);
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  if (counts.size === 1) {
    const [type] = [...counts.keys()];
    return depthLabelFromChannelType(type) ?? undefined;
  }
  // Mixed precision — most common type wins, with note.
  const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
  const dominant = depthLabelFromChannelType(sorted[0][0]);
  return dominant ? `${dominant} (mixed)` : undefined;
}

/**
 * Build the canonical channels-rollup string. "Multi-ch (N AOVs)" when
 * multi-AOV; "RGB" / "RGBA" / "Y" etc when single AOV; raw count fallback.
 */
function rollupAovSummary(channels: readonly Row[] | undefined, aovs: readonly Row[] | undefined): string | undefined {
  const aovCount = aovs?.length ?? 0;
  const channelCount = channels?.length ?? 0;
  if (aovCount > 1) return `Multi-ch (${aovCount} AOVs)`;
  if (aovCount === 1 && aovs) {
    const aov = aovs[0];
    const components = asString(aov.components);
    const channelGroup = asString(aov.channel_group);
    if (channelGroup) return channelGroup;
    if (components) return components;
  }
  if (channelCount > 0) return `${channelCount} channel${channelCount === 1 ? "" : "s"}`;
  return undefined;
}

export function extractFrameFields(metadata: AssetMetadataResponse | null | undefined): FrameMetadataFields {
  if (!metadata) return {};
  const row: Row = (metadata.dbRows[0] as Row | undefined) ?? {};
  const ext = metadata.dbExtras ?? {};
  const sidecar = (metadata.sidecar as Row | null) ?? null;
  const part0 = (ext.parts?.[0] as Row | undefined) ?? null;
  const channels = ext.channels;
  const aovs = ext.aovs;

  // Sidecar nested objects (when present)
  const sidecarColor = (sidecar?.color as Row | undefined) ?? null;
  const sidecarCamera = (sidecar?.camera as Row | undefined) ?? null;
  const sidecarTimecode = (sidecar?.timecode as Row | undefined) ?? null;
  const sidecarProduction = (sidecar?.production as Row | undefined) ?? null;
  const sidecarExtraction = (sidecar?.extraction as Row | undefined) ?? null;
  const sidecarFile = (sidecar?.file as Row | undefined) ?? null;

  // Child-table single-row promotions (color/camera/timecode/production are
  // typically 1 row per asset; aovs/channels/parts are many).
  const colorRow = (ext.color?.[0] as Row | undefined) ?? null;
  const cameraRow = (ext.camera?.[0] as Row | undefined) ?? null;
  const timecodeRow = (ext.timecode?.[0] as Row | undefined) ?? null;
  const productionRow = (ext.production?.[0] as Row | undefined) ?? null;

  const pickStr = (...candidates: unknown[]): string | undefined => {
    for (const c of candidates) {
      const s = asString(c);
      if (s) return s;
    }
    return undefined;
  };
  const pickNum = (...candidates: unknown[]): number | undefined => {
    for (const c of candidates) {
      const n = asNumber(c);
      if (n !== undefined) return n;
    }
    return undefined;
  };
  const pickBool = (...candidates: unknown[]): boolean | undefined => {
    for (const c of candidates) {
      const b = asBoolean(c);
      if (b !== undefined) return b;
    }
    return undefined;
  };

  return {
    // FILE / identity (parent files row primary; sidecar.file fallback)
    file_id: pickStr(row.file_id, sidecarFile?.file_id),
    file_path: pickStr(row.file_path, sidecarFile?.path, sidecarFile?.s3_key),
    format: pickStr(row.format, sidecarFile?.format),
    size_bytes: pickNum(row.size_bytes, sidecarFile?.size_bytes),
    mtime: pickStr(row.mtime, sidecarFile?.mtime),
    multipart_count: pickNum(row.multipart_count, sidecarFile?.multipart_count),
    is_deep: pickBool(row.is_deep, sidecarFile?.is_deep, part0?.is_deep),
    header_hash: pickStr(row.header_hash),
    frame_number: pickNum(row.frame_number, sidecarFile?.frame_number),

    // SEQUENCE / parts[0]
    width: pickNum(part0?.width),
    height: pickNum(part0?.height),
    display_width: pickNum(part0?.display_width),
    display_height: pickNum(part0?.display_height),
    data_window: pickStr(part0?.data_window),
    display_window: pickStr(part0?.display_window),
    pixel_aspect_ratio: pickNum(part0?.pixel_aspect_ratio),
    compression: pickStr(part0?.compression),
    line_order: pickStr(part0?.line_order),
    render_software: pickStr(part0?.render_software),
    is_tiled: pickBool(part0?.is_tiled),
    tile_width: pickNum(part0?.tile_width),
    tile_height: pickNum(part0?.tile_height),
    multi_view: pickBool(part0?.multi_view),
    view_name: pickStr(part0?.view_name),
    part_name: pickStr(part0?.part_name),
    parts_count: ext.parts?.length,

    // Channels + AOVs rollups
    channels_count: channels?.length,
    bit_depth_label: rollupBitDepth(channels),
    aov_count: aovs?.length,
    aov_summary: rollupAovSummary(channels, aovs),

    // COLOR SCIENCE — prefer dbExtras.color, fall back to sidecar.color, then parts[0]
    color_space: pickStr(colorRow?.color_space, sidecarColor?.color_space, part0?.color_space),
    transfer_function: pickStr(colorRow?.transfer_function, sidecarColor?.transfer_function),
    primaries: pickStr(colorRow?.primaries, sidecarColor?.primaries),

    // CAMERA — sparse on CG renders; fall back to render_software
    camera_make: pickStr(cameraRow?.make, sidecarCamera?.make),
    camera_model: pickStr(cameraRow?.model, sidecarCamera?.model),
    camera_lens: pickStr(cameraRow?.lens, sidecarCamera?.lens),
    camera_exposure: pickStr(cameraRow?.exposure, sidecarCamera?.exposure),
    camera_fnumber: pickNum(cameraRow?.fnumber, sidecarCamera?.fnumber),
    camera_iso: pickNum(cameraRow?.iso, sidecarCamera?.iso),

    // TIMECODE
    timecode_value: pickStr(timecodeRow?.value, sidecarTimecode?.value),
    timecode_rate: pickNum(timecodeRow?.rate, sidecarTimecode?.rate),

    // PRODUCTION
    production_creator: pickStr(productionRow?.creator, sidecarProduction?.creator),
    production_copyright: pickStr(productionRow?.copyright, sidecarProduction?.copyright),
    production_description: pickStr(productionRow?.description, sidecarProduction?.description),
    production_software: pickStr(productionRow?.software, sidecarProduction?.software),

    // EXTRACTION provenance
    extraction_tool: pickStr(sidecarExtraction?.tool),
    extraction_tool_version: pickStr(sidecarExtraction?.tool_version),
    extraction_timestamp: pickStr(sidecarExtraction?.timestamp),
    extraction_warnings: Array.isArray(sidecarExtraction?.warnings)
      ? (sidecarExtraction.warnings as string[])
      : undefined,
  };
}
