/**
 * Group layout for frame-pipeline assets (EXR / DPX / TIFF / etc.).
 *
 * PURE DATA — no React, no rendering. Section order and field ordering is
 * the production-tested taxonomy from the workflow + media-pipeline expert
 * reviews:
 *
 *   1. SEQUENCE — geometry + frame range answers "how is this picture made"
 *   2. COLOR SCIENCE — colorspace / transfer / primaries: the comp-go/no-go
 *      decision a plate must answer first
 *   3. CAMERA — physical capture metadata; SPLIT from Color Science because
 *      a CG render has populated Color Science but empty Camera
 *   4. PRODUCTION — creator / copyright / show metadata
 *   5. PROVENANCE — extractor + warnings (collapsed by default)
 *
 * Empty sections hide automatically (MetaGroup omits when no field returns
 * a non-null value). Adding a new extractor field is a one-line change here.
 */

import {
  formatBoolean,
  formatFileSize,
  formatResolution,
} from "./formatters";
import type { FrameMetadataFields } from "./schemas";

export type FrameFieldKey = keyof FrameMetadataFields;
export type FrameFieldFormatter = (fields: FrameMetadataFields) => string | null;

export interface FrameFieldSpec {
  id: string;
  label: string;
  hint?: string;
  copyable?: boolean;
  /** Either a single field key OR a formatter that consumes the bag. */
  key?: FrameFieldKey;
  format?: FrameFieldFormatter;
}

export interface FrameGroupSpec {
  id: string;
  title: string;
  defaultOpen?: boolean;
  fields: readonly FrameFieldSpec[];
}

/** "Frames 1001-1240 (240 fr)" — for sequences; falls back to single-frame label. */
function formatFrameRange(f: FrameMetadataFields): string | null {
  const fn = f.frame_number;
  if (typeof fn === "number") return `Frame ${fn}`;
  return null;
}

/** "32-bit float" / "16-bit half" / "8-bit unsigned" / null. */
function formatBitDepth(f: FrameMetadataFields): string | null {
  const label = f.bit_depth_label;
  if (!label) return null;
  if (label.startsWith("32f")) return label.includes("mixed") ? "32-bit float (mixed)" : "32-bit float";
  if (label.startsWith("16f")) return label.includes("mixed") ? "16-bit half (mixed)" : "16-bit half";
  if (label.startsWith("8u"))  return "8-bit unsigned";
  if (label.startsWith("16u")) return "16-bit unsigned";
  if (label.startsWith("32u")) return "32-bit unsigned";
  return label;
}

/** "Multi-ch (7 AOVs)" or "RGB · 3 channels" or null. */
function formatChannelsRollup(f: FrameMetadataFields): string | null {
  if (f.aov_summary) return f.aov_summary;
  if (typeof f.channels_count === "number") return `${f.channels_count} channels`;
  return null;
}

/** "ZIP (lossless)" / "PIZ (lossy)" / "Uncompressed" / null. */
function formatCompression(f: FrameMetadataFields): string | null {
  const c = f.compression?.toLowerCase();
  if (!c) return null;
  if (c === "none" || c === "no compression") return "Uncompressed";
  // Lossless EXR codecs: ZIP, ZIPS, PIZ (mathematically lossy but visually lossless), RLE.
  // Lossy: DWAA, DWAB, B44, B44A, PXR24.
  const lossy = new Set(["dwaa", "dwab", "b44", "b44a", "pxr24"]);
  const tag = lossy.has(c) ? "lossy" : "lossless";
  return `${c.toUpperCase()} (${tag})`;
}

/** "Anamorphic 2:1" / null when 1.0 (square pixels). */
function formatPixelAspect(f: FrameMetadataFields): string | null {
  const par = f.pixel_aspect_ratio;
  if (par == null) return null;
  if (Math.abs(par - 1.0) < 1e-6) return null; // hide when square
  return `Anamorphic ${par}:1`;
}

/** "ARRI ALEXA 35" or render software fallback for CG renders. */
function formatCameraName(f: FrameMetadataFields): string | null {
  if (f.camera_make && f.camera_model) return `${f.camera_make} ${f.camera_model}`;
  if (f.camera_model) return f.camera_model;
  if (f.camera_make) return f.camera_make;
  // CG fallback: surface the renderer ("OpenImageIO 3.1.11.0") so the
  // section isn't empty for synthetic renders. Trim to "OpenImageIO 3.1.11.0".
  if (f.render_software) return f.render_software.split(" : ")[0] ?? f.render_software;
  return null;
}

