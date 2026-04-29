/**
 * Field-builder utilities for the asset detail UX.
 *
 * The asset side panel (AssetDetailPanel INFO tab) and the full-screen
 * viewer (MediaPreview) both render the same Frame.io-style "All Fields"
 * view, grouped by FILE / MEDIA / ATTRIBUTES. The MEDIA group is curated
 * per fileKind so EXRs surface image-relevant fields and videos surface
 * video-relevant fields. ATTRIBUTES is the full flat dump of every
 * renderable field merged from sidecar + DB row, minus a small skip-list
 * for vector blobs and schema housekeeping.
 *
 * Design intent (from feedback_ui_dynamic_fields):
 *   "Show ALL available fields, like Frame.io's All Fields (33) expandable
 *    list. The vastdb-query service already returns all the data — the UI
 *    just needs to display it."
 */

import type { AssetMetadataResponse } from "../api";
import type { AssetRow } from "../types";
import { formatFileSize, formatDuration } from "./media-types";

export interface AssetField {
  group: "FILE" | "MEDIA" | "ATTRIBUTES";
  label: string;
  value: string;
}

// snake_case / camelCase → "Title Case"
export function humanizeMetaLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Coerce any JSON value to a single display string. Robust to whatever
// shape an extractor decides to emit.
export function formatMetaFieldValue(value: unknown): string {
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

// Keys that should never render as a flat field — vector blobs, schema
// housekeeping, or values that are meaningless to a human.
const SKIP_KEYS = new Set([
  "$schema",
  "schema_version",
  "generator_version",
]);
const SKIP_KEY_PATTERNS: RegExp[] = [
  /_embedding$/i,
  /^embedding$/i,
];

export function shouldSkipField(key: string, value: unknown): boolean {
  if (SKIP_KEYS.has(key)) return true;
  if (SKIP_KEY_PATTERNS.some((re) => re.test(key))) return true;
  if (Array.isArray(value)) {
    // Numeric arrays of substantial size are vectors, not lists.
    if (value.length > 32 && value.every((v) => typeof v === "number")) return true;
    // Arrays of objects (channels, parts, attributes) render ugly when
    // JSON-stringified inline. Dedicated tabs (AOVS, STREAMS) handle them.
    if (value.some((v) => v != null && typeof v === "object")) return true;
  }
  return false;
}

// Flatten one level of nested objects so e.g. sidecar.metadata's fields
// end up as siblings of sidecar's other top-level fields. The video
// sidecar shape `{ asset_id, s3_key, metadata: { ...50+ fields... } }`
// renders as one flat group rather than a nested object.
function flattenOneLevel(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!obj) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
        out[nk] = nv;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface MediaSpec {
  label: string;
  // Source keys to try in order; first non-empty wins.
  keys: string[];
  // Optional formatter; receives raw value, returns display string or null.
  format?: (value: unknown) => string | null;
}

const fmtNumber = (v: unknown): string | null => {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v !== "") return v;
  return null;
};
const fmtDurationSeconds = (v: unknown): string | null => {
  if (typeof v === "number" && v > 0) return formatDuration(v);
  return fmtNumber(v);
};

// Curated MEDIA summary per fileKind. The same field will also appear in
// ATTRIBUTES with its raw key (e.g. video shows `Resolution: 640x360` in
// MEDIA AND `Width: 640` / `Height: 360` in ATTRIBUTES) — that mirrors
// the Frame.io reference UX.
const MEDIA_SPECS_BY_KIND: Record<string, MediaSpec[]> = {
  image: [
    { label: "Resolution",  keys: ["resolution", "__resolution_from_wh"] },
    { label: "Compression", keys: ["compression", "compression_type"] },
    { label: "Color Space", keys: ["color_space", "colorSpace"] },
    { label: "Channels",    keys: ["channel_count", "channels", "channelCount"], format: fmtNumber },
    { label: "Frame",       keys: ["frame_number", "frameNumber"], format: fmtNumber },
    { label: "Format",      keys: ["format"] },
  ],
  video: [
    { label: "Resolution",     keys: ["resolution", "__resolution_from_wh"] },
    { label: "Codec",          keys: ["video_codec", "codec"] },
    { label: "Duration",       keys: ["duration_seconds", "duration"], format: fmtDurationSeconds },
    { label: "FPS",            keys: ["fps"], format: fmtNumber },
    { label: "Color Space",    keys: ["color_space"] },
    { label: "Audio Channels", keys: ["audio_channels"], format: fmtNumber },
    { label: "Container",      keys: ["container_format"] },
  ],
  raw_camera: [
    { label: "Camera Make",  keys: ["camera_make"] },
    { label: "Camera Model", keys: ["camera_model"] },
    { label: "Lens",         keys: ["lens_model"] },
    { label: "ISO",          keys: ["iso"] },
    { label: "Shutter",      keys: ["shutter_angle_degrees"] },
    { label: "FPS",          keys: ["fps", "fps_sensor"], format: fmtNumber },
  ],
};

