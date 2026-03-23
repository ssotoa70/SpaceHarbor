import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ReviewPage } from "./ReviewPage";

vi.mock("../api", () => ({
  fetchApprovalQueue: vi.fn().mockResolvedValue({
    assets: [
      { id: "a1", title: "shot_010_v003.exr", status: "qc_pending", sourceUri: "/review/shot010.mov", jobId: "j1" },
      { id: "a2", title: "shot_020_v001.exr", status: "qc_pending", sourceUri: "/review/shot020.mov", jobId: "j2" },
    ],
    total: 2,
  }),
  approveAsset: vi.fn().mockResolvedValue(undefined),
  rejectAsset: vi.fn().mockResolvedValue(undefined),
  fetchRejectedFeedback: vi.fn().mockResolvedValue([]),
  resubmitVersion: vi.fn().mockResolvedValue(undefined),
  fetchFrameComments: vi.fn().mockResolvedValue([]),
  createFrameComment: vi.fn().mockResolvedValue({ id: "c1", body: "test", status: "open", authorId: "user", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sessionId: null, submissionId: null, versionId: null, parentCommentId: null, authorRole: null, frameNumber: 0, timecode: "00:00:00:00", annotationType: null }),
  resolveFrameComment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../components/ReviewPlayer", () => ({
  ReviewPlayer: ({ src, title }: { src: string | null; title: string }) => (
    <div data-testid="review-player">
      {src ? <video src={src} aria-label={`Video: ${title}`} /> : <span>Select an asset to review</span>}
    </div>
  ),
}));

vi.mock("../components/TimecodedCommentTrack", () => ({
  TimecodedCommentTrack: () => <div data-testid="timecoded-comment-track">Comments</div>,
}));

vi.mock("../contexts/PlaybackContext", () => ({
  PlaybackProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  usePlayback: () => ({
    currentFrame: 0, currentTime: 0, duration: 0, fps: 24, playing: false,
    playbackRate: 1, totalFrames: 0, videoRef: { current: null },
    seekToFrame: vi.fn(), play: vi.fn(), pause: vi.fn(), togglePlay: vi.fn(),
    stepFrame: vi.fn(), setPlaybackRate: vi.fn(),
  }),
}));

describe("ReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three-panel layout with queue sidebar", () => {
    render(<ReviewPage />);
    // Queue tab should be visible
    expect(screen.getByText("Queue")).toBeInTheDocument();
  });

  it("renders My Feedback tab", () => {
    render(<ReviewPage />);
    expect(screen.getByText("My Feedback")).toBeInTheDocument();
  });

  it("renders review player placeholder when no asset selected", () => {
    render(<ReviewPage />);
    expect(screen.getAllByText("Select an asset to review").length).toBeGreaterThanOrEqual(1);
  });

  it("renders queue items after loading", async () => {
    render(<ReviewPage />);
    expect((await screen.findAllByText("shot_010_v003.exr")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("shot_020_v001.exr").length).toBeGreaterThanOrEqual(1);
  });

  it("selects asset and shows metadata panel", async () => {
    render(<ReviewPage />);
    const items = await screen.findAllByText("shot_010_v003.exr");
    fireEvent.click(items[0]);
    // Metadata panel should show the asset title
    const titles = screen.getAllByText("shot_010_v003.exr");
    expect(titles.length).toBeGreaterThanOrEqual(2); // sidebar + metadata panel header
  });

  it("renders approve, hold, and reject buttons per item", async () => {
    render(<ReviewPage />);
    await screen.findAllByText("shot_010_v003.exr");
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: "Reject" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: "Hold" }).length).toBeGreaterThanOrEqual(2);
  });

  it("shows no asset selected message in right panel initially", () => {
    render(<ReviewPage />);
    expect(screen.getByText("No asset selected")).toBeInTheDocument();
  });

  it("shows comment placeholder when no asset selected", () => {
    render(<ReviewPage />);
    expect(screen.getByText("Select an asset to view comments")).toBeInTheDocument();
  });

  it("switches to My Feedback tab and shows empty state", async () => {
    render(<ReviewPage />);
    fireEvent.click(screen.getByText("My Feedback"));
    expect(await screen.findByText("No rejected versions.")).toBeInTheDocument();
  });

  it("shows rejected versions in My Feedback tab with rejection reason", async () => {
    const { fetchRejectedFeedback } = await import("../api");
    (fetchRejectedFeedback as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "r1",
        title: "shot_030_v001.exr",
        sourceUri: "/var/204/vfx/shot_030/shot_030.exr",
        status: "qc_rejected",
        jobId: "j3",
        rejectionReason: "Motion blur artifacts on frames 45-60",
        rejectedBy: "supervisor",
        rejectedAt: "2026-03-13T10:00:00Z",
        comments: [
          { id: "c1", body: "Fix blur on left edge", frameNumber: 45, timecode: "00:00:01:21", authorId: "supervisor", status: "open", createdAt: "2026-03-13T10:00:00Z" },
        ],
      },
    ]);
    render(<ReviewPage />);
    fireEvent.click(screen.getByText("My Feedback"));
    expect(await screen.findByText("shot_030_v001.exr")).toBeInTheDocument();
    expect(screen.getByText(/Motion blur artifacts/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resubmit" }).length).toBeGreaterThanOrEqual(1);
  });

  it("opens resubmit dialog when clicking Resubmit", async () => {
    const { fetchRejectedFeedback } = await import("../api");
    (fetchRejectedFeedback as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "r1",
        title: "shot_030_v001.exr",
        sourceUri: "/var/204/vfx/shot_030/shot_030.exr",
        status: "qc_rejected",
        jobId: "j3",
        version: { version_label: "v1" },
        rejectionReason: "Needs fix",
        rejectedBy: "supervisor",
        rejectedAt: "2026-03-13T10:00:00Z",
        comments: [],
      },
    ]);
    render(<ReviewPage />);
    fireEvent.click(screen.getByText("My Feedback"));
    const resubmitBtn = await screen.findByRole("button", { name: "Resubmit" });
    fireEvent.click(resubmitBtn);
    expect(await screen.findByText("Resubmit Version")).toBeInTheDocument();
  });

  it("renders AssetMetadataPanel with File Info section when asset selected", async () => {
    render(<ReviewPage />);
    const items = await screen.findAllByText("shot_010_v003.exr");
    fireEvent.click(items[0]);
    expect(screen.getByTestId("asset-metadata-panel")).toBeInTheDocument();
    expect(screen.getByText("File Info")).toBeInTheDocument();
    expect(screen.getByText("Production Info")).toBeInTheDocument();
    expect(screen.getByText("Pipeline Info")).toBeInTheDocument();
  });
});
