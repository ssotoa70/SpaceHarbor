import { useState, useEffect, useCallback } from "react";
import { fetchShotBoard } from "../api";
import type { ShotBoardCard, ShotBoardResponse, ShotStatus } from "../api";
import { useProject } from "../contexts/ProjectContext";


const COLUMN_COLORS: Record<ShotStatus, string> = {
  not_started: "border-[var(--color-ah-text-subtle)]",
  in_progress: "border-[var(--color-ah-info)]",
  review: "border-[var(--color-ah-warning)]",
  approved: "border-[var(--color-ah-success)]",
  final: "border-[var(--color-ah-accent)]",
  on_hold: "border-[var(--color-ah-danger)]",
};

const COLUMN_LABELS: Record<ShotStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  review: "Review",
  approved: "Approved",
  final: "Final",
  on_hold: "On Hold",
};

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-[var(--color-ah-danger)]",
  high: "bg-[var(--color-ah-warning)]",
  normal: "bg-[var(--color-ah-text-subtle)]",
  low: "bg-[var(--color-ah-border)]",
};

function ShotCard({ shot }: { shot: ShotBoardCard }) {
  return (
    <div
      className="p-3 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] hover:border-[var(--color-ah-border)] transition-colors"
      data-testid={`shot-card-${shot.id}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-[var(--font-ah-mono)] text-xs font-medium">{shot.code}</span>
        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[shot.priority]}`} title={shot.priority} />
      </div>
      <p className="text-xs text-[var(--color-ah-text-muted)] mb-1">{shot.sequenceName}</p>
      {shot.assignee && (
        <p className="text-[10px] text-[var(--color-ah-text-subtle)] truncate">{shot.assignee}</p>
      )}
      {shot.frameRange && (
        <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-1">
          {shot.frameRange.start}–{shot.frameRange.end} ({shot.frameRange.end - shot.frameRange.start} frames)
        </p>
      )}
      {shot.latestVersionLabel && (
        <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)]">
          {shot.latestVersionLabel}
        </span>
      )}
    </div>
  );
}

export function ShotBoardPage() {
  const { project } = useProject();
  const [board, setBoard] = useState<ShotBoardResponse>({ columns: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchShotBoard(project?.id);
      setBoard(result);
    } catch {
      setBoard({ columns: [] });
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  return (
    <div data-testid="shot-board-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Shot Board</h1>
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-1">
            Kanban view of shot progress{project ? ` for ${project.label}` : ""}
          </p>
        </div>
        <button
          onClick={loadBoard}
          className="px-3 py-1.5 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)] transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 min-w-[200px]">
              <div className="h-6 mb-3 rounded bg-[var(--color-ah-bg-overlay)] animate-pulse" />
              <div className="space-y-2">
                <div className="h-24 rounded bg-[var(--color-ah-bg-overlay)] animate-pulse" />
                <div className="h-24 rounded bg-[var(--color-ah-bg-overlay)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="shot-board-error">
          <div className="text-4xl mb-4 opacity-40">!</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">Unable to load shot board</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md mb-4">The API could not be reached. Check your connection and try again.</p>
          <button
            onClick={loadBoard}
            className="px-4 py-2 text-sm rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        </div>
      ) : board.columns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="shot-board-empty">
          <div className="text-4xl mb-4 opacity-40">&#x1F3AC;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No shots in the board</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            Create shots in the hierarchy to populate the board.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="shot-board-columns">
          {board.columns.map((col) => (
            <div
              key={col.status}
              className={`flex-shrink-0 w-[240px] rounded-[var(--radius-ah-md)] bg-[var(--color-ah-bg-raised)] border-t-2 ${COLUMN_COLORS[col.status]}`}
              data-testid={`board-column-${col.status}`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <h3 className="text-xs font-medium text-[var(--color-ah-text-muted)] uppercase tracking-wider">
                  {COLUMN_LABELS[col.status]}
                </h3>
                <span className="text-[10px] text-[var(--color-ah-text-subtle)] font-[var(--font-ah-mono)]">
                  {col.shots.length}
                </span>
              </div>
              <div className="px-2 pb-2 space-y-2 min-h-[80px]">
                {col.shots.length === 0 ? (
                  <div className="text-center py-6 text-xs text-[var(--color-ah-text-subtle)]">
                    No shots
                  </div>
                ) : (
                  col.shots.map((shot) => <ShotCard key={shot.id} shot={shot} />)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