/** "T2.8" / "f/2.8" — prefer T-stop semantics. */
function formatTStop(f: FrameMetadataFields): string | null {
  if (typeof f.camera_fnumber === "number") return `T${f.camera_fnumber}`;
  if (f.camera_exposure) return f.camera_exposure;
  return null;
}

export const FRAME_METADATA_GROUPS: readonly FrameGroupSpec[] = [
  {
    id: "sequence",
    title: "Sequence",
    defaultOpen: true,
    fields: [
      { id: "frame", label: "Frame", format: formatFrameRange },
      { id: "resolution", label: "Resolution", format: (f) => formatResolution(f.width, f.height) },
      { id: "display_window", label: "Display Window", key: "display_window" },
      { id: "pixel_aspect", label: "Pixel Aspect", format: formatPixelAspect },
      { id: "bit_depth", label: "Bit Depth", format: formatBitDepth },
      { id: "channels", label: "Channels", format: formatChannelsRollup },
      { id: "compression", label: "Compression", format: formatCompression },
      { id: "format", label: "Format", key: "format" },
      { id: "size", label: "File Size", format: (f) => formatFileSize(f.size_bytes) },
    ],
  },
  {
    id: "color",
    title: "Color Science",
    defaultOpen: true,
    fields: [
      { id: "color_space", label: "Colorspace", key: "color_space" },
      { id: "transfer", label: "Transfer", key: "transfer_function" },
      { id: "primaries", label: "Primaries", key: "primaries" },
    ],
  },
  {
    id: "camera",
    title: "Camera",
    fields: [
      { id: "camera_name", label: "Camera", format: formatCameraName },
      { id: "camera_lens", label: "Lens", key: "camera_lens" },
      { id: "t_stop", label: "T-Stop", format: formatTStop },
      { id: "iso", label: "ISO", format: (f) => (typeof f.camera_iso === "number" ? String(f.camera_iso) : null) },
    ],
  },
  {
    id: "production",
    title: "Production",
    fields: [
      { id: "creator", label: "Creator", key: "production_creator" },
      { id: "copyright", label: "Copyright", key: "production_copyright" },
      { id: "description", label: "Description", key: "production_description" },
      { id: "software", label: "Software", key: "production_software", copyable: true },
    ],
  },
  {
    id: "timecode",
    title: "Timecode",
    fields: [
      { id: "tc_value", label: "Timecode", key: "timecode_value" },
      { id: "tc_rate", label: "Rate", format: (f) => (typeof f.timecode_rate === "number" ? `${f.timecode_rate} fps` : null) },
    ],
  },
  {
    id: "structural",
    title: "Structural",
    fields: [
      { id: "parts_count", label: "Parts", format: (f) => (typeof f.parts_count === "number" && f.parts_count > 1 ? String(f.parts_count) : null) },
      { id: "is_deep", label: "Deep", format: (f) => (f.is_deep ? "Yes" : null) },
      { id: "is_tiled", label: "Tiled", format: (f) => (f.is_tiled ? `${f.tile_width ?? "?"}×${f.tile_height ?? "?"}` : null) },
      { id: "multi_view", label: "Multi-View", format: (f) => formatBoolean(f.multi_view) },
      { id: "view_name", label: "View", key: "view_name" },
      { id: "part_name", label: "Part Name", key: "part_name" },
      { id: "line_order", label: "Line Order", key: "line_order" },
    ],
  },
  {
    id: "provenance",
    title: "Provenance",
    defaultOpen: false,
    fields: [
      { id: "tool", label: "Extractor", key: "extraction_tool" },
      { id: "tool_version", label: "Version", key: "extraction_tool_version" },
      { id: "render_software", label: "Render Software", key: "render_software", copyable: true },
      { id: "header_hash", label: "Header Hash", key: "header_hash", copyable: true },
      { id: "file_id", label: "File ID", key: "file_id", copyable: true },
      { id: "mtime", label: "Modified", key: "mtime" },
    ],
  },
];

export function collectFrameKnownKeys(groups: readonly FrameGroupSpec[]): Set<string> {
  const keys = new Set<string>();
  for (const g of groups) {
    for (const f of g.fields) {
      if (f.key) keys.add(String(f.key));
    }
  }
  return keys;
}
