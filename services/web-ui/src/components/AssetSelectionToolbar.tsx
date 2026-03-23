import { Button } from "../design-system";
import { formatFileSize } from "../utils/media-types";

interface AssetSelectionToolbarProps {
  count: number;
  totalBytes?: number;
  onClear: () => void;
  onApproveAll?: () => void;
  onRejectAll?: () => void;
  onDownload?: () => void;
}

export function AssetSelectionToolbar({
  count,
  totalBytes,
  onClear,
  onApproveAll,
  onRejectAll,
  onDownload,
}: AssetSelectionToolbarProps) {
  if (count === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-accent-muted)] bg-[var(--color-ah-bg-raised)] shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
      role="toolbar"
      aria-label="Asset selection actions"
    >
      <span className="text-sm font-medium">
        {count} selected
        {totalBytes ? ` \u00B7 ${formatFileSize(totalBytes)}` : ""}
      </span>

      <div className="w-px h-5 bg-[var(--color-ah-border)]" />

      {onDownload && (
        <Button variant="ghost" onClick={onDownload}>Download</Button>
      )}
      {onApproveAll && (
        <Button variant="primary" onClick={onApproveAll}>Approve All</Button>
      )}
      {onRejectAll && (
        <Button variant="destructive" onClick={onRejectAll}>Reject All</Button>
      )}
      <Button variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}
