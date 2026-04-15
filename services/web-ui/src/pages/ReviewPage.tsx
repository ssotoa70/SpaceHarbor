import { useCallback, useEffect, useRef, useState } from "react";

import {
  approveAsset,
  fetchApprovalQueue,
  fetchFrameComments,
  fetchRejectedFeedback,
  createFrameComment,
  resolveFrameComment,
  rejectAsset,
  resubmitVersion,
} from "../api";
import type { ReviewCommentData } from "../api";
import { Badge, Button, Card } from "../design-system";
import { AssetMetadataPanel } from "../components/AssetMetadataPanel";
import { useStorageSidecar } from "../hooks/useStorageSidecar";
import { CloseIcon } from "../components/CloseIcon";
import { ProvenancePanel } from "../components/ProvenancePanel";
import { MediaTypeIcon } from "../components/MediaTypeIcon";
import { RejectDialog } from "../components/RejectDialog";
import { ReviewPlayer } from "../components/ReviewPlayer";
import { TimecodedCommentTrack } from "../components/TimecodedCommentTrack";
import { PlaybackProvider } from "../contexts/PlaybackContext";
import { inferMediaType } from "../utils/media-types";
import type { AssetRow, RejectedAssetRow } from "../types";

export type ReviewDecision = "approve" | "reject" | "hold";

type ReviewTab = "queue" | "feedback";

/**
 * Metadata side panel wrapper — mounts a single hook call so the panel
 * and its provenance block only render when an asset is selected, while
 * still following the "hooks at top level" rule.
 */
function SelectedAssetSidePanel({ asset }: { asset: AssetRow }) {
  const { sidecar } = useStorageSidecar(asset.sourceUri);
  return (
    <div className="h-full overflow-auto p-3" data-testid="review-asset-side-panel">
      <h3 className="text-sm font-semibold mb-2 truncate">{asset.title}</h3>
      <AssetMetadataPanel asset={asset} variant="panel" sidecar={sidecar?.data} />
      <ProvenancePanel
        versionId={asset.version?.parent_version_id ?? asset.id}
        createdAt={asset.createdAt}
        variant="card"
      />
    </div>
  );
}

/** Resolve the best playback URI: prefer proxy, fall back to sourceUri for HTTP assets */
function resolvePlaybackUri(asset: AssetRow | null): string | null {
  if (!asset) return null;
  if (asset.proxy?.uri) return asset.proxy.uri;
  if (asset.sourceUri && (asset.sourceUri.startsWith("http") || asset.sourceUri.startsWith("/"))) return asset.sourceUri;
  return null;
}

/** Increment a version label string (e.g. "v1" -> "v2", "v003" -> "v004") */
function incrementVersionLabel(label: string | undefined): string {
  if (!label) return "v2";
  const match = label.match(/^(v?)(\d+)$/i);
  if (!match) return `${label}_v2`;
  const prefix = match[1] || "v";
  const num = parseInt(match[2], 10) + 1;
  const padded = String(num).padStart(match[2].length, "0");
  return `${prefix}${padded}`;
}

/* ── Resubmit Dialog ── */

