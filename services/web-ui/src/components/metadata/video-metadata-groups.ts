/**
 * Group layout for video@1 sidecars.
 *
 * This file is PURE DATA — no React, no rendering, no side effects. It
 * expresses the Frame.io-style section layout for the dynamic metadata
 * renderer. Adding a new extractor field is a one-line change here.
 *
 * Field keys must exist on `VideoMetadataFields`; TypeScript enforces that
 * at build time via the `keyof VideoMetadataFields` constraint.
 *
 * Formatters live in `./formatters` and produce `string | null`. A `null`
 * return hides the row. Passing raw values (no formatter) is allowed for
 * simple strings — the renderer stringifies and hides empty values.
 */

import {
  formatAperture,
  formatBitRate,
  formatBoolean,
  formatCoordinate,
  formatDuration,
  formatFileSize,
  formatFps,
  formatIso,
  formatResolution,
  formatShutterAngle,
  formatTimecode,
} from "./formatters";
import type { VideoMetadataFields } from "./schemas";

export type VideoFieldKey = keyof VideoMetadataFields;

export type FieldFormatter = (fields: VideoMetadataFields) => string | null;

export interface VideoFieldSpec {
  /** Stable id — used as key in lists, and the derived `data-field` attr. */
  id: string;
  /** Human label rendered by MetaRow. */
  label: string;
  /** Optional hint shown as a muted suffix (units, etc.). */
  hint?: string;
  /** Whether the value should offer a clipboard-copy button. */
  copyable?: boolean;
  /**
   * Either a single field key to read directly, or a formatter that consumes
   * the whole `VideoMetadataFields` bag and returns a formatted string.
   * Exactly one of `key` / `format` must be provided.
   */
  key?: VideoFieldKey;
  format?: FieldFormatter;
}

export interface VideoGroupSpec {
  id: string;
  title: string;
  defaultOpen?: boolean;
  fields: readonly VideoFieldSpec[];
}

