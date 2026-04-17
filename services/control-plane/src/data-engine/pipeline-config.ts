/**
 * DataEnginePipelineConfig — admin-controlled routing table for the
 * DataEngine functions SpaceHarbor depends on for metadata extraction
 * and proxy generation.
 *
 * This is pure data and validation. It has NO knowledge of how the
 * config is persisted (SettingsStore), how live function records are
 * discovered (dataengine-proxy), or how it is rendered in the UI. It
 * only defines the shape, validates incoming bodies from the PUT
 * /platform/settings route, and normalizes fields (extensions get
 * lowercased and leading-dot-enforced).
 *
 * Fields:
 *   fileKind         — logical routing key used by the web-ui
 *   functionName     — name lookup into VAST DataEngine (the contract)
 *   extensions       — file extensions this pipeline processes
 *   targetSchema     — VastDB schema the function writes to
 *   targetTable      — VastDB table within that schema
 *   sidecarSchemaId  — id that `detectSchema()` returns for this function's
 *                      sidecar (e.g. "frame@1", "video@1")
 *   displayLabel     — optional UI label; defaults to titlecased functionName
 */

export type PipelineFileKind = "image" | "video" | "raw_camera";

export interface DataEnginePipelineConfig {
  fileKind: PipelineFileKind;
  functionName: string;
  extensions: string[];
  targetSchema: string;
  targetTable: string;
  sidecarSchemaId: string;
  displayLabel?: string;
  /** When false, the handler skips the DB query for this pipeline's file kind. Defaults to true. */
  enabled?: boolean;
}

export class InvalidPipelineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPipelineConfigError";
  }
}

const VALID_FILE_KINDS: ReadonlySet<string> = new Set(["image", "video", "raw_camera"]);

/** Valid JSON sidecar schema id format: `{name}@{version}`, e.g. `frame@1`. */
const SIDECAR_SCHEMA_ID_RE = /^[a-z][a-z0-9_-]*@[a-zA-Z0-9.\-_]+$/;

/** Extensions must be lowercase, start with a dot, and have at least one trailing char. */
const EXTENSION_RE = /^\.[a-z0-9]{1,16}$/;

/**
 * Validate and normalize a single pipeline config entry.
 *
 * Throws `InvalidPipelineConfigError` on any failure with a descriptive
 * message so the PUT route can surface it as a 400 error envelope.
 * On success, returns the normalized value (lowercased extensions,
 * trimmed whitespace, etc.) — callers should use the returned value
 * rather than the original to ensure canonical storage.
 */
export function validatePipelineConfig(input: unknown): DataEnginePipelineConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidPipelineConfigError("pipeline config must be a plain object");
  }
  const src = input as Record<string, unknown>;

  const fileKind = src["fileKind"];
  if (typeof fileKind !== "string" || !VALID_FILE_KINDS.has(fileKind)) {
    throw new InvalidPipelineConfigError(
      `fileKind must be one of: ${Array.from(VALID_FILE_KINDS).join(", ")} (got ${JSON.stringify(fileKind)})`,
    );
  }

  const functionName = src["functionName"];
  if (typeof functionName !== "string" || functionName.trim().length === 0) {
    throw new InvalidPipelineConfigError("functionName must be a non-empty string");
  }
  if (functionName.length > 128) {
    throw new InvalidPipelineConfigError("functionName must be 128 characters or fewer");
  }

  const rawExtensions = src["extensions"];
  if (!Array.isArray(rawExtensions) || rawExtensions.length === 0) {
    throw new InvalidPipelineConfigError("extensions must be a non-empty array");
  }
  const normalizedExtensions: string[] = [];
  for (const ext of rawExtensions) {
    if (typeof ext !== "string") {
      throw new InvalidPipelineConfigError(`every extension must be a string (got ${typeof ext})`);
    }
    const normalized = ext.trim().toLowerCase();
    if (!EXTENSION_RE.test(normalized)) {
      throw new InvalidPipelineConfigError(
        `extension ${JSON.stringify(ext)} is invalid — must match ${EXTENSION_RE} (lowercase, leading dot, alphanumeric)`,
      );
    }
    if (!normalizedExtensions.includes(normalized)) {
      normalizedExtensions.push(normalized);
    }
  }

  const targetSchema = src["targetSchema"];
  if (typeof targetSchema !== "string" || targetSchema.trim().length === 0) {
    throw new InvalidPipelineConfigError("targetSchema must be a non-empty string");
  }

  const targetTable = src["targetTable"];
  if (typeof targetTable !== "string" || targetTable.trim().length === 0) {
    throw new InvalidPipelineConfigError("targetTable must be a non-empty string");
  }

  const sidecarSchemaId = src["sidecarSchemaId"];
  if (typeof sidecarSchemaId !== "string" || !SIDECAR_SCHEMA_ID_RE.test(sidecarSchemaId)) {
    throw new InvalidPipelineConfigError(
      `sidecarSchemaId must match ${SIDECAR_SCHEMA_ID_RE} (e.g. "frame@1", "video@1"); got ${JSON.stringify(sidecarSchemaId)}`,
    );
  }

  const displayLabelRaw = src["displayLabel"];
  let displayLabel: string | undefined;
  if (displayLabelRaw !== undefined) {
    if (typeof displayLabelRaw !== "string") {
      throw new InvalidPipelineConfigError("displayLabel must be a string when present");
    }
    const trimmed = displayLabelRaw.trim();
    if (trimmed.length > 0) {
      displayLabel = trimmed;
    }
  }

  const enabledRaw = src["enabled"];
  let enabled: boolean | undefined;
  if (enabledRaw !== undefined) {
    if (typeof enabledRaw !== "boolean") {
      throw new InvalidPipelineConfigError("enabled must be a boolean when present");
    }
    enabled = enabledRaw;
  }

  return {
    fileKind: fileKind as PipelineFileKind,
    functionName: functionName.trim(),
    extensions: normalizedExtensions,
    targetSchema: targetSchema.trim(),
    targetTable: targetTable.trim(),
    sidecarSchemaId: sidecarSchemaId.trim(),
    displayLabel,
    enabled,
  };
}

/**
 * Validate an array of pipeline configs. Also enforces cross-entry
 * invariants: no duplicate `fileKind` (at most one pipeline per kind),
 * no duplicate extensions across all entries (the routing must be
 * deterministic). Returns the normalized array on success.
 */
export function validatePipelineConfigList(input: unknown): DataEnginePipelineConfig[] {
  if (!Array.isArray(input)) {
    throw new InvalidPipelineConfigError("dataEnginePipelines must be an array");
  }

  const normalized = input.map((entry, idx) => {
    try {
      return validatePipelineConfig(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InvalidPipelineConfigError(`pipelines[${idx}]: ${msg}`);
    }
  });

  const seenFileKinds = new Set<string>();
  const extensionToFileKind = new Map<string, string>();
  for (const entry of normalized) {
    if (seenFileKinds.has(entry.fileKind)) {
      throw new InvalidPipelineConfigError(
        `duplicate pipeline for fileKind=${entry.fileKind} (at most one pipeline per kind)`,
      );
    }
    seenFileKinds.add(entry.fileKind);
    for (const ext of entry.extensions) {
      const previous = extensionToFileKind.get(ext);
      if (previous && previous !== entry.fileKind) {
        throw new InvalidPipelineConfigError(
          `extension ${ext} is claimed by both fileKind=${previous} and fileKind=${entry.fileKind}`,
        );
      }
      extensionToFileKind.set(ext, entry.fileKind);
    }
  }

  return normalized;
}
