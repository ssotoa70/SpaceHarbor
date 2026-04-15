import { type ReactNode } from "react";

import { createLogger } from "../../utils/logger";
import { MetaGroup } from "./MetaGroup";
import { MetaRow } from "./MetaRow";
import { detectSchema, extractVideoFields } from "./schema-dispatch";
import type { VideoMetadataFields } from "./schemas";
import {
  collectKnownKeys,
  VIDEO_METADATA_GROUPS,
  type VideoFieldSpec,
  type VideoGroupSpec,
} from "./video-metadata-groups";

const log = createLogger("metadata/video-renderer");

export interface VideoMetadataRendererProps {
  payload: unknown;
  groups?: readonly VideoGroupSpec[];
}

/**
 * Dynamic renderer for video@1 sidecars.
 *
 * - Validates the envelope via `detectSchema`; falls back to a friendly
 *   empty-state for null, foreign, or unknown payloads.
 * - Iterates the injected `groups` config (defaults to `VIDEO_METADATA_GROUPS`).
 * - Hidden-when-empty semantics are enforced by `MetaRow` + `MetaGroup`.
 * - Unknown top-level fields are collected into an "Other" group so new
 *   extractor fields still appear without a code change.
 */
export function VideoMetadataRenderer({
  payload,
  groups = VIDEO_METADATA_GROUPS,
}: VideoMetadataRendererProps): ReactNode {
  const schema = detectSchema(payload);
  if (schema !== "video@1") {
    log.debug("payload is not a video@1 envelope", { schema });
    return (
      <div
        data-testid="metadata-empty"
        className="px-2 py-4 text-[11px] text-[var(--color-ah-text-subtle)]"
      >
        No video metadata available for this asset.
      </div>
    );
  }

  const fields = extractVideoFields(payload);
  const knownKeys = collectKnownKeys(groups);
  const unknownFields = pickUnknownFields(fields, knownKeys);

  return (
    <div data-testid="video-metadata-renderer">
      {groups.map((group) => (
        <MetaGroup key={group.id} id={group.id} title={group.title} defaultOpen={group.defaultOpen !== false}>
          {group.fields.map((spec) => (
            <MetaRow
              key={spec.id}
              label={spec.label}
              value={resolveFieldValue(spec, fields)}
              copyable={spec.copyable}
              hint={spec.hint}
            />
          ))}
        </MetaGroup>
      ))}
      {unknownFields.length > 0 && (
        <MetaGroup id="other" title="Other" defaultOpen={false}>
          {unknownFields.map(([key, value]) => (
            <MetaRow key={key} label={key} value={stringifyUnknown(value)} />
          ))}
        </MetaGroup>
      )}
    </div>
  );
}

function resolveFieldValue(spec: VideoFieldSpec, fields: VideoMetadataFields): string | null {
  if (spec.format) {
    try {
      return spec.format(fields);
    } catch (err) {
      log.warn("formatter threw", { field: spec.id, error: String(err) });
      return null;
    }
  }
  if (spec.key) {
    const raw = fields[spec.key];
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string") return raw.length > 0 ? raw : null;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return null;
  }
  log.warn("field spec has neither key nor format", { field: spec.id });
  return null;
}

const IGNORED_KEYS_FOR_OTHER: ReadonlySet<string> = new Set([
  "$schema",
  "schema_version",
  "file_id",
  "asset_id",
  "s3_key",
  "s3_bucket",
  "original_filename",
  "metadata_sidecar_s3_key",
  "generator_version",
]);

function pickUnknownFields(
  fields: VideoMetadataFields,
  knownKeys: ReadonlySet<string>,
): Array<[string, unknown]> {
  const result: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (knownKeys.has(key)) continue;
    if (IGNORED_KEYS_FOR_OTHER.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result.push([key, value]);
  }
  return result;
}

function stringifyUnknown(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
