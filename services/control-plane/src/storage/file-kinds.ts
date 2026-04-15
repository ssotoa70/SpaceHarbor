/**
 * Processing-pipeline file-kind routing — single source of truth.
 *
 * The storage browse endpoints, the sidecar metadata resolver, and any
 * future consumer must classify files the same way, otherwise the "Process"
 * button in the Storage UI, the artifact HEAD checks, and the metadata
 * lookup path will disagree on what file types the DataEngine pipeline
 * actually handles.
 *
 * Contract (kept in sync with the memory store
 * `project_dataengine_function_coverage.md`):
 *
 *   image      → oiio-proxy-generator      (underscore separator: _thumb.jpg, _proxy.jpg, _metadata.json)
 *   video      → video-proxy-generator +
 *                video-metadata-extractor  (hyphen separator:     -proxy.mp4, -sprites.jpg/vtt
 *                                           + underscore sidecar: _metadata.json)
 *   raw_camera → video-metadata-extractor only (metadata-only)
 *   other      → formats the pipeline does not process
 *
 * This module is pure data + a single pure classifier. No side effects,
 * no I/O, no logging — safe to import from anywhere.
 */

export type FileKind = "image" | "video" | "raw_camera" | "other";

export const IMAGE_PIPELINE_EXTS: ReadonlySet<string> = new Set([
  ".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg",
]);

export const VIDEO_PIPELINE_EXTS: ReadonlySet<string> = new Set([
  ".mp4", ".mov", ".mxf", ".avi", ".mkv", ".m4v", ".webm", ".m2ts",
]);

export const RAW_CAMERA_EXTS: ReadonlySet<string> = new Set([
  ".r3d", ".braw",
]);

/**
 * Classify a filename into a pipeline file kind.
 * The classifier looks only at the extension — it does not inspect content.
 */
export function inferFileKind(filename: string): FileKind {
  if (typeof filename !== "string" || filename.length === 0) return "other";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "other";
  const ext = filename.substring(lastDot).toLowerCase();
  if (IMAGE_PIPELINE_EXTS.has(ext)) return "image";
  if (VIDEO_PIPELINE_EXTS.has(ext)) return "video";
  if (RAW_CAMERA_EXTS.has(ext)) return "raw_camera";
  return "other";
}