function ResubmitDialog({
  asset,
  onConfirm,
  onCancel,
}: {
  asset: RejectedAssetRow;
  onConfirm: (sourceUri: string, versionLabel: string) => void;
  onCancel: () => void;
}) {
  const nextVersion = incrementVersionLabel(asset.version?.version_label);
  const [sourceUri, setSourceUri] = useState(asset.sourceUri);
  const [versionLabel, setVersionLabel] = useState(nextVersion);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <Card className="w-[480px] max-w-[90vw]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Resubmit Version</h3>
          <button onClick={onCancel} className="text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]">
            <CloseIcon />
          </button>
        </div>

        <p className="text-sm text-[var(--color-ah-text-muted)] mb-3">
          Resubmitting <strong>{asset.title}</strong> with original metadata pre-filled.
        </p>

        {asset.rejectionReason && (
          <div className="mb-3 p-2 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-danger)]/10 border border-[var(--color-ah-danger)]/30">
            <span className="text-xs font-medium text-[var(--color-ah-danger)]">Rejection reason:</span>
            <p className="text-sm mt-1">{asset.rejectionReason}</p>
          </div>
        )}

        <div className="grid gap-3 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Source URI</span>
            <input
              type="text"
              value={sourceUri}
              onChange={(e) => setSourceUri(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
              placeholder="/var/204/vfx/shot_010/beauty_v003.exr"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-ah-text-muted)]">Version Label</span>
            <input
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[var(--color-ah-bg-raised)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-ah-text-muted)]">
            {asset.productionMetadata?.sequence && (
              <div>Sequence: <span className="font-mono">{asset.productionMetadata.sequence}</span></div>
            )}
            {asset.productionMetadata?.shot && (
              <div>Shot: <span className="font-mono">{asset.productionMetadata.shot}</span></div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(sourceUri.trim(), versionLabel.trim())}
            disabled={!sourceUri.trim() || !versionLabel.trim()}
          >
            Resubmit
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ── Queue Sidebar Card ── */

function QueueCard({
  asset,
  isSelected,
  isHeld,
  isBulkSelected,
  onSelect,
  onToggleBulk,
  onApprove,
  onHold,
  onReject,
}: {
  asset: AssetRow;
  isSelected: boolean;
  isHeld: boolean;
  isBulkSelected: boolean;
  onSelect: () => void;
  onToggleBulk: () => void;
  onApprove: () => void;
  onHold: () => void;
  onReject: () => void;
}) {
  const mediaType = inferMediaType(asset.title, asset.sourceUri);

  return (
    <div
      className={`p-2 rounded-[var(--radius-ah-sm)] cursor-pointer border transition-colors ${
        isSelected
          ? "border-[var(--color-ah-accent)] bg-[var(--color-ah-accent-muted)]/10"
          : isHeld
            ? "border-[var(--color-ah-warning)] bg-[var(--color-ah-warning)]/5"
            : "border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isBulkSelected}
          onChange={(e) => { e.stopPropagation(); onToggleBulk(); }}
          className="shrink-0"
          aria-label={`Select ${asset.title}`}
        />
        <div className="w-8 h-6 rounded-sm flex items-center justify-center overflow-hidden shrink-0">
          {asset.thumbnail?.uri ? (
            <img src={asset.thumbnail.uri} alt="" className="w-full h-full object-cover" />
          ) : (
            <MediaTypeIcon type={mediaType} size={18} className="text-[var(--color-ah-text-muted)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate block">{asset.title}</span>
          <div className="flex items-center gap-1">
            <Badge variant={asset.status === "qc_pending" ? "warning" : "default"}>{asset.status}</Badge>
            {isHeld && <Badge variant="warning">hold</Badge>}
          </div>
        </div>
      </div>
      <div className="flex gap-1 mt-1.5 pl-6" onClick={(e) => e.stopPropagation()}>
        <Button variant="primary" onClick={onApprove}>Approve</Button>
        <Button
          variant={isHeld ? "secondary" : "ghost"}
          onClick={onHold}
          aria-label={isHeld ? "Unhold" : "Hold"}
        >
          Hold
        </Button>
        <Button variant="destructive" onClick={onReject}>Reject</Button>
      </div>
    </div>
  );
}

/* ── My Feedback Panel ── */

function MyFeedbackPanel({
  rejected,
  loading,
  onSelect,
  selectedId,
  onResubmit,
}: {
  rejected: RejectedAssetRow[];
  loading: boolean;
  onSelect: (asset: RejectedAssetRow) => void;
  selectedId: string | null;
  onResubmit: (asset: RejectedAssetRow) => void;
}) {
  if (loading) {
    return <p className="text-sm text-[var(--color-ah-text-muted)]">Loading feedback...</p>;
  }

  if (rejected.length === 0) {
    return <p className="text-sm text-[var(--color-ah-text-muted)]">No rejected versions.</p>;
  }

  return (
    <div className="grid gap-2">
      {rejected.map((asset) => {
        const mediaType = inferMediaType(asset.title, asset.sourceUri);
        const commentCount = asset.comments?.length ?? 0;

        return (
          <div
            key={asset.id}
            className={`p-3 rounded-[var(--radius-ah-md)] cursor-pointer border ${
              selectedId === asset.id
                ? "border-[var(--color-ah-accent)] bg-[var(--color-ah-accent-muted)]/10"
                : "border-[var(--color-ah-border-muted)] hover:bg-[var(--color-ah-bg-overlay)]"
            }`}
            onClick={() => onSelect(asset)}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-8 rounded-sm flex items-center justify-center overflow-hidden shrink-0">
                {asset.thumbnail?.uri ? (
                  <img src={asset.thumbnail.uri} alt="" className="w-full h-full object-cover" />
                ) : (
                  <MediaTypeIcon type={mediaType} size={20} className="text-[var(--color-ah-text-muted)]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">{asset.title}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <Badge variant="danger">rejected</Badge>
                  {commentCount > 0 && (
                    <Badge variant="default">{commentCount} comment{commentCount !== 1 ? "s" : ""}</Badge>
                  )}
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" onClick={() => onResubmit(asset)}>
                  Resubmit
                </Button>
              </div>
            </div>

            {asset.rejectionReason && (
              <div className="mt-2 pl-[52px]">
                <p className="text-xs text-[var(--color-ah-danger)]">
                  <span className="font-medium">Reason:</span> {asset.rejectionReason}
                </p>
                {asset.rejectedBy && (
                  <p className="text-xs text-[var(--color-ah-text-muted)] mt-0.5">
                    by {asset.rejectedBy} {asset.rejectedAt ? `on ${new Date(asset.rejectedAt).toLocaleDateString()}` : ""}
                  </p>
                )}
              </div>
            )}

            {commentCount > 0 && selectedId === asset.id && (
              <div className="mt-2 pl-[52px] grid gap-1">
                {asset.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="text-xs p-2 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-bg-overlay)] border border-[var(--color-ah-border-muted)]"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-[var(--color-ah-text)]">{comment.authorId}</span>
                      {comment.frameNumber != null && (
                        <Badge variant="default">
                          {comment.timecode ?? `F${comment.frameNumber}`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[var(--color-ah-text-muted)]">{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main ReviewPage ── */

export function ReviewPage() {
  const [activeTab, setActiveTab] = useState<ReviewTab>("queue");
  const [queue, setQueue] = useState<AssetRow[]>([]);
  const [rejected, setRejected] = useState<RejectedAssetRow[]>([]);
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AssetRow | null>(null);
  const [resubmitTarget, setResubmitTarget] = useState<RejectedAssetRow | null>(null);
  const [heldIds, setHeldIds] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<ReviewCommentData[]>([]);

  // Use a stable session ID for comments (in production, this would come from the review session)
  const sessionId = useRef(`session-${Date.now()}`);

  useEffect(() => {
    void fetchApprovalQueue("created_at", "desc", 1, 50).then(({ assets }) => {
      setQueue(assets);
      setLoading(false);
    });
  }, []);

  // Load rejected feedback when switching to feedback tab
  useEffect(() => {
    if (activeTab === "feedback") {
      setFeedbackLoading(true);
      void fetchRejectedFeedback().then((assets) => {
        setRejected(assets);
        setFeedbackLoading(false);
      });
    }
  }, [activeTab]);

  // Load comments when an asset is selected
  useEffect(() => {
    if (!selected) {
      setComments([]);
      return;
    }
    void fetchFrameComments(sessionId.current)
      .then(setComments)
      .catch(() => setComments([]));
  }, [selected]);

  const handleApprove = useCallback(async (id: string) => {
    await approveAsset(id);
    setQueue((prev) => prev.filter((a) => a.id !== id));
    if (selected?.id === id) setSelected(null);
  }, [selected]);

  const handleRejectConfirm = useCallback(async (id: string, reason: string) => {
    await rejectAsset(id, reason);
    setQueue((prev) => prev.filter((a) => a.id !== id));
    if (selected?.id === id) setSelected(null);
    setRejectTarget(null);
  }, [selected]);

  const handleHold = useCallback((id: string) => {
    setHeldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkApprove = useCallback(async () => {
    for (const id of bulkSelected) {
      await approveAsset(id);
    }
    setQueue((prev) => prev.filter((a) => !bulkSelected.has(a.id)));
    setBulkSelected(new Set());
    setSelected(null);
  }, [bulkSelected]);

  const toggleBulk = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleResubmitConfirm = useCallback(async (sourceUri: string, versionLabel: string) => {
    if (!resubmitTarget) return;
    await resubmitVersion({
      title: resubmitTarget.title,
      sourceUri,
      shotId: resubmitTarget.productionMetadata?.shot ?? undefined,
      projectId: resubmitTarget.productionMetadata?.show ?? undefined,
      versionLabel,
    });
    setRejected((prev) => prev.filter((a) => a.id !== resubmitTarget.id));
    setResubmitTarget(null);
    if (selected?.id === resubmitTarget.id) setSelected(null);
  }, [resubmitTarget, selected]);

  const handleAddComment = useCallback(async (body: string, frameNumber: number, timecode: string, parentCommentId?: string) => {
    try {
      const comment = await createFrameComment(sessionId.current, {
        authorId: "current-user",
        body,
        frameNumber,
        timecode,
        parentCommentId,
      });
      setComments((prev) => [...prev, comment]);
    } catch {
      // Silently fail in UI — comment API may be unavailable
    }
  }, []);

  const handleResolveComment = useCallback(async (commentId: string) => {
    try {
      await resolveFrameComment(commentId);
      setComments((prev) =>
        prev.map((c) => c.id === commentId ? { ...c, status: "resolved" as const } : c),
      );
    } catch {
      // Silently fail
    }
  }, []);

  return (
    <PlaybackProvider>
      <section aria-label="Review session" className="flex gap-0 h-[calc(100vh-4rem)]">
        {/* ── Left: Queue Sidebar (240px) ── */}
        <div className="w-60 shrink-0 border-r border-[var(--color-ah-border-muted)] flex flex-col overflow-hidden">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 p-2 border-b border-[var(--color-ah-border-muted)]">
            <button
              className={`px-2 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
                activeTab === "queue"
                  ? "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
              }`}
              onClick={() => setActiveTab("queue")}
            >
              Queue
              {queue.length > 0 && (
                <span className="ml-1 text-[10px] opacity-70">({queue.length})</span>
              )}
            </button>
            <button
              className={`px-2 py-1 text-xs font-medium rounded-[var(--radius-ah-sm)] transition-colors ${
                activeTab === "feedback"
                  ? "bg-[var(--color-ah-accent)]/15 text-[var(--color-ah-accent)]"
                  : "text-[var(--color-ah-text-muted)] hover:text-[var(--color-ah-text)]"
              }`}
              onClick={() => setActiveTab("feedback")}
            >
              My Feedback
              {rejected.length > 0 && (
                <span className="ml-1 text-[10px] opacity-70">({rejected.length})</span>
              )}
            </button>
          </div>

          {/* Queue content — scrollable */}
          <div className="flex-1 overflow-auto p-2">
            {activeTab === "queue" && (
              <>
                {bulkSelected.size > 0 && (
                  <div className="flex gap-1 mb-2">
                    <Button variant="primary" onClick={() => void handleBulkApprove()}>
                      Approve ({bulkSelected.size})
                    </Button>
                    <Button variant="ghost" onClick={() => setBulkSelected(new Set())}>Clear</Button>
                  </div>
                )}

                {loading ? (
                  <p className="text-xs text-[var(--color-ah-text-muted)]">Loading...</p>
                ) : queue.length === 0 ? (
                  <p className="text-xs text-[var(--color-ah-text-muted)]">Queue is empty.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {queue.map((asset) => (
                      <QueueCard
                        key={asset.id}
                        asset={asset}
                        isSelected={selected?.id === asset.id}
                        isHeld={heldIds.has(asset.id)}
                        isBulkSelected={bulkSelected.has(asset.id)}
                        onSelect={() => setSelected(asset)}
                        onToggleBulk={() => toggleBulk(asset.id)}
                        onApprove={() => void handleApprove(asset.id)}
                        onHold={() => handleHold(asset.id)}
                        onReject={() => setRejectTarget(asset)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "feedback" && (
              <MyFeedbackPanel
                rejected={rejected}
                loading={feedbackLoading}
                onSelect={(asset) => setSelected(asset)}
                selectedId={selected?.id ?? null}
                onResubmit={(asset) => setResubmitTarget(asset)}
              />
            )}
          </div>
        </div>

        {/* ── Center: ReviewPlayer + Comments ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* ReviewPlayer */}
          <div className="p-3 shrink-0">
            <ReviewPlayer
              src={resolvePlaybackUri(selected)}
              title={selected?.title ?? ""}
              comments={comments}
            />
          </div>

          {/* TimecodedCommentTrack — fills remaining vertical space */}
          <div className="flex-1 min-h-0 border-t border-[var(--color-ah-border-muted)]">
            {selected ? (
              <TimecodedCommentTrack
                comments={comments}
                sessionId={sessionId.current}
                onAddComment={(body, frame, tc, parentId) => void handleAddComment(body, frame, tc, parentId)}
                onResolve={(id) => void handleResolveComment(id)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-[var(--color-ah-text-subtle)]">
                Select an asset to view comments
              </div>
            )}
          </div>
        </div>

        {/* ── Right: AssetMetadataPanel (320px) ── */}
        <div className="w-80 shrink-0 border-l border-[var(--color-ah-border-muted)] overflow-hidden">
          {selected ? (
            <SelectedAssetSidePanel asset={selected} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-[var(--color-ah-text-subtle)]">
              No asset selected
            </div>
          )}
        </div>

        {/* Dialogs */}
        {rejectTarget && (
          <RejectDialog
            assetTitle={rejectTarget.title}
            onConfirm={(reason) => void handleRejectConfirm(rejectTarget.id, reason)}
            onCancel={() => setRejectTarget(null)}
          />
        )}

        {resubmitTarget && (
          <ResubmitDialog
            asset={resubmitTarget}
            onConfirm={(uri, label) => void handleResubmitConfirm(uri, label)}
            onCancel={() => setResubmitTarget(null)}
          />
        )}
      </section>
    </PlaybackProvider>
  );
}
