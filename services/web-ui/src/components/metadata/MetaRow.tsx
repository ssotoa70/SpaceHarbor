import { useCallback, useState, type ReactNode } from "react";

import { createLogger } from "../../utils/logger";

const log = createLogger("metadata/meta-row");

export interface MetaRowProps {
  label: string;
  value: string | number | null | undefined;
  copyable?: boolean;
  /** Optional hint shown as a small muted suffix (e.g. units). */
  hint?: string;
}

/**
 * Signals to the parent that this row has nothing to render.
 * Exposed so MetaGroup can detect "all children empty" and hide itself.
 */
export const META_ROW_EMPTY_MARKER = Symbol.for("spaceharbor.meta-row.empty");

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      log.warn("clipboard write failed", { error: String(err) });
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${value}`}
      title="Copy to clipboard"
      className="ml-1 text-[10px] text-[var(--color-ah-accent)] hover:text-[var(--color-ah-text)] transition-colors shrink-0"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const isEmpty = (value: MetaRowProps["value"]): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.length === 0);

export function MetaRow({ label, value, copyable, hint }: MetaRowProps): ReactNode {
  if (isEmpty(value)) return null;
  const text = typeof value === "number" ? String(value) : value as string;
  return (
    <div className="flex items-start justify-between gap-2 py-1" data-testid={`meta-row-${label}`}>
      <dt className="text-[11px] text-[var(--color-ah-text-subtle)] shrink-0">{label}</dt>
      <dd className="text-[11px] font-[var(--font-ah-mono)] text-[var(--color-ah-text-muted)] text-right truncate flex items-center gap-0.5">
        <span className="truncate">{text}</span>
        {hint && <span className="ml-1 text-[var(--color-ah-text-subtle)]">{hint}</span>}
        {copyable && <CopyButton value={text} />}
      </dd>
    </div>
  );
}
