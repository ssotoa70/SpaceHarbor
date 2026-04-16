import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  updateAssetStatus,
  addAssetNote,
  archiveAsset,
  requestProcessing,
  type AssetRow,
  type ContextMenuStatus,
} from "../api";
import { useHasPermission } from "./PermissionGate";
import { extractVastPath } from "../utils/media-types";

interface Position {
  x: number;
  y: number;
}

interface AssetContextMenuProps {
  asset: AssetRow;
  position: Position;
  onClose: () => void;
  onStatusChanged?: (asset: AssetRow) => void;
  onArchived?: (assetId: string) => void;
}

type SubMenu = "status" | null;

const STATUS_OPTIONS: Array<{ key: ContextMenuStatus; label: string }> = [
  { key: "qc_pending", label: "QC Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "on_hold", label: "On Hold" },
];

function MenuItem({
  label,
  onClick,
  danger,
  disabled,
  hasSubmenu,
  onHover,
}: {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hasSubmenu?: boolean;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center justify-between rounded transition-colors cursor-pointer
        ${disabled ? "text-[var(--color-ah-text-subtle)] cursor-default" : ""}
        ${danger && !disabled ? "text-red-400 hover:bg-red-500/10" : ""}
        ${!danger && !disabled ? "text-[var(--color-ah-text)] hover:bg-[var(--color-ah-bg-overlay)]" : ""}
      `}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={onHover}
      disabled={disabled}
    >
      <span>{label}</span>
      {hasSubmenu && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="ml-2 opacity-50">
          <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function Separator() {
  return <div className="my-1 border-t border-[var(--color-ah-border-muted)]" />;
}

export function AssetContextMenu({
  asset,
  position,
  onClose,
  onStatusChanged,
  onArchived,
}: AssetContextMenuProps) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [subMenu, setSubMenu] = useState<SubMenu>(null);
  const [noteModal, setNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const canAdmin = useHasPermission("admin:archive");

  // Position adjustment to keep menu in viewport
  const [adjusted, setAdjusted] = useState(position);
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = position.x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : position.x;
    const y = position.y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : position.y;
    setAdjusted({ x, y });
  }, [position]);

  // Close on Escape or outside click
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick, true);
    };
  }, [onClose]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handleSetStatus = useCallback(async (status: ContextMenuStatus) => {
    setLoading(true);
    try {
      const result = await updateAssetStatus(asset.id, status);
      onStatusChanged?.(result.asset);
      showToast(`Status updated to ${status}`);
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setLoading(false);
    }
  }, [asset.id, onStatusChanged, onClose, showToast]);

  const handleAddNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setLoading(true);
    try {
      await addAssetNote(asset.id, noteText.trim());
      showToast("Note added");
      setNoteModal(false);
      setNoteText("");
      onClose();
    } catch {
      showToast("Failed to add note");
    } finally {
      setLoading(false);
    }
  }, [asset.id, noteText, onClose, showToast]);

  const handleCopy = useCallback((text: string, label: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast(`${label} copied`);
    onClose();
  }, [onClose, showToast]);

  const handleReprocess = useCallback(async (action: "proxy" | "metadata") => {
    setLoading(true);
    try {
      await requestProcessing(asset.sourceUri);
      showToast(action === "proxy" ? "Proxy regeneration triggered" : "Metadata re-extraction triggered");
      onClose();
    } catch {
      showToast("Failed to trigger reprocessing");
    } finally {
      setLoading(false);
    }
  }, [asset.sourceUri, onClose, showToast]);

  const handleArchive = useCallback(async () => {
    setLoading(true);
    try {
      await archiveAsset(asset.id);
      onArchived?.(asset.id);
      showToast("Asset archived");
      onClose();
    } catch (e) {
      if (e instanceof Error && e.message.includes("dependent")) {
        showToast(e.message);
      } else {
        showToast("Failed to archive");
      }
    } finally {
      setLoading(false);
    }
  }, [asset.id, onArchived, onClose, showToast]);

  const vastPath = extractVastPath(asset.sourceUri);

  const menu = (
    <>
      <div
        ref={menuRef}
        className="fixed z-[100] min-w-[220px] py-1.5 px-1 rounded-lg border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md"
        style={{ left: adjusted.x, top: adjusted.y }}
        role="menu"
      >
        {/* Navigation */}
        <MenuItem label="Open in Review" onClick={() => { navigate(`/review?asset=${asset.id}`); onClose(); }} />
        <MenuItem label="Open in Storage Browser" onClick={() => { navigate(`/library/storage?path=${encodeURIComponent(vastPath)}`); onClose(); }} />

        <Separator />

        {/* Status submenu */}
        <div
          className="relative"
          onMouseEnter={() => setSubMenu("status")}
          onMouseLeave={() => setSubMenu(null)}
        >
          <MenuItem label="Set Status" hasSubmenu onHover={() => setSubMenu("status")} />
          {subMenu === "status" && (
            <div className="absolute left-full top-0 ml-1 min-w-[160px] py-1.5 px-1 rounded-lg border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              {STATUS_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.key}
                  label={opt.label}
                  onClick={() => void handleSetStatus(opt.key)}
                  disabled={loading}
                />
              ))}
            </div>
          )}
        </div>

        <MenuItem label="Add Note..." onClick={() => setNoteModal(true)} />

        <Separator />

        {/* Copy actions */}
        <MenuItem label="Copy Asset Path" onClick={() => handleCopy(vastPath, "Asset path")} />
        <MenuItem label="Copy S3 URI" onClick={() => handleCopy(asset.sourceUri, "S3 URI")} />
        <MenuItem label="Copy Asset ID" onClick={() => handleCopy(asset.id, "Asset ID")} />

        <Separator />

        {/* Reprocess */}
        <MenuItem label="Regenerate Proxy" onClick={() => void handleReprocess("proxy")} disabled={loading} />
        <MenuItem label="Re-run Metadata Extraction" onClick={() => void handleReprocess("metadata")} disabled={loading} />

        <Separator />

        {/* Archive — admin only */}
        <MenuItem
          label="Archive Asset"
          onClick={() => void handleArchive()}
          danger
          disabled={loading || !canAdmin}
        />
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2 rounded-lg bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border)] text-sm text-[var(--color-ah-text)] shadow-xl">
          {toast}
        </div>
      )}

      {/* Add Note modal */}
      {noteModal && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50" onClick={() => setNoteModal(false)}>
          <div
            className="w-96 p-4 rounded-xl border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--color-ah-text)] mb-2">
              Add Note — {asset.title}
            </h3>
            <textarea
              className="w-full h-24 px-3 py-2 rounded-lg border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] text-sm text-[var(--color-ah-text)] resize-none focus:outline-none focus:border-[var(--color-ah-accent)]"
              placeholder="Type your note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void handleAddNote();
                }
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md text-[var(--color-ah-text-muted)] hover:bg-[var(--color-ah-bg-overlay)] cursor-pointer"
                onClick={() => { setNoteModal(false); setNoteText(""); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-md bg-[var(--color-ah-accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
                onClick={() => void handleAddNote()}
                disabled={loading || !noteText.trim()}
              >
                {loading ? "Saving..." : "Add Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(menu, document.body);
}
