/**
 * FrameSequenceIntegrity — placeholder block at the bottom of the AOVS tab.
 *
 * Per the user's mockup: shows total frames / missing / corrupt / validated
 * timestamp / checksum status for a frame sequence. Real backend (a sequence-
 * scanner job that walks every frame_number, checks for gaps, and stores
 * xxh3 + SHA256 hashes per frame) is OUT OF SCOPE for this PR — the
 * media-pipeline agent confirmed `frame-validate` is not a known tool in
 * the SpaceHarbor pipeline today.
 *
 * Until the scanner ships, this block:
 *   - Renders an explanatory "Not yet validated" empty state.
 *   - Surfaces a "Run Integrity Check" button that POSTs to a stub
 *     endpoint (which returns 503 NOT_IMPLEMENTED, mirroring the
 *     function-configs-routes pattern from Phase 6.0). Button reflects
 *     loading / error states so the action is discoverable but doesn't
 *     fabricate a result.
 *
 * Hash strategy noted for the scanner work (per workflow agent): store
 * BOTH xxh3 (fast verify, 2026 VFX-pipeline standard) AND SHA256
 * (compliance / chain-of-custody).
 */

import { useState, type ReactNode } from "react";

import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { extractFrameFields } from "./metadata/frame-fields-extractor";
import type { AssetRow } from "../types";

interface FrameSequenceIntegrityProps {
  asset: AssetRow;
}

interface CheckState {
  status: "idle" | "running" | "not_implemented" | "error";
  message?: string;
}

export function FrameSequenceIntegrity({ asset }: FrameSequenceIntegrityProps): ReactNode {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : null;
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  // Only relevant when this is a sequence-style asset (has frame_number or
  // multiple parts that imply a multi-frame render). Hide entirely for
  // non-sequence assets (single-frame stills, video).
  const fields = extractFrameFields(metadata);
  const isSequence =
    typeof fields.frame_number === "number"
    || (fields.parts_count != null && fields.parts_count > 0);
  if (!isSequence) return null;

  async function runCheck() {
    setCheck({ status: "running" });
    try {
      const res = await fetch(`/api/v1/assets/${encodeURIComponent(asset.id)}/sequence-integrity`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setCheck({ status: "not_implemented", message: body.message ?? "Sequence integrity scanner not yet wired" });
        return;
      }
      if (!res.ok) {
        setCheck({ status: "error", message: `HTTP ${res.status}` });
        return;
      }
      // Success path lands here when the scanner ships — until then this
      // branch is unreachable. Reset to idle and let the panel reload.
      setCheck({ status: "idle" });
    } catch (err) {
      setCheck({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div
      className="px-4 py-4 border-t border-[var(--color-ah-border)] mt-3"
      data-testid="frame-sequence-integrity"
    >
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-[12px] font-semibold text-[var(--color-ah-text)] uppercase tracking-wider">
          Frame Sequence Integrity
        </h4>
        <span className="text-[10px] text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
          Not validated
        </span>
      </div>

      <p className="text-[11px] text-[var(--color-ah-text-subtle)] mb-3 leading-relaxed">
        Run an integrity check to verify the frame range, detect missing or corrupt
        frames, and store SHA-256 + xxh3 checksums per frame for the conform record.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={check.status === "running"}
          className="px-2.5 py-1 rounded border border-[var(--color-ah-border)] text-[11px] font-medium text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-raised)] disabled:opacity-50 cursor-pointer"
          data-testid="run-integrity-check"
        >
          {check.status === "running" ? "Running…" : "Run Integrity Check"}
        </button>
        {check.status === "not_implemented" && (
          <span
            className="text-[10px] text-amber-400"
            data-testid="integrity-not-implemented"
          >
            Backend scanner not yet implemented — see follow-up.
          </span>
        )}
        {check.status === "error" && (
          <span className="text-[10px] text-red-400">{check.message}</span>
        )}
      </div>
    </div>
  );
}