export const VIDEO_METADATA_GROUPS: readonly VideoGroupSpec[] = [
  {
    id: "container",
    title: "Container",
    fields: [
      { id: "container_format", label: "Container", key: "container_format" },
      { id: "file_size", label: "File Size", format: (f) => formatFileSize(f.file_size_bytes) },
      { id: "mxf_op_pattern", label: "MXF OP", key: "mxf_op_pattern" },
      { id: "mxf_wrap_type", label: "MXF Wrap", key: "mxf_wrap_type" },
      { id: "mxf_as11", label: "AS-11 Compliant", format: (f) => formatBoolean(f.mxf_as11_compliant) },
    ],
  },
  {
    id: "video",
    title: "Video",
    fields: [
      { id: "video_codec_profile", label: "Codec", format: (f) => (f.video_codec_profile ?? f.video_codec) ?? null },
      { id: "resolution", label: "Resolution", format: (f) => formatResolution(f.width, f.height) },
      { id: "dar", label: "Display Aspect", key: "dar" },
      { id: "fps", label: "Frame Rate", format: (f) => formatFps(f) },
      { id: "duration", label: "Duration", format: (f) => formatDuration(f.duration_seconds) },
      { id: "frame_count", label: "Frames", format: (f) => (f.frame_count != null ? String(f.frame_count) : null) },
      { id: "bit_rate", label: "Bit Rate", format: (f) => formatBitRate(f.bit_rate_bps) },
      { id: "video_bit_rate", label: "Video Bit Rate", format: (f) => formatBitRate(f.video_bit_rate_bps) },
      { id: "pixel_format", label: "Pixel Format", key: "pixel_format" },
      { id: "chroma", label: "Chroma", key: "chroma_subsampling" },
      { id: "bit_depth", label: "Bit Depth", format: (f) => (f.bit_depth ? `${f.bit_depth}-bit` : null) },
      { id: "scan_type", label: "Scan", key: "scan_type" },
      { id: "scan_order", label: "Scan Order", key: "scan_order" },
    ],
  },
  {
    id: "color_hdr",
    title: "Color & HDR",
    fields: [
      { id: "color_space", label: "Color Space", key: "color_space" },
      { id: "color_transfer", label: "Transfer", key: "color_transfer" },
      { id: "color_primaries", label: "Primaries", key: "color_primaries" },
      { id: "hdr_format", label: "HDR Format", key: "hdr_format" },
      { id: "hdr_max_cll", label: "Max CLL", format: (f) => (f.hdr_max_cll_nits != null ? `${f.hdr_max_cll_nits} nits` : null) },
      { id: "hdr_max_fall", label: "Max FALL", format: (f) => (f.hdr_max_fall_nits != null ? `${f.hdr_max_fall_nits} nits` : null) },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    fields: [
      { id: "audio_codec", label: "Codec", key: "audio_codec" },
      { id: "audio_channels", label: "Channels", format: (f) => (f.audio_channels != null ? String(f.audio_channels) : null) },
      { id: "audio_sample_rate", label: "Sample Rate", format: (f) => (f.audio_sample_rate_hz != null ? `${f.audio_sample_rate_hz} Hz` : null) },
      { id: "audio_bit_depth", label: "Bit Depth", format: (f) => (f.audio_bit_depth != null ? `${f.audio_bit_depth}-bit` : null) },
      { id: "audio_tracks", label: "Track Count", format: (f) => (f.audio_track_count != null ? String(f.audio_track_count) : null) },
    ],
  },
  {
    id: "editorial",
    title: "Editorial",
    fields: [
      { id: "timecode_start", label: "Start TC", format: (f) => formatTimecode(f.timecode_start) },
      { id: "drop_frame", label: "Drop Frame", format: (f) => formatBoolean(f.timecode_is_drop_frame) },
      { id: "reel_name", label: "Reel", key: "reel_name" },
      { id: "clip_name", label: "Clip", key: "clip_name", copyable: true },
      { id: "scene", label: "Scene", key: "scene" },
      { id: "take", label: "Take", key: "take" },
      { id: "tape_name", label: "Tape", key: "tape_name" },
    ],
  },
  {
    id: "camera",
    title: "Camera",
    fields: [
      { id: "camera_make", label: "Make", key: "camera_make" },
      { id: "camera_model", label: "Model", key: "camera_model" },
      { id: "camera_serial", label: "Body S/N", key: "camera_serial_number", copyable: true },
      { id: "lens_model", label: "Lens", key: "lens_model" },
      { id: "lens_serial", label: "Lens S/N", key: "lens_serial_number", copyable: true },
      { id: "focal_length", label: "Focal Length", format: (f) => (f.focal_length_mm != null ? `${f.focal_length_mm} mm` : null) },
      { id: "aperture", label: "Aperture", format: (f) => formatAperture(f.aperture) },
      { id: "shutter", label: "Shutter", format: (f) => formatShutterAngle(f.shutter_angle_degrees) },
      { id: "iso", label: "ISO", format: (f) => formatIso(f.iso) },
      { id: "white_balance", label: "WB (Kelvin)", format: (f) => (f.white_balance_kelvin != null ? `${f.white_balance_kelvin} K` : null) },
      { id: "wb_tint", label: "WB Tint", format: (f) => (f.white_balance_tint != null ? String(f.white_balance_tint) : null) },
      { id: "lut_applied", label: "LUT", key: "lut_applied" },
      { id: "gamma", label: "Gamma", key: "gamma_applied" },
      { id: "color_space_applied", label: "Camera Color Space", key: "color_space_applied" },
      { id: "fps_sensor", label: "Sensor FPS", format: (f) => (f.fps_sensor != null ? `${f.fps_sensor} fps` : null) },
      { id: "nd", label: "ND Filter", key: "ndx" },
      { id: "gps_lat", label: "Latitude", format: (f) => formatCoordinate(f.gps_latitude, "lat") },
      { id: "gps_lon", label: "Longitude", format: (f) => formatCoordinate(f.gps_longitude, "lon") },
      { id: "gps_alt", label: "Altitude", format: (f) => (f.gps_altitude != null ? `${f.gps_altitude} m` : null) },
    ],
  },
  {
    id: "production",
    title: "Production",
    fields: [
      { id: "production_date", label: "Date", key: "production_date" },
      { id: "project_name", label: "Project", key: "project_name" },
      { id: "camera_id", label: "Camera ID", key: "camera_id" },
    ],
  },
  {
    id: "provenance",
    title: "Provenance",
    defaultOpen: false,
    fields: [
      { id: "braw_metadata_only", label: "BRAW Metadata Only", format: (f) => formatBoolean(f.braw_metadata_only) },
      { id: "r3d_rmd", label: "R3D RMD Sidecar", format: (f) => formatBoolean(f.r3d_has_rmd_sidecar) },
      { id: "extraction_tools", label: "Tools", format: (f) => (Array.isArray(f.extraction_tools) && f.extraction_tools.length > 0 ? f.extraction_tools.join(", ") : null) },
      { id: "extraction_warnings", label: "Warnings", format: (f) => (Array.isArray(f.extraction_warnings) && f.extraction_warnings.length > 0 ? f.extraction_warnings.join("; ") : null) },
      { id: "mtime", label: "Source mtime", key: "mtime" },
      { id: "extractor_version", label: "Extractor", key: "extractor_version" },
      { id: "extraction_timestamp", label: "Extracted At", key: "extraction_timestamp" },
    ],
  },
];

/**
 * Every `VideoFieldKey` referenced anywhere in `VIDEO_METADATA_GROUPS`.
 * Used by the renderer to discover "unknown" top-level fields and route
 * them into the "Other" catch-all group.
 */
export function collectKnownKeys(groups: readonly VideoGroupSpec[] = VIDEO_METADATA_GROUPS): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const field of group.fields) {
      if (field.key !== undefined) keys.add(String(field.key));
    }
  }
  return keys;
}
