import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { PlaybackProvider } from "../contexts/PlaybackContext";
import { TimecodedCommentTrack } from "./TimecodedCommentTrack";
import type { ReviewCommentData } from "../api";

const baseComment: ReviewCommentData = {
  id: "c1",
  sessionId: "s1",
  submissionId: null,
  versionId: null,
  parentCommentId: null,
  authorId: "artist01",
  authorRole: "artist",
  body: "Edge bleed on left side",
  frameNumber: 48,
  timecode: "00:00:02:00",
  annotationType: null,
  status: "open",
  createdAt: "2026-01-01T10:00:00Z",
  updatedAt: "2026-01-01T10:00:00Z",
};

const replyComment: ReviewCommentData = {
  ...baseComment,
  id: "c2",
  parentCommentId: "c1",
  authorId: "supervisor",
  authorRole: "supervisor",
  body: "Agreed, fix the matte",
  createdAt: "2026-01-01T10:05:00Z",
  updatedAt: "2026-01-01T10:05:00Z",
};

const resolvedComment: ReviewCommentData = {
  ...baseComment,
  id: "c3",
  frameNumber: 120,
  timecode: "00:00:05:00",
  body: "Color looks good here",
  status: "resolved",
  parentCommentId: null,
};

function renderTrack(props: Partial<Parameters<typeof TimecodedCommentTrack>[0]> = {}) {
  return render(
    <PlaybackProvider fps={24}>
      <TimecodedCommentTrack
        comments={props.comments ?? [baseComment]}
        sessionId={props.sessionId ?? "s1"}
        {...props}
      />
    </PlaybackProvider>,
  );
}

describe("TimecodedCommentTrack", () => {
  it("renders empty state when no comments", () => {
    renderTrack({ comments: [] });
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it("renders comment with author and body", () => {
    renderTrack();
    expect(screen.getByText("artist01")).toBeInTheDocument();
    expect(screen.getByText("Edge bleed on left side")).toBeInTheDocument();
  });

  it("renders timecode badge on comment", () => {
    renderTrack();
    expect(screen.getByText("00:00:02:00")).toBeInTheDocument();
  });

  it("renders author role badge", () => {
    renderTrack();
    expect(screen.getByText("artist")).toBeInTheDocument();
  });

  it("renders resolved badge for resolved comments", () => {
    renderTrack({ comments: [resolvedComment] });
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("renders reply threading with expand/collapse", () => {
    renderTrack({ comments: [baseComment, replyComment] });
    // Reply is hidden by default
    expect(screen.queryByText("Agreed, fix the matte")).not.toBeInTheDocument();
    // Click to expand
    const expandBtn = screen.getByText("Show 1 reply");
    fireEvent.click(expandBtn);
    expect(screen.getByText("Agreed, fix the matte")).toBeInTheDocument();
    // Collapse
    fireEvent.click(screen.getByText("Hide 1 reply"));
    expect(screen.queryByText("Agreed, fix the matte")).not.toBeInTheDocument();
  });

  it("renders emoji reaction buttons", () => {
    renderTrack();
    for (const emoji of ["\uD83D\uDC4D", "\uD83D\uDC4E", "\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDCA1", "\u2705"]) {
      expect(screen.getByLabelText(`React with ${emoji}`)).toBeInTheDocument();
    }
  });

  it("toggles emoji reaction on click", () => {
    renderTrack();
    const btn = screen.getByLabelText("React with \uD83D\uDC4D");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.textContent).toContain("1");
  });

  it("renders file attachment link", () => {
    renderTrack({
      attachments: {
        c1: [{ type: "file", url: "/files/ref.pdf", filename: "ref.pdf" }],
      },
    });
    expect(screen.getByText("ref.pdf")).toBeInTheDocument();
  });

  it("renders image attachment thumbnail", () => {
    renderTrack({
      attachments: {
        c1: [{ type: "image", url: "/img/ref.png", filename: "ref.png", thumbnailUrl: "/img/ref-thumb.png" }],
      },
    });
    expect(screen.getByAltText("ref.png")).toBeInTheDocument();
  });

  it("renders comment input with frame badge", () => {
    renderTrack();
    expect(screen.getByLabelText("Add comment at current frame")).toBeInTheDocument();
    expect(screen.getByText("F0")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Enter to submit")).toBeInTheDocument();
  });

  it("calls onAddComment when submit button clicked", () => {
    const onAdd = vi.fn();
    renderTrack({ onAddComment: onAdd });
    const input = screen.getByLabelText("Add comment at current frame");
    fireEvent.change(input, { target: { value: "New note" } });
    fireEvent.click(screen.getByLabelText("Submit comment"));
    expect(onAdd).toHaveBeenCalledWith("New note", 0, "00:00:00:00", undefined);
  });

  it("calls onResolve when resolve button clicked", () => {
    const onResolve = vi.fn();
    renderTrack({ onResolve });
    fireEvent.click(screen.getByText("Resolve"));
    expect(onResolve).toHaveBeenCalledWith("c1");
  });

  it("renders Reply button on root comments", () => {
    renderTrack();
    expect(screen.getByText("Reply")).toBeInTheDocument();
  });

  it("shows replying indicator when Reply clicked", () => {
    renderTrack();
    fireEvent.click(screen.getByText("Reply"));
    expect(screen.getByText("Replying to comment")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});
