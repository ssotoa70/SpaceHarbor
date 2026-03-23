import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button } from "../design-system";
import { usePlayback } from "../contexts/PlaybackContext";
import { formatTC } from "../utils/timecode";
import type { ReviewCommentData } from "../api";

/* ── Emoji reactions ── */

const PRESET_EMOJIS = ["\uD83D\uDC4D", "\uD83D\uDC4E", "\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDCA1", "\u2705"];

interface EmojiReaction {
  emoji: string;
  count: number;
  active: boolean;
}

/* ── Attachment display ── */

interface CommentAttachment {
  type: "image" | "file";
  url: string;
  filename: string;
  thumbnailUrl?: string;
}

/* ── Props ── */

interface TimecodedCommentTrackProps {
  comments: ReviewCommentData[];
  sessionId: string;
  onAddComment?: (body: string, frameNumber: number, timecode: string, parentCommentId?: string) => void;
  onResolve?: (commentId: string) => void;
  /** Attachments keyed by comment ID */
  attachments?: Record<string, CommentAttachment[]>;
}

/** Group comments into threads (parent + replies) */
function buildThreads(comments: ReviewCommentData[]) {
  const roots: ReviewCommentData[] = [];
  const repliesByParent = new Map<string, ReviewCommentData[]>();

  for (const c of comments) {
    if (c.parentCommentId) {
      const list = repliesByParent.get(c.parentCommentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentCommentId, list);
    } else {
      roots.push(c);
    }
  }

  // Sort roots by frame number, then by creation time
  roots.sort((a, b) => {
    const fa = a.frameNumber ?? -1;
    const fb = b.frameNumber ?? -1;
    if (fa !== fb) return fa - fb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return { roots, repliesByParent };
}

/* ── Comment Row ── */

function CommentRow({
  comment,
  isReply,
  isNearestFrame,
  onSeek,
  onResolve,
  onReply,
  attachments,
  fps,
}: {
  comment: ReviewCommentData;
  isReply: boolean;
  isNearestFrame: boolean;
  onSeek: (frame: number) => void;
  onResolve?: (id: string) => void;
  onReply: (parentId: string) => void;
  attachments?: CommentAttachment[];
  fps: number;
}) {
  const [reactions, setReactions] = useState<EmojiReaction[]>(
    PRESET_EMOJIS.map((e) => ({ emoji: e, count: 0, active: false })),
  );

  const toggleReaction = useCallback((emoji: string) => {
    setReactions((prev) =>
      prev.map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.active ? r.count - 1 : r.count + 1, active: !r.active }
          : r,
      ),
    );
  }, []);

  const timecodeDisplay = comment.timecode ?? (comment.frameNumber != null ? formatTC(comment.frameNumber / fps, fps) : null);

  return (
    <div
      className={`p-2 rounded-[var(--radius-ah-sm)] transition-colors ${
        isNearestFrame
          ? "bg-[var(--color-ah-accent)]/10 border border-[var(--color-ah-accent)]/30"
          : "hover:bg-[var(--color-ah-bg-overlay)]"
      } ${isReply ? "ml-6 border-l-2 border-[var(--color-ah-border-muted)] pl-3" : ""}`}
      data-comment-id={comment.id}
      data-frame={comment.frameNumber}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        {/* Frame badge — clickable to seek */}
        {timecodeDisplay && (
          <button
            onClick={() => comment.frameNumber != null && onSeek(comment.frameNumber)}
            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-ah-bg-raised)] text-[var(--color-ah-accent)] hover:bg-[var(--color-ah-accent)]/20 transition-colors"
            aria-label={`Seek to frame ${comment.frameNumber}`}
          >
            {timecodeDisplay}
          </button>
        )}
        <span className="text-xs font-medium text-[var(--color-ah-text)]">
          {comment.authorId}
        </span>
        {comment.authorRole && (
          <Badge variant="default">{comment.authorRole}</Badge>
        )}
        {comment.status === "resolved" && (
          <Badge variant="success">Resolved</Badge>
        )}
        <span className="text-[10px] text-[var(--color-ah-text-subtle)] ml-auto">
          {new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Body */}
      <p className="text-sm text-[var(--color-ah-text-muted)] whitespace-pre-wrap">{comment.body}</p>

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <a
              key={i}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--color-ah-accent)] hover:underline"
            >
              {att.type === "image" && att.thumbnailUrl ? (
                <img src={att.thumbnailUrl} alt={att.filename} className="w-12 h-12 rounded object-cover" />
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
                    <path d="M3 1h4l3 3v7H3V1z" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  {att.filename}
                </>
              )}
            </a>
          ))}
        </div>
      )}

      {/* Emoji reactions */}
      <div className="flex items-center gap-1 mt-1.5">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            onClick={() => toggleReaction(r.emoji)}
            className={`text-xs px-1 py-0.5 rounded transition-colors ${
              r.active
                ? "bg-[var(--color-ah-accent)]/20"
                : "hover:bg-[var(--color-ah-bg-overlay)]"
            }`}
            aria-label={`React with ${r.emoji}`}
            aria-pressed={r.active}
          >
            {r.emoji}{r.count > 0 && <span className="ml-0.5 text-[10px]">{r.count}</span>}
          </button>
        ))}

        <span className="flex-1" />

        {/* Actions */}
        {!isReply && (
          <button
            onClick={() => onReply(comment.id)}
            className="text-[10px] text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text)]"
          >
            Reply
          </button>
        )}
        {comment.status === "open" && onResolve && (
          <button
            onClick={() => onResolve(comment.id)}
            className="text-[10px] text-[var(--color-ah-success)] hover:underline"
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ── */

export function TimecodedCommentTrack({
  comments,
  sessionId,
  onAddComment,
  onResolve,
  attachments = {},
}: TimecodedCommentTrackProps) {
  const { currentFrame, seekToFrame, fps } = usePlayback();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");

  const { roots, repliesByParent } = useMemo(() => buildThreads(comments), [comments]);

  // Find nearest comment to current frame
  const nearestFrame = useMemo(() => {
    if (roots.length === 0) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const c of roots) {
      if (c.frameNumber == null) continue;
      const dist = Math.abs(c.frameNumber - currentFrame);
      if (dist < bestDist) {
        bestDist = dist;
        best = c.frameNumber;
      }
    }
    return best;
  }, [roots, currentFrame]);

  // Auto-scroll to nearest comment
  useEffect(() => {
    if (nearestFrame == null || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-frame="${nearestFrame}"]`);
    if (el) {
      el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }, [nearestFrame]);

  // Global 'C' shortcut to focus comment input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleThread = useCallback((parentId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!draftBody.trim() || !onAddComment) return;
    const tc = formatTC(currentFrame / fps, fps);
    onAddComment(draftBody.trim(), currentFrame, tc, replyingTo ?? undefined);
    setDraftBody("");
    setReplyingTo(null);
  }, [draftBody, currentFrame, fps, onAddComment, replyingTo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex flex-col h-full" data-testid="timecoded-comment-track">
      {/* Comment list */}
      <div ref={scrollRef} className="flex-1 overflow-auto space-y-1 p-2">
        {roots.length === 0 ? (
          <p className="text-xs text-[var(--color-ah-text-subtle)] text-center py-4">
            No comments yet. Press <kbd className="px-1 py-0.5 rounded bg-[var(--color-ah-bg-raised)] text-[10px]">C</kbd> to add one.
          </p>
        ) : (
          roots.map((root) => {
            const replies = repliesByParent.get(root.id) ?? [];
            const isExpanded = expandedThreads.has(root.id);
            const replyCount = replies.length;

            return (
              <div key={root.id}>
                <CommentRow
                  comment={root}
                  isReply={false}
                  isNearestFrame={root.frameNumber === nearestFrame}
                  onSeek={seekToFrame}
                  onResolve={onResolve}
                  onReply={(id) => {
                    setReplyingTo(id);
                    inputRef.current?.focus();
                  }}
                  attachments={attachments[root.id]}
                  fps={fps}
                />

                {/* Thread expand/collapse */}
                {replyCount > 0 && (
                  <button
                    onClick={() => toggleThread(root.id)}
                    className="ml-6 text-[10px] text-[var(--color-ah-accent)] hover:underline mt-0.5"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Hide" : "Show"} {replyCount} {replyCount === 1 ? "reply" : "replies"}
                  </button>
                )}

                {/* Replies */}
                {isExpanded &&
                  replies.map((reply) => (
                    <CommentRow
                      key={reply.id}
                      comment={reply}
                      isReply={true}
                      isNearestFrame={false}
                      onSeek={seekToFrame}
                      onResolve={onResolve}
                      onReply={(id) => {
                        setReplyingTo(root.id); // reply to root, not nested
                        inputRef.current?.focus();
                      }}
                      attachments={attachments[reply.id]}
                      fps={fps}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {/* Pinned "Add comment" input */}
      <div className="border-t border-[var(--color-ah-border-muted)] p-2">
        {replyingTo && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-[var(--color-ah-text-subtle)]">
              Replying to comment
            </span>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-[10px] text-[var(--color-ah-danger)] hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-start gap-2">
          {/* Frame badge */}
          <span className="font-mono text-[10px] px-1.5 py-1 rounded bg-[var(--color-ah-bg-raised)] text-[var(--color-ah-accent)] shrink-0 mt-1">
            F{currentFrame}
          </span>
          <textarea
            ref={inputRef}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment at this frame..."
            className="flex-1 bg-[var(--color-ah-bg-overlay)] text-sm text-[var(--color-ah-text)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] px-2 py-1.5 resize-none min-h-[2.5rem] focus:outline-none focus:border-[var(--color-ah-accent)]"
            rows={2}
            aria-label="Add comment at current frame"
          />
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!draftBody.trim()}
            aria-label="Submit comment"
          >
            Send
          </Button>
        </div>
        <p className="text-[10px] text-[var(--color-ah-text-subtle)] mt-0.5 ml-10">
          Ctrl+Enter to submit
        </p>
      </div>
    </div>
  );
}
