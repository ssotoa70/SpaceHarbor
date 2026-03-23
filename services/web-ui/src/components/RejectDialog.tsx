import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../design-system";

interface RejectDialogProps {
  assetTitle: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function RejectDialog({ assetTitle, onConfirm, onCancel }: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleConfirm = useCallback(() => {
    const trimmed = reason.trim();
    if (trimmed) onConfirm(trimmed);
  }, [reason, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-label={`Reject ${assetTitle}`}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md mx-4 p-4 rounded-[var(--radius-ah-lg)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Reject Asset</h2>
        <p className="text-sm text-[var(--color-ah-text-muted)] mb-3">
          Provide a reason for rejecting <span className="font-medium text-[var(--color-ah-text)]">{assetTitle}</span>.
        </p>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Describe what needs to change..."
          className="w-full h-24 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-3 py-2 text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-ah-accent)]"
          aria-label="Rejection reason"
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!reason.trim()}>
            Confirm Rejection
          </Button>
        </div>
      </div>
    </div>
  );
}