function pick(combined: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = combined[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function computeResolution(combined: Record<string, unknown>): string | null {
  const w = combined.width;
  const h = combined.height;
  if (typeof w === "number" && typeof h === "number") return `${w}x${h}`;
  return null;
}

/**
 * Build the flat field list rendered by the asset panel and full-screen
 * viewer. Merge order (most authoritative wins): asset.metadata (legacy
 * AssetRow.metadata) → sidecar (flattened one level) → dbRow.
 */
export function buildAssetFields(
  asset: AssetRow,
  metadata: AssetMetadataResponse | null | undefined,
): AssetField[] {
  const fields: AssetField[] = [];

  const sidecar = metadata?.sidecar ?? null;
  const dbRow = (metadata?.dbRows?.[0] as Record<string, unknown> | undefined) ?? {};
  const sidecarFlat = flattenOneLevel(sidecar);
  const legacy = (asset.metadata as Record<string, unknown> | null | undefined) ?? {};

  const combined: Record<string, unknown> = {
    ...legacy,
    ...sidecarFlat,
    ...dbRow,
  };

  // Synthetic resolution if width+height present — consumed by MEDIA only.
  const resFromWH = computeResolution(combined);
  if (resFromWH != null) combined.__resolution_from_wh = resFromWH;

  // ── FILE group ────────────────────────────────────────────────────────
  fields.push({ group: "FILE", label: "Filename", value: asset.title });
  fields.push({ group: "FILE", label: "Source", value: asset.sourceUri });
  const sizeBytes = combined.file_size_bytes ?? combined.size_bytes;
  if (typeof sizeBytes === "number") {
    fields.push({ group: "FILE", label: "Size", value: formatFileSize(sizeBytes) });
  }
  if (asset.createdAt) {
    fields.push({
      group: "FILE",
      label: "Created",
      value: new Date(asset.createdAt).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      }),
    });
  }

  // ── MEDIA group (file-kind-specific) ──────────────────────────────────
  const kind = metadata?.fileKind ?? "";
  const mediaSpecs = MEDIA_SPECS_BY_KIND[kind] ?? [];
  for (const spec of mediaSpecs) {
    const raw = pick(combined, spec.keys);
    if (raw == null) continue;
    const formatted = spec.format ? spec.format(raw) : formatMetaFieldValue(raw);
    if (formatted) fields.push({ group: "MEDIA", label: spec.label, value: formatted });
  }

  // ── ATTRIBUTES group (everything else, flat, humanized) ───────────────
  for (const [k, v] of Object.entries(combined)) {
    if (k === "__resolution_from_wh") continue;
    if (shouldSkipField(k, v)) continue;
    if (v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) continue; // unflattened nested obj
    fields.push({
      group: "ATTRIBUTES",
      label: humanizeMetaLabel(k),
      value: formatMetaFieldValue(v),
    });
  }

  return fields;
}

/**
 * Group fields by section while preserving insertion order. Returns a
 * Map keyed by group name with arrays of fields in original order.
 */
export function groupFields(fields: AssetField[]): Map<string, AssetField[]> {
  const groups = new Map<string, AssetField[]>();
  for (const f of fields) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group)!.push(f);
  }
  return groups;
}
