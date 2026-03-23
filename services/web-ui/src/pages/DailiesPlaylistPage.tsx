import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchPlaylist,
  updatePlaylistItemDecision,
  fetchPlaylistReport,
  type PlaylistData,
  type PlaylistItemData,
  type PlaylistItemDecision,
  type DailiesReportEntry,
} from "../api";
import { Badge, Button, Card } from "../design-system";

type DecisionColor = Record<PlaylistItemDecision, string>;
const DECISION_COLORS: DecisionColor = {
  approve: "var(--color-ah-success)",
  reject: "var(--color-ah-error)",
  hold: "var(--color-ah-warning)",
};

function DecisionBadge({ decision }: { decision: PlaylistItemDecision | null }) {
  if (!decision) return <Badge variant="default">Pending</Badge>;
  const label = decision.charAt(0).toUpperCase() + decision.slice(1);
  const color = DECISION_COLORS[decision];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

export function DailiesPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [items, setItems] = useState<PlaylistItemData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [report, setReport] = useState<DailiesReportEntry[] | null>(null);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetchPlaylist(id).then((data) => {
      if (data) {
        setPlaylist(data.playlist);
        setItems(data.items);
      }
    });
  }, [id]);

  const currentItem = items[currentIndex] ?? null;

  const handleDecision = useCallback(async (decision: PlaylistItemDecision) => {
    if (!currentItem || !playlist) return;
    const updated = await updatePlaylistItemDecision(
      playlist.id,
      currentItem.id,
      decision,
      "current-user",
    );
    if (updated) {
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    }
    // Auto-advance to next undecided item
    const nextUndecided = items.findIndex((item, idx) => idx > currentIndex && !item.decision);
    if (nextUndecided >= 0) {
      setCurrentIndex(nextUndecided);
    } else if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentItem, playlist, items, currentIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowRight" && currentIndex < items.length - 1) {
      e.preventDefault();
      setCurrentIndex((i) => i + 1);
    } else if (e.key === "ArrowLeft" && currentIndex > 0) {
      e.preventDefault();
      setCurrentIndex((i) => i - 1);
    } else if (e.key === "a" || e.key === "A") {
      void handleDecision("approve");
    } else if (e.key === "r" || e.key === "R") {
      void handleDecision("reject");
    } else if (e.key === "h" || e.key === "H") {
      void handleDecision("hold");
    }
  }, [currentIndex, items.length, handleDecision]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleShowReport = useCallback(async () => {
    if (!playlist) return;
    const entries = await fetchPlaylistReport(playlist.id);
    setReport(entries);
    setShowReport(true);
  }, [playlist]);

  if (!playlist) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-ah-text-muted)]">Loading playlist...</p>
      </Card>
    );
  }

  return (
    <section aria-label="Dailies playlist review" className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left sidebar — playlist items queue */}
      <Card className="w-60 shrink-0 overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">{playlist.name}</h2>
          <span className="text-xs text-[var(--color-ah-text-muted)]">{playlist.sessionDate}</span>
        </div>
        <p className="text-xs text-[var(--color-ah-text-muted)] mb-3">
          {items.filter((i) => i.decision).length}/{items.length} reviewed
        </p>
        <ul className="space-y-1" data-testid="playlist-queue">
          {items.map((item, idx) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`w-full text-left px-3 py-2 rounded-[var(--radius-ah-sm)] text-sm transition-colors ${
                  idx === currentIndex
                    ? "bg-[var(--color-ah-accent-muted)]/30 border border-[var(--color-ah-accent)]"
                    : "hover:bg-[var(--color-ah-accent-muted)]/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs truncate">{item.shotId}</span>
                  <DecisionBadge decision={item.decision} />
                </div>
                {item.notes && (
                  <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5 truncate">{item.notes}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Center — review area */}
      <div className="flex-1 flex flex-col gap-4">
        {currentItem ? (
          <>
            <Card className="flex-1 flex items-center justify-center bg-black/5">
              <div className="text-center">
                <p className="text-lg font-mono">{currentItem.shotId}</p>
                <p className="text-sm text-[var(--color-ah-text-muted)]">Version: {currentItem.versionId}</p>
                <p className="text-xs text-[var(--color-ah-text-subtle)] mt-1">
                  {currentIndex + 1} of {items.length}
                </p>
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void handleDecision("approve")}
                    data-testid="dailies-approve-btn"
                  >
                    Approve (A)
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void handleDecision("reject")}
                    data-testid="dailies-reject-btn"
                  >
                    Reject (R)
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void handleDecision("hold")}
                    data-testid="dailies-hold-btn"
                  >
                    Hold (H)
                  </Button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((i) => i - 1)}
                    className="text-sm px-2 py-1 border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] disabled:opacity-30"
                  >
                    &larr; Prev
                  </button>
                  <button
                    type="button"
                    disabled={currentIndex >= items.length - 1}
                    onClick={() => setCurrentIndex((i) => i + 1)}
                    className="text-sm px-2 py-1 border border-[var(--color-ah-border)] rounded-[var(--radius-ah-sm)] disabled:opacity-30"
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <DecisionBadge decision={currentItem.decision} />
                {currentItem.decidedBy && (
                  <span className="text-xs text-[var(--color-ah-text-muted)]">by {currentItem.decidedBy}</span>
                )}
              </div>
            </Card>
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <p className="text-sm text-[var(--color-ah-text-muted)]">No items in playlist</p>
          </Card>
        )}

        {/* Actions bar */}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={handleShowReport}>
            Export Report
          </Button>
          <Button variant="secondary" onClick={() => navigate("/playlists")}>
            Back to Playlists
          </Button>
        </div>
      </div>

      {/* Report modal */}
      {showReport && report && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowReport(false); }}
        >
          <div className="bg-[var(--color-ah-surface)] border border-[var(--color-ah-border)] rounded-[var(--radius-ah-md)] shadow-lg w-[600px] max-h-[80vh] overflow-auto p-4">
            <h2 className="text-sm font-semibold mb-3">Dailies Report — {playlist.name}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-ah-text-muted)] border-b border-[var(--color-ah-border)]">
                  <th className="pb-1">Shot</th>
                  <th className="pb-1">Version</th>
                  <th className="pb-1">Decision</th>
                  <th className="pb-1">By</th>
                  <th className="pb-1">Notes</th>
                  <th className="pb-1 text-right">Comments</th>
                </tr>
              </thead>
              <tbody>
                {report.map((entry) => (
                  <tr key={`${entry.shotId}-${entry.versionId}`} className="border-b border-[var(--color-ah-border)]/50">
                    <td className="py-1 font-mono text-xs">{entry.shotCode ?? entry.shotId}</td>
                    <td className="py-1 text-xs">{entry.versionLabel ?? entry.versionId}</td>
                    <td className="py-1"><DecisionBadge decision={entry.decision} /></td>
                    <td className="py-1 text-xs">{entry.decidedBy ?? "-"}</td>
                    <td className="py-1 text-xs truncate max-w-[150px]">{entry.notes ?? "-"}</td>
                    <td className="py-1 text-xs text-right">{entry.commentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" onClick={() => setShowReport(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
