/**
 * S3 render-path parser — TypeScript port of the legacy Python
 * scanner-function `path_parser.py`.
 *
 * Pattern accepted (with optional episode segment for episodic shows):
 *   projects/{PROJECT}/{SEQUENCE}/{SHOT}/render/{VERSION}/{filename}
 *   projects/{PROJECT}/{EPISODE}/{SEQUENCE}/{SHOT}/render/{VERSION}/{filename}
 *
 * Sentinel handling: keys ending in `.ready` are treated as a marker that
 * the renderer finished writing every frame in the directory. The parser
 * returns `is_sentinel: true` and `filename` is set to the render directory
 * (without trailing slash) so the caller ingests the whole sequence as a
 * single asset rather than every individual EXR.
 *
 * Pure module — no I/O, no globals. Behavior must match
 * services/scanner-function/path_parser.py until that file is removed.
 */

export const SENTINEL_EXTENSION = ".ready";

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".exr", ".mov", ".dpx", ".audio", ".wav", ".vdb",
  ".usd", ".usda", ".usdc", ".usdz", ".abc",
]);

const RENDER_PATTERN =
  /^projects\/(?<project>[^/]+)\/(?:(?<episode>EP\w+)\/)?(?<sequence>[^/]+)\/(?<shot>[^/]+)\/render\/(?<version>v\d+[^/]*)\/(?<filename>[^/]+)$/;

export interface ParsedRenderPath {
  projectCode: string;
  episodeCode: string | null;
  sequenceCode: string;
  shotCode: string;
  versionLabel: string;
  filename: string;
  extension: string;
  isSentinel: boolean;
}

export function parseRenderPath(key: string): ParsedRenderPath | null {
  const match = RENDER_PATTERN.exec(key);
  if (!match || !match.groups) return null;

  const filename = match.groups.filename;
  const dotIdx = filename.lastIndexOf(".");
  const extension = dotIdx === -1 ? "" : "." + filename.slice(dotIdx + 1).toLowerCase();

  if (extension === SENTINEL_EXTENSION) {
    // Sentinel — represent the whole render directory as the "filename".
    const slashIdx = key.lastIndexOf("/");
    const renderDir = slashIdx === -1 ? key : key.slice(0, slashIdx + 1);
    return {
      projectCode: match.groups.project,
      episodeCode: match.groups.episode ?? null,
      sequenceCode: match.groups.sequence,
      shotCode: match.groups.shot,
      versionLabel: match.groups.version,
      filename: renderDir.replace(/\/$/, ""),
      extension: SENTINEL_EXTENSION,
      isSentinel: true,
    };
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) return null;

  return {
    projectCode: match.groups.project,
    episodeCode: match.groups.episode ?? null,
    sequenceCode: match.groups.sequence,
    shotCode: match.groups.shot,
    versionLabel: match.groups.version,
    filename,
    extension,
    isSentinel: false,
  };
}
