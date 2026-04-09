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

/** Images owned by oiio-proxy-generator / exr-inspector. */
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
