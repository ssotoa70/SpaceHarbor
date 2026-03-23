import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { PlaybackProvider } from "../contexts/PlaybackContext";
import { ReviewPlayer } from "./ReviewPlayer";
import type { ReviewCommentData } from "../api";

function renderPlayer(props: Partial<Parameters<typeof ReviewPlayer>[0]> = {}) {
  return render(
    <PlaybackProvider fps={24}>
      <ReviewPlayer src={props.src ?? null} title={props.title ?? ""} {...props} />
    </PlaybackProvider>,
  );
}

const sampleComments: ReviewCommentData[] = [
  {
    id: "c1",
    sessionId: "s1",
    submissionId: null,
    versionId: null,
    parentCommentId: null,
    authorId: "user1",
    authorRole: null,
    body: "Fix the edge here",
    frameNumber: 48,
    timecode: "00:00:02:00",
    annotationType: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "c2",
    sessionId: "s1",
    submissionId: null,
    versionId: null,
    parentCommentId: null,
    authorId: "user2",
    authorRole: null,
    body: "Looks good",
    frameNumber: 120,
    timecode: "00:00:05:00",
    annotationType: null,
    status: "resolved",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("ReviewPlayer", () => {
  it("renders empty state when no src", () => {
    renderPlayer();
    expect(screen.getByTestId("review-player-empty")).toBeInTheDocument();
    expect(screen.getByText("Select an asset to review")).toBeInTheDocument();
  });

  it("renders video element and transport controls with src", () => {
    renderPlayer({ src: "/test.mp4", title: "Test Shot" });
    expect(screen.getByTestId("review-player")).toBeInTheDocument();
    expect(screen.getByLabelText("Video: Test Shot")).toBeInTheDocument();
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous frame")).toBeInTheDocument();
    expect(screen.getByLabelText("Next frame")).toBeInTheDocument();
  });

  it("renders timecode display", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    // Initial timecode 00:00:00:00
    expect(screen.getAllByText(/00:00:00:00/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders JKL shuttle buttons", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    expect(screen.getByLabelText("Reverse shuttle (J)")).toBeInTheDocument();
    expect(screen.getByLabelText("Pause (K)")).toBeInTheDocument();
    expect(screen.getByLabelText("Forward shuttle (L)")).toBeInTheDocument();
  });

  it("renders comment markers on scrub bar", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot", comments: sampleComments });
    const openMarker = screen.getByLabelText(/Comment at frame 48/);
    expect(openMarker).toBeInTheDocument();
    const resolvedMarker = screen.getByLabelText(/Comment at frame 120/);
    expect(resolvedMarker).toBeInTheDocument();
  });

  it("renders scrub bar with slider role", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    expect(screen.getByRole("slider", { name: "Playback position" })).toBeInTheDocument();
  });

  it("renders annotate toggle button", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    const btn = screen.getByLabelText("Show annotations");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByTestId("annotation-canvas")).toBeInTheDocument();
  });

  it("annotation canvas has tool buttons when visible", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    fireEvent.click(screen.getByLabelText("Show annotations"));
    expect(screen.getByLabelText("Tool: Draw")).toBeInTheDocument();
    expect(screen.getByLabelText("Tool: Arrow")).toBeInTheDocument();
    expect(screen.getByLabelText("Tool: Rect")).toBeInTheDocument();
    expect(screen.getByLabelText("Tool: Circle")).toBeInTheDocument();
  });

  it("annotation canvas has undo and clear buttons", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    fireEvent.click(screen.getByLabelText("Show annotations"));
    expect(screen.getByLabelText("Undo annotation")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear frame annotations")).toBeInTheDocument();
  });

  it("renders frame counter", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    expect(screen.getByText("F0")).toBeInTheDocument();
  });

  it("keyboard Space fires togglePlay", () => {
    renderPlayer({ src: "/test.mp4", title: "Shot" });
    // Should not throw
    fireEvent.keyDown(window, { key: " " });
  });
});
