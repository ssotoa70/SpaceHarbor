/**
 * Type definitions for each metadata sidecar envelope we understand.
 *
 * These mirror the schemas owned by the DataEngine functions in the external
 * `ai-functions/` repo. Field sets are intentionally loose (all optional)
 * because extractors can run partial passes and SpaceHarbor must render
 * whatever is present without crashing.
 *
 * Authoritative sources:
 *   - video@1: ai-functions/video-proxy-generator/docs/VIDEO_METADATA_SCHEMA.md
 *   - frame@1: ai-functions/frame-metadata-extractor/docs/FRAMES_METADATA_SCHEMA.MD
 */

export type MetadataSchemaId = "video@1" | "frame@1" | "image-proxy@legacy" | "unknown";

/** Shape emitted by video-metadata-extractor v1.1.0. Flat tabular. */
export interface VideoMetadataPayload {
  $schema?: string;
  schema_version?: string;

  // Identity
  file_id?: string;
  asset_id?: string;
  s3_key?: string;
  s3_bucket?: string;
  original_filename?: string;
  metadata_sidecar_s3_key?: string;

  // Nested "metadata" bag — some sidecars wrap the flat fields under this key
  metadata?: VideoMetadataFields;

  // Or fields may live at top level
  [key: string]: unknown;
}

export interface VideoMetadataFields {
  // Container
  container_format?: string;
  file_size_bytes?: number;
  mxf_op_pattern?: string;
  mxf_as11_compliant?: boolean;
  mxf_wrap_type?: string;

  // Video stream
  video_codec?: string;
  video_codec_profile?: string;
  width?: number;
  height?: number;
  dar?: string;
  fps_num?: number;
  fps_den?: number;
  fps?: number;
  duration_seconds?: number;
  frame_count?: number;
  bit_rate_bps?: number;
  video_bit_rate_bps?: number;
  pixel_format?: string;
  chroma_subsampling?: string;
  bit_depth?: number;
  scan_type?: string;
  scan_order?: string;

  // Color & HDR
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  hdr_format?: string;
  hdr_max_cll_nits?: number;
  hdr_max_fall_nits?: number;

  // Audio
  audio_codec?: string;
  audio_channels?: number;
  audio_sample_rate_hz?: number;
  audio_bit_depth?: number;
  audio_track_count?: number;

  // Editorial
  timecode_start?: string;
  timecode_is_drop_frame?: boolean;
  reel_name?: string;
  clip_name?: string;
  scene?: string;
  take?: string;
  tape_name?: string;

  // Camera
  camera_make?: string;
  camera_model?: string;
  camera_serial_number?: string;
  lens_model?: string;
  lens_serial_number?: string;
  focal_length_mm?: number;
  aperture?: number;
  shutter_angle_degrees?: number;
  iso?: number;
  white_balance_kelvin?: number;
  white_balance_tint?: number;
  lut_applied?: string;
  gamma_applied?: string;
  color_space_applied?: string;
  fps_sensor?: number;
  ndx?: string;
  gps_latitude?: number;
  gps_longitude?: number;
  gps_altitude?: number;

  // Production
  production_date?: string;
  project_name?: string;
  camera_id?: string;

  // Provenance
  braw_metadata_only?: boolean;
  r3d_has_rmd_sidecar?: boolean;
  extraction_tools?: readonly string[];
  extraction_warnings?: readonly string[];
  mtime?: string;
  extractor_version?: string;
  extraction_timestamp?: string;

  [key: string]: unknown;
}

/** Shape emitted by frame-metadata-extractor. Nested. */
export interface FrameMetadataPayload {
  schema_version?: number;
  file?: Record<string, unknown>;
  parts?: readonly Record<string, unknown>[];
  channels?: readonly Record<string, unknown>[];
  aovs?: readonly Record<string, unknown>[];
  attributes?: { parts?: readonly unknown[] };
  color?: Record<string, unknown>;
  timecode?: Record<string, unknown>;
  sequence?: Record<string, unknown>;
  camera?: Record<string, unknown>;
  production?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Flat field bag derived from a FrameMetadataPayload + the asset-metadata
 * route's dbRow + dbExtras. The `extractFrameFields` helper merges all
 * available sources (parent files row, child tables, sidecar JSON) into
 * this single bag — matching the VideoMetadataFields pattern so the
 * renderer can read by key without descending into nested objects.
 *
 * Fields come from multiple sources:
 *   - dbRow (frame_metadata.files): file_id, file_path, format, size_bytes, mtime,
 *     multipart_count, is_deep, header_hash
 *   - dbExtras.parts[0] (frame_metadata.parts): width, height, display_window,
 *     compression, line_order, render_software, is_tiled, tile_*, view_name, part_name
 *   - dbExtras.channels rollup: channel_count, channel_type, bit_depth_label
 *   - dbExtras.aovs rollup: aov_count, aov_summary
 *   - dbExtras.color / sidecar.color: color_space, transfer_function, primaries
 *   - dbExtras.camera / sidecar.camera: camera_make, camera_model, camera_lens, ...
 *   - dbExtras.production / sidecar.production: production_creator, production_copyright, ...
 *   - dbExtras.timecode / sidecar.timecode: timecode_value, timecode_rate
 */
export interface FrameMetadataFields {
  // FILE / identity
  file_id?: string;
  file_path?: string;
  format?: string;
  size_bytes?: number;
  mtime?: string;
  multipart_count?: number;
  is_deep?: boolean;
  header_hash?: string;
  frame_number?: number;

  // SEQUENCE / parts[0] geometry
  width?: number;
  height?: number;
  display_width?: number;
  display_height?: number;
  data_window?: string;
  display_window?: string;
  pixel_aspect_ratio?: number;
  compression?: string;
  line_order?: string;
  render_software?: string;
  is_tiled?: boolean;
  tile_width?: number;
  tile_height?: number;
  multi_view?: boolean;
  view_name?: string;
  part_name?: string;
  parts_count?: number;

  // Channels / AOVs rollups
  channels_count?: number;
  channel_type?: string;       // most common across channels[]
  bit_depth_label?: string;    // 32f / 16f / 8u / "mixed (32f/16f)"
  aov_count?: number;
  aov_summary?: string;        // "Multi-ch (7 AOVs)" or "RGB · beauty only"

  // COLOR SCIENCE
  color_space?: string;
  transfer_function?: string;
  primaries?: string;

  // CAMERA (per OIIO/sidecar; sparse in CG renders)
  camera_make?: string;
  camera_model?: string;
  camera_lens?: string;
  camera_exposure?: string;
  camera_fnumber?: number;
  camera_iso?: number;

  // TIMECODE
  timecode_value?: string;
  timecode_rate?: number;

  // PRODUCTION
  production_creator?: string;
  production_copyright?: string;
  production_description?: string;
  production_software?: string;

  // EXTRACTION provenance
  extraction_tool?: string;
  extraction_tool_version?: string;
  extraction_timestamp?: string;
  extraction_warnings?: readonly string[];

  [key: string]: unknown;
}
