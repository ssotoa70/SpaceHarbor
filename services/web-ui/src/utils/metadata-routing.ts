/**
 * Metadata lookup routing — synchronous extension → file-kind classifier.
 *
 * This module used to also hardcode DataEngine function names, descriptions,
 * and VastDB schema/table names (frame-metadata-extractor / frame_metadata
 * / etc.). That knowledge now lives in the admin-controlled
 * PlatformSettings.dataEnginePipelines field and is fetched live by
 * `src/hooks/useDataEnginePipelines.ts` — the web-ui has ZERO hardcoded
 * function/schema/table literals.
 *
 * What remains here is a synchronous file-kind classifier used by
 * `useStorageSidecar` to decide whether to issue a /storage/metadata
 * fetch on mount. A hook inside a hook is awkward, so this classifier
 * keeps its own small extension set as a fast-path fallback until
 * `useStorageSidecar` is refactored to read from the discovered pipeline
 * list (see follow-up task: "migrate useStorageSidecar to pipelines").
 *
 * When you need "which function processes this file?" or any routing
 * metadata beyond the raw file kind, use `useDataEnginePipelines()` +
 * `findPipelineForFilename()` from `src/hooks/useDataEnginePipelines.ts`
 * instead. That path reads live Settings + VAST data and reflects admin
 * changes automatically.
 */

/** Images owned by the image pipeline (oiio + frame-metadata-extractor today). */
export const METADATA_IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg",
]);

/** Videos + raw camera files owned by the video pipeline. Both share the
 *  video-metadata-extractor today; raw cameras are metadata-only. */
export const METADATA_VIDEO_EXTS: ReadonlySet<string> = new Set([
  ".mp4", ".mov", ".mxf", ".avi", ".mkv", ".m4v", ".webm", ".m2ts",
  ".r3d", ".braw",
]);

export type MetadataKind = "image" | "video" | "none";

/** Classify a filename into the metadata lookup path. Returns "none" for
 *  formats the DataEngine pipeline does not process.
 *
 *  @deprecated-ish  Prefer `findPipelineForFilename()` from
 *  `src/hooks/useDataEnginePipelines.ts` when you have async access to
 *  the discovered pipelines list. This sync classifier stays for
 *  `useStorageSidecar`'s on-mount eligibility gate where awaiting a
 *  pipelines fetch would delay every sidecar read. */
export function metadataKindForFilename(filename: string): MetadataKind {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "none";
  const ext = filename.substring(lastDot).toLowerCase();
  if (METADATA_IMAGE_EXTS.has(ext)) return "image";
  if (METADATA_VIDEO_EXTS.has(ext)) return "video";
  return "none";
}
