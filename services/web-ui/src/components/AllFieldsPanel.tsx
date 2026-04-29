/**
 * AllFieldsPanel — Frame.io-style "All Fields ({count})" view used by
 * BOTH the asset side panel (AssetDetailPanel INFO tab) and the
 * full-screen viewer (MediaPreview). Single source of truth for
 * file-kind-aware metadata rendering: callers pass an AssetRow, this
 * component fetches via useAssetMetadata, builds the field list with
 * buildAssetFields, and renders FILE / MEDIA / ATTRIBUTES sections.
 */

import { useAssetMetadata } from "../hooks/useAssetMetadata";
import { buildAssetFields, groupFields } from "../utils/asset-fields";
import type { AssetRow } from "../types";

interface AllFieldsPanelProps {
  asset: AssetRow;
  /** Hide the filename header (caller supplies its own header) */
  hideHeader?: boolean;
}

export function AllFieldsPanel({ asset, hideHeader = false }: AllFieldsPanelProps) {
  const result = useAssetMetadata(asset.id);
  const metadata = result.status === "ready" ? result.data : undefined;

  const fields = buildAssetFields(asset, metadata);
  const groups = groupFields(fields);
  const totalCount = fields.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!hideHeader && (
        <div className="px-4 pt-4 pb-2 border-b border-[var(--color-ah-border)]">
          <h3 className="text-[14px] font-semibold text-[var(--color-ah-text)] truncate" title={asset.title}>
            {asset.title}
          </h3>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pt-3 pb-4">
        <div className="text-[12px] font-medium text-[var(--color-ah-text-muted)] mb-3">
          All Fields ({totalCount})
        </div>

        {result.status === "loading" && (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)] italic">Loading metadata…</p>
        )}
        {result.status === "error" && (
          <p className="text-[11px] text-red-400">Failed to load metadata: {result.error}</p>
        )}

        {[...groups.entries()].map(([group, gFields]) => (
          <section key={group} className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-[var(--font-ah-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--color-ah-text-subtle)] uppercase">
                {group}
              </span>
              <span className="font-[var(--font-ah-mono)] text-[9px] text-[var(--color-ah-text-subtle)]">
                ({gFields.length})
              </span>
              <div className="flex-1 h-px bg-[var(--color-ah-border)]" />
            </div>
            <dl>
              {gFields.map((f, i) => (
                <div
                  key={`${group}-${f.label}-${i}`}
                  className="flex items-baseline justify-between gap-3 py-[4px]"
                >
                  <dt className="font-[var(--font-ah-mono)] text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">
                    {f.label}
                  </dt>
                  <dd
                    className="text-[11px] font-[var(--font-ah-mono)] text-[var(--color-ah-text)] text-right truncate max-w-[60%]"
                    title={f.value}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {result.status === "ready" && totalCount === 2 && (
          <p className="text-[11px] text-[var(--color-ah-text-subtle)] italic mt-2">
            No metadata extracted yet. Re-run the pipeline if this looks wrong.
          </p>
        )}
      </div>
    </div>
  );
}
