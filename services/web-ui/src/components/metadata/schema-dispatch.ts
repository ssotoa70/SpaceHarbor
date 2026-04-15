/**
 * Metadata envelope detection.
 *
 * The UI accepts any JSON object from the server and must decide which
 * renderer to use. We never trust the envelope — every access is guarded
 * and returns `"unknown"` rather than throwing. The caller can then fall
 * back to a raw-JSON view.
 */

import { createLogger } from "../../utils/logger";
import type { MetadataSchemaId, VideoMetadataFields } from "./schemas";

const log = createLogger("metadata/schema-dispatch");

const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "schema_version",
  "file_id",
  "asset_id",
  "s3_key",
  "s3_bucket",
  "original_filename",
  "metadata_sidecar_s3_key",
  "metadata",
  "generator_version",
]);

/** Known flat-video field names used as a structural fingerprint. */
const VIDEO_FLAT_FINGERPRINT: ReadonlySet<string> = new Set([
  "video_codec",
  "video_codec_profile",
  "container_format",
  "duration_seconds",
  "hdr_format",
  "camera_model",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function detectSchema(payload: unknown): MetadataSchemaId {
  if (!isPlainObject(payload)) {
    return "unknown";
  }

  // Video@1 — header-driven
  const schemaUrl = payload["$schema"];
  if (typeof schemaUrl === "string" && schemaUrl.includes("video-metadata")) {
    return "video@1";
  }
  const version = payload["schema_version"];
  if (typeof version === "string" && /^1(\.|$)/.test(version)) {
    return "video@1";
  }

  // Frame@1 — numeric schema_version AND parts[]
  if (typeof version === "number" && version === 1 && Array.isArray(payload["parts"])) {
    return "frame@1";
  }

  // Video@1 — structural fallback (pre-1.1.0 sidecars with no $schema header)
  const videoFields = extractVideoFields(payload);
  const hasVideoFingerprint = Array.from(VIDEO_FLAT_FINGERPRINT).some((k) => k in videoFields);
  if (hasVideoFingerprint) {
    return "video@1";
  }

  // Image-proxy legacy — SpaceHarbor's current AssetMetadata shape
  if ("codec" in payload || "resolution" in payload || "frame_range" in payload) {
    return "image-proxy@legacy";
  }

  log.debug("unknown metadata envelope", { keys: Object.keys(payload).slice(0, 20) });
  return "unknown";
}

/**
 * Pull the video field bag out of whatever envelope shape arrived.
 * Some sidecars nest fields under `metadata`, others lay them flat.
 * Identity keys are always filtered out of the flat fallback.
 */
export function extractVideoFields(payload: unknown): VideoMetadataFields {
  if (!isPlainObject(payload)) return {};
  const nested = payload["metadata"];
  if (isPlainObject(nested)) {
    return nested as VideoMetadataFields;
  }
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (IDENTITY_KEYS.has(key)) continue;
    flat[key] = value;
  }
  return flat as VideoMetadataFields;
}
