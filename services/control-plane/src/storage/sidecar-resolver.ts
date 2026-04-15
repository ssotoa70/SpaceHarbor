/**
 * Sidecar S3-key resolver.
 *
 * Given a source object URI (e.g. `s3://bucket/path/shot.mov`) this module
 * derives the S3 key of the companion `_metadata.json` sidecar written by
 * the metadata-extractor DataEngine functions, without doing any network
 * I/O. Pure functions only — trivially unit-testable.
 *
 * Sidecar naming contract (owned by the external ai-functions repo):
 *
 *   source: `{dir}/{stem}{ext}`
 *   sidecar: `{dir}/.proxies/{stem}_metadata.json`
 *
 * The contract is identical across oiio-proxy-generator (image),
 * video-metadata-extractor (video + raw_camera). `other` file kinds have
 * no sidecar and return `null` so callers can short-circuit with 415/404.
 */

import { inferFileKind, type FileKind } from "./file-kinds.js";

export interface ParsedSourceUri {
  /** Parsed bucket when the URI uses `s3://bucket/key` form; null for bare keys. */
  bucket: string | null;
  /** Object key, always without a leading slash. */
  key: string;
}

export interface SidecarLocation {
  bucket: string | null;
  sourceKey: string;
  sidecarKey: string;
  fileKind: FileKind;
  filename: string;
}

export class InvalidSourceUriError extends Error {
  constructor(message: string, public readonly sourceUri: string) {
    super(message);
    this.name = "InvalidSourceUriError";
  }
}

const S3_URI_PATTERN = /^s3:\/\/([^/]+)\/(.+)$/;

/**
 * Parse a source URI into `{ bucket, key }`. Accepts both canonical
 * `s3://bucket/key` and the bare `/key` or `key` forms used for uploads
 * rooted at the default endpoint bucket.
 */
export function parseSourceUri(sourceUri: string): ParsedSourceUri {
  if (typeof sourceUri !== "string" || sourceUri.length === 0) {
    throw new InvalidSourceUriError("sourceUri must be a non-empty string", String(sourceUri));
  }
  if (sourceUri.startsWith("s3://")) {
    const s3Match = sourceUri.match(S3_URI_PATTERN);
    if (!s3Match) {
      throw new InvalidSourceUriError("sourceUri has malformed s3:// form", sourceUri);
    }
    return { bucket: s3Match[1], key: s3Match[2] };
  }
  // Bare key form — strip leading slashes
  const stripped = sourceUri.replace(/^\/+/, "");
  if (stripped.length === 0) {
    throw new InvalidSourceUriError("sourceUri has empty key", sourceUri);
  }
  return { bucket: null, key: stripped };
}

/**
 * Derive the sidecar key from a source key.
 *
 * Examples:
 *   shot.mov                                  → .proxies/shot_metadata.json
 *   footage/shot_010/shot.mov                 → footage/shot_010/.proxies/shot_metadata.json
 *   a/b.c/shot.r3d                            → a/b.c/.proxies/shot_metadata.json
 */
export function deriveSidecarKey(sourceKey: string): string {
  if (typeof sourceKey !== "string" || sourceKey.length === 0) {
    throw new InvalidSourceUriError("sourceKey must be a non-empty string", String(sourceKey));
  }
  const lastSlash = sourceKey.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : sourceKey.substring(0, lastSlash);
  const filename = lastSlash === -1 ? sourceKey : sourceKey.substring(lastSlash + 1);
  if (filename.length === 0) {
    throw new InvalidSourceUriError("sourceKey has no filename component", sourceKey);
  }
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot === -1 ? filename : filename.substring(0, lastDot);
  if (stem.length === 0) {
    throw new InvalidSourceUriError("sourceKey filename has no stem", sourceKey);
  }
  return dir ? `${dir}/.proxies/${stem}_metadata.json` : `.proxies/${stem}_metadata.json`;
}

/**
 * Full resolution in one call. Returns `null` when the file kind is `other`
 * (no extractor produces a sidecar for it, so the caller should respond 415).
 */
export function resolveSidecarLocation(sourceUri: string): SidecarLocation | null {
  const { bucket, key } = parseSourceUri(sourceUri);
  const lastSlash = key.lastIndexOf("/");
  const filename = lastSlash === -1 ? key : key.substring(lastSlash + 1);
  const fileKind = inferFileKind(filename);
  if (fileKind === "other") return null;
  const sidecarKey = deriveSidecarKey(key);
  return { bucket, sourceKey: key, sidecarKey, fileKind, filename };
}
