import type { VfxMetadata } from "./models.js";

/**
 * Parse and validate a loosely-typed metadata record into a strongly-typed VfxMetadata.
 * Unknown fields are silently dropped. Invalid types for known fields are ignored.
 */
export function parseVfxMetadata(raw: Record<string, unknown>): Partial<VfxMetadata> {
  const result: Partial<VfxMetadata> = {};

  if (typeof raw.codec === "string") result.codec = raw.codec;
  if (Array.isArray(raw.channels) && raw.channels.every((c: unknown) => typeof c === "string")) {
    result.channels = raw.channels as string[];
  }
  if (isResolution(raw.resolution)) result.resolution = raw.resolution;
  if (typeof raw.color_space === "string") result.color_space = raw.color_space;
  if (typeof raw.frame_count === "number") result.frame_count = raw.frame_count;
  if (typeof raw.bit_depth === "number") result.bit_depth = raw.bit_depth;
  if (typeof raw.duration_ms === "number") result.duration_ms = raw.duration_ms;
  if (typeof raw.thumbnail_url === "string") result.thumbnail_url = raw.thumbnail_url;
  if (typeof raw.proxy_url === "string") result.proxy_url = raw.proxy_url;
  if (isFrameRange(raw.frame_range)) result.frame_range = raw.frame_range;
  if (typeof raw.frame_rate === "number") result.frame_rate = raw.frame_rate;
  if (typeof raw.pixel_aspect_ratio === "number") result.pixel_aspect_ratio = raw.pixel_aspect_ratio;
  if (isWindow(raw.display_window)) result.display_window = raw.display_window;
  if (isWindow(raw.data_window)) result.data_window = raw.data_window;
  if (typeof raw.compression_type === "string") result.compression_type = raw.compression_type;
  if (typeof raw.file_size_bytes === "number") result.file_size_bytes = raw.file_size_bytes;
  if (typeof raw.md5_checksum === "string") result.md5_checksum = raw.md5_checksum;
  if (typeof raw.frame_head_handle === "number") result.frame_head_handle = raw.frame_head_handle;
  if (typeof raw.frame_tail_handle === "number") result.frame_tail_handle = raw.frame_tail_handle;

  return result;
}

function isResolution(v: unknown): v is { width: number; height: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).width === "number" &&
    typeof (v as Record<string, unknown>).height === "number"
  );
}

function isFrameRange(v: unknown): v is { start: number; end: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).start === "number" &&
    typeof (v as Record<string, unknown>).end === "number"
  );
}

function isWindow(v: unknown): v is { x: number; y: number; width: number; height: number } {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.x === "number" &&
    typeof obj.y === "number" &&
    typeof obj.width === "number" &&
    typeof obj.height === "number"
  );
}
