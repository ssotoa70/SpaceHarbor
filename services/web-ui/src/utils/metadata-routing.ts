/**
 * Metadata lookup routing — which metadata endpoint handles which file.
 *
 * Keeps the extension → kind mapping in ONE place so the Storage Browser
 * sidebar, the Asset Browser MediaPreview, and any future metadata consumer
 * all agree on which file kinds are served by which DataEngine function.
 *
 * Stay in sync with:
 *   services/control-plane/src/routes/storage-browse.ts       (inferFileKind)
 *   services/control-plane/src/routes/video-metadata.ts       (proxy target)
 *   services/vastdb-query/main.py                             (schema routing)
 *
 * Authoritative contract:
 *   project_dataengine_function_coverage.md in the memory store.
 *
 * Never inline a bare extension check anywhere in the UI — use the helper
 * here so an added format in the future lands everywhere at once.
 */

/** Images owned by the oiio-proxy-generator + frame-metadata-extractor pipeline. */
export const METADATA_IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg",
]);

/** Videos + raw camera files owned by video-proxy-generator +
 *  video-metadata-extractor. Raw camera formats get metadata-only treatment
 *  but still use the same metadata lookup endpoint. */
export const METADATA_VIDEO_EXTS: ReadonlySet<string> = new Set([
  ".mp4", ".mov", ".mxf", ".avi", ".mkv", ".m4v", ".webm", ".m2ts",
  ".r3d", ".braw",
]);

export type MetadataKind = "image" | "video" | "none";

/** Classify a filename into the metadata lookup path. Returns "none" for
 *  formats the DataEngine pipeline does not process. */
export function metadataKindForFilename(filename: string): MetadataKind {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "none";
  const ext = filename.substring(lastDot).toLowerCase();
  if (METADATA_IMAGE_EXTS.has(ext)) return "image";
  if (METADATA_VIDEO_EXTS.has(ext)) return "video";
  return "none";
}

// ---------------------------------------------------------------------------
// DataEngine function coverage per file kind
//
// Authoritative mapping of "which DataEngine functions process this file
// kind" — used by UIs that need to show a status panel, a job list, or a
// "what will happen when I upload this" hint. Maps to the external
// ai-functions/ repo.
//
// Contract (kept in sync with the memory store
// `project_dataengine_function_coverage.md` and with
// `services/control-plane/src/storage/file-kinds.ts`):
//
//   image  → oiio-proxy-generator   (thumbnails + JPG/MP4 proxies)
//          + frame-metadata-extractor (rich per-frame metadata, frame_metadata table)
//   video  → video-proxy-generator  (H.264 proxy + sprite sheet)
//          + video-metadata-extractor (ffprobe/MediaInfo/ExifTool, video_metadata table)
//   raw    → video-metadata-extractor only — vendor SDKs (RED/BRAW) not available
//            in the serverless container, so no proxy is produced.
// ---------------------------------------------------------------------------

export interface DataEngineFunctionSpec {
  /** Function name as registered in VAST DataEngine. */
  readonly name: string;
  /** One-line description shown to the user next to the function name. */
  readonly description: string;
  /** VastDB schema the function writes into, or null if it writes S3 artifacts only. */
  readonly tableSchema: string | null;
}

const OIIO_PROXY_GENERATOR: DataEngineFunctionSpec = {
  name: "oiio-proxy-generator",
  description: "JPEG thumbnails + still-image proxies",
  tableSchema: null,
};

const FRAME_METADATA_EXTRACTOR: DataEngineFunctionSpec = {
  name: "frame-metadata-extractor",
  description: "Rich per-frame metadata (channels, parts, color, EXIF)",
  tableSchema: "frame_metadata",
};

const VIDEO_PROXY_GENERATOR: DataEngineFunctionSpec = {
  name: "video-proxy-generator",
  description: "H.264 review proxy + sprite sheet (VTT thumbnail track)",
  tableSchema: null,
};

const VIDEO_METADATA_EXTRACTOR: DataEngineFunctionSpec = {
  name: "video-metadata-extractor",
  description: "Container / stream / color / camera metadata",
  tableSchema: "video_metadata",
};

/**
 * File kind → ordered list of DataEngine functions that process this kind.
 * Empty list means "not processed by any function" (MetadataKind === "none").
 */
export const DATAENGINE_FUNCTIONS_BY_KIND: Readonly<Record<MetadataKind, readonly DataEngineFunctionSpec[]>> = {
  image: [OIIO_PROXY_GENERATOR, FRAME_METADATA_EXTRACTOR],
  video: [VIDEO_PROXY_GENERATOR, VIDEO_METADATA_EXTRACTOR],
  none: [],
};

/** Convenience helper — classify filename and return its function list. */
export function dataEngineFunctionsForFilename(filename: string): readonly DataEngineFunctionSpec[] {
  return DATAENGINE_FUNCTIONS_BY_KIND[metadataKindForFilename(filename)];
}
