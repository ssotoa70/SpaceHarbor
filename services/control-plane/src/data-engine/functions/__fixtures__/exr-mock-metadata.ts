/**
 * Canonical EXR mock metadata -- single source of truth for TypeScript.
 *
 * This MUST stay in sync with services/shared/exr-mock-metadata.json
 * (the cross-language canonical fixture).
 *
 * Design decisions:
 * - channels: flat strings (matches real oiiotool output)
 * - display_window.x_max: 4095 (0-indexed, correct for 4096 width)
 * - checksum key: "checksum" (oiio-proxy normalizes md5_checksum -> checksum)
 * - No thumbnail_url (generated separately, not intrinsic EXR metadata)
 * - No frame_head/tail_handle (editorial metadata, not EXR intrinsic)
 * - frame_count: 240, frame_range.last: 1240 (consistent: 24fps * 10s)
 */

export const EXR_MOCK_METADATA: Record<string, unknown> = {
  codec: "exr",
  channels: ["R", "G", "B", "A"],
  resolution: { width: 4096, height: 2160 },
  color_space: "linear",
  frame_count: 240,
  bit_depth: 32,
  duration_ms: 10000,
  frame_range: { first: 1001, last: 1240 },
  frame_rate: 24.0,
  pixel_aspect_ratio: 1.0,
  display_window: { x_min: 0, y_min: 0, x_max: 4095, y_max: 2159 },
  data_window: { x_min: 0, y_min: 0, x_max: 4095, y_max: 2159 },
  compression_type: "PIZ",
  file_size_bytes: 52428800,
  checksum: "d41d8cd98f00b204e9800998ecf8427e",
};
