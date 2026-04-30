/**
 * Dynamic renderer for frame-pipeline assets (EXR / DPX / TIFF / etc.).
 *
 * Mirrors VideoMetadataRenderer's pattern but reads from the unified
 * AssetMetadataResponse (DB row + child tables + sidecar) rather than a
 * raw sidecar payload. The flat field bag is built by extractFrameFields.
 *
 * - Iterates the injected `groups` config (defaults to FRAME_METADATA_GROUPS).
 * - Hidden-when-empty semantics enforced by MetaRow + MetaGroup.
 * - Unknown extra-attribute keys are NOT rolled into a generic "Other"
 *   group here — they live in the dedicated AOVS / Attributes tabs.
 */

import { type ReactNode } from "react";

import type { AssetMetadataResponse } from "../../api";
import { extractFrameFields } from "./frame-fields-extractor";
import { MetaGroup } from "./MetaGroup";
import { MetaRow } from "./MetaRow";
import {
  FRAME_METADATA_GROUPS,
  type FrameFieldSpec,
  type FrameGroupSpec,
} from "./frame-metadata-groups";
import type { FrameMetadataFields } from "./schemas";

export interface FrameMetadataRendererProps {
  metadata: AssetMetadataResponse | null | undefined;
  groups?: readonly FrameGroupSpec[];
}

export function FrameMetadataRenderer({
  metadata,
  groups = FRAME_METADATA_GROUPS,
}: FrameMetadataRendererProps): ReactNode {
  const fields = extractFrameFields(metadata);

  return (
    <div data-testid="frame-metadata-renderer">
      {groups.map((group) => (
        <MetaGroup
          key={group.id}
          id={group.id}
          title={group.title}
          defaultOpen={group.defaultOpen !== false}
        >
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
    </div>
  );
}

function resolveFieldValue(spec: FrameFieldSpec, fields: FrameMetadataFields): string | null {
  if (spec.format) return spec.format(fields);
  if (spec.key) {
    const v = fields[spec.key];
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return null;
  }
  return null;
}
