import type { DiscoveredPipeline } from "../api";
import { findPipelineForFilename } from "../hooks/useDataEnginePipelines";

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

export type MetadataKind = "image" | "video" | "raw_camera" | "none";

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

/** Result of a pipeline-aware classification. `kind` reflects the
 *  matched pipeline's `fileKind` (including `raw_camera` when the
 *  filename matches a raw pipeline). `pipeline` is the full
 *  DiscoveredPipeline so callers can read schema/table/functionName
 *  without a second lookup. */
export interface ClassificationResult {
  kind: MetadataKind;
  pipeline: DiscoveredPipeline | null;
}

/**
 * Pipeline-aware file-kind classifier. Preferred over
 * `metadataKindForFilename` when the caller has async access to the
 * discovered pipelines list.
 *
 * - `pipelines: DiscoveredPipeline[]` → match filename's extension against
 *   each pipeline's `extensions` list. Return `{ kind, pipeline }` where
 *   `kind` is the pipeline's `fileKind` (`"image" | "video" | "raw_camera"`).
 *   Returns `{ kind: "none", pipeline: null }` when no pipeline matches.
 *
 * - `pipelines: null` → falls through to the static-set path via
 *   `metadataKindForFilename`. Used by `useStorageSidecar` on mount
 *   before the pipelines fetch resolves.
 *
 * - `pipelines: []` (empty config) → returns `{ kind: "none", pipeline: null }`
 *   for every filename. Callers render "No pipeline configured".
 *
 * Case-insensitive on extension. Returns the first matching pipeline
 * when multiple have overlapping extensions (the server-side validator
 * prevents this at write time).
 */
export function classifyForPipelines(
  filename: string,
  pipelines: DiscoveredPipeline[] | null,
): ClassificationResult {
  if (pipelines === null) {
    // Fall through to static-set path — preserves useStorageSidecar's
    // on-mount eligibility gate behavior.
    return { kind: metadataKindForFilename(filename), pipeline: null };
  }

  const pipeline = findPipelineForFilename(pipelines, filename);
  if (!pipeline) {
    return { kind: "none", pipeline: null };
  }

  return { kind: pipeline.config.fileKind, pipeline };
}
