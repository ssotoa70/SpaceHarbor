import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../design-system";
import { usePlayback } from "../contexts/PlaybackContext";
import { formatTC } from "../utils/timecode";
import { AnnotationCanvas, type AnnotationCanvasHandle } from "./AnnotationCanvas";
import type { ReviewCommentData } from "../api";

/** Marker on the scrub bar representing a comment at a specific frame */
interface CommentMarker {
  frame: number;
  count: number;
  status: "open" | "resolved" | "archived";
}

function buildMarkers(comments: ReviewCommentData[]): CommentMarker[] {
  const map = new Map<number, { count: number; hasOpen: boolean }>();
  for (const c of comments) {
    if (c.frameNumber == null) continue;
    const entry = map.get(c.frameNumber) ?? { count: 0, hasOpen: false };
    entry.count++;
    if (c.status === "open") entry.hasOpen = true;
    map.set(c.frameNumber, entry);
  }
  return Array.from(map.entries()).map(([frame, { count, hasOpen }]) => ({
    frame,
    count,
    status: hasOpen ? ("open" as const) : ("resolved" as const),
  }));
}

const MARKER_COLORS = {
  open: "var(--color-ah-warning)",
  resolved: "var(--color-ah-success)",
  archived: "var(--color-ah-text-subtle)",
};

interface ReviewPlayerProps {
  src: string | null;
  title: string;
  comments?: ReviewCommentData[];
  onFrameChange?: (frame: number) => void;
}

export function ReviewPlayer({ src, title, comments = [], onFrameChange }: ReviewPlayerProps) {
  const {
    videoRef,
    currentFrame,
    currentTime,
    duration,
    playing,
    fps,
    totalFrames,
    togglePlay,
    stepFrame,
    seekToFrame,
    setPlaybackRate,
    playbackRate,
  } = usePlayback();

  const scrubRef = useRef<HTMLDivElement>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const annotationRef = useRef<AnnotationCanvasHandle>(null);
  const prevFrameRef = useRef(currentFrame);

  // Video dimensions for annotation canvas
  const [videoDims, setVideoDims] = useState({ width: 1920, height: 1080 });

  const markers = buildMarkers(comments);

  // Notify parent of frame changes
  useEffect(() => {
    if (currentFrame !== prevFrameRef.current) {
      prevFrameRef.current = currentFrame;
      onFrameChange?.(currentFrame);
    }
  }, [currentFrame, onFrameChange]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs/textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case ",":
          stepFrame(-1);
          break;
        case ".":
          stepFrame(1);
          break;
        case "j":
        case "J":
          // 4x reverse shuttle (emulated: step back rapidly since HTML5 doesn't support negative playback)
          setPlaybackRate(-4);
          break;
        case "k":
        case "K":
          // Pause
          setPlaybackRate(1);
          if (playing) togglePlay();
          break;
        case "l":
        case "L":
          // 4x forward shuttle
          setPlaybackRate(4);
          if (!playing) togglePlay();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepFrame, setPlaybackRate, playing]);

  // ── J shuttle emulation (reverse playback via frame stepping) ──
  useEffect(() => {
    if (playbackRate >= 0) return;
    const rate = Math.abs(playbackRate);
    const interval = setInterval(() => {
      stepFrame(-rate);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [playbackRate, stepFrame, fps]);

  // ── Scrub bar interaction ──
  const scrubToPosition = useCallback(
    (clientX: number) => {
      const bar = scrubRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekToFrame(Math.round(ratio * totalFrames));
    },
    [seekToFrame, totalFrames],
  );

  const handleScrubDown = useCallback(
    (e: React.MouseEvent) => {
      setScrubbing(true);
      scrubToPosition(e.clientX);
    },
    [scrubToPosition],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: MouseEvent) => scrubToPosition(e.clientX);
    const onUp = () => setScrubbing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scrubbing, scrubToPosition]);

  const progress = duration > 0 ? currentTime / duration : 0;

  // Update video dimensions when metadata loads
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      setVideoDims({ width: v.videoWidth || 1920, height: v.videoHeight || 1080 });
    }
  }, [videoRef]);

  if (!src) {
    return (
      <div
        className="aspect-video bg-black rounded-[var(--radius-ah-md)] flex items-center justify-center"
        data-testid="review-player-empty"
      >
        <span className="text-[var(--color-ah-text-subtle)]">Select an asset to review</span>
      </div>
    );
  }

  return (
    <div data-testid="review-player">
      {/* Video viewport with annotation overlay */}
      <div className="relative aspect-video bg-black rounded-[var(--radius-ah-md)] overflow-hidden">
        <video
          ref={videoRef as React.RefObject<HTMLVideoElement>}
          src={src}
          className="w-full h-full"
          onLoadedMetadata={handleLoadedMetadata}
          aria-label={`Video: ${title}`}
        />
        <AnnotationCanvas
          ref={annotationRef}
          width={videoDims.width}
          height={videoDims.height}
          currentFrame={currentFrame}
          visible={showAnnotations}
        />
      </div>

      {/* Scrub bar with comment markers */}
      <div
        ref={scrubRef}
        className="relative h-6 mt-1 cursor-pointer group"
        onMouseDown={handleScrubDown}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={totalFrames}
        aria-valuenow={currentFrame}
      >
        {/* Track background */}
        <div className="absolute top-2 left-0 right-0 h-1.5 bg-[var(--color-ah-bg-overlay)] rounded-full" />
        {/* Progress fill */}
        <div
          className="absolute top-2 left-0 h-1.5 bg-[var(--color-ah-accent)] rounded-full transition-[width] duration-75"
          style={{ width: `${progress * 100}%` }}
        />
        {/* Playhead */}
        <div
          className="absolute top-1 w-3 h-3 bg-[var(--color-ah-accent)] rounded-full -translate-x-1/2 shadow-md"
          style={{ left: `${progress * 100}%` }}
        />
        {/* Comment markers */}
        {markers.map((m) => (
            <button
              key={m.frame}
              className="absolute top-0 w-2 h-2 rounded-full -translate-x-1/2 hover:scale-150 transition-transform z-10"
              style={{
                left: totalFrames > 0 ? `${(m.frame / totalFrames) * 100}%` : "0%",
                backgroundColor: MARKER_COLORS[m.status],
              }}
              onClick={(e) => {
                e.stopPropagation();
                seekToFrame(m.frame);
              }}
              aria-label={`Comment at frame ${m.frame} (${m.count} ${m.count === 1 ? "comment" : "comments"}, ${m.status})`}
              title={`Frame ${m.frame}: ${m.count} comment${m.count === 1 ? "" : "s"}`}
            />
          ))}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-2 mt-1">
        <Button variant="secondary" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "\u23F8" : "\u25B6"}
        </Button>
        <Button variant="ghost" onClick={() => stepFrame(-1)} aria-label="Previous frame">
          ,
        </Button>
        <Button variant="ghost" onClick={() => stepFrame(1)} aria-label="Next frame">
          .
        </Button>

        {/* Shuttle indicator */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setPlaybackRate(-4); }}
            className={`text-xs px-1 rounded ${playbackRate === -4 ? "text-[var(--color-ah-accent)]" : "text-[var(--color-ah-text-muted)]"}`}
            aria-label="Reverse shuttle (J)"
          >
            J
          </button>
          <button
            onClick={() => { setPlaybackRate(1); if (playing) togglePlay(); }}
            className={`text-xs px-1 rounded ${!playing ? "text-[var(--color-ah-accent)]" : "text-[var(--color-ah-text-muted)]"}`}
            aria-label="Pause (K)"
          >
            K
          </button>
          <button
            onClick={() => { setPlaybackRate(4); if (!playing) togglePlay(); }}
            className={`text-xs px-1 rounded ${playbackRate === 4 && playing ? "text-[var(--color-ah-accent)]" : "text-[var(--color-ah-text-muted)]"}`}
            aria-label="Forward shuttle (L)"
          >
            L
          </button>
        </div>

        {/* Timecode display */}
        <span className="text-xs font-mono text-[var(--color-ah-text-muted)] ml-auto">
          {formatTC(currentTime, fps)} / {formatTC(duration, fps)}
        </span>
        <span className="text-xs font-mono text-[var(--color-ah-text-subtle)]">
          F{currentFrame}
        </span>

        {/* Annotation toggle */}
        <Button
          variant={showAnnotations ? "primary" : "ghost"}
          onClick={() => setShowAnnotations(!showAnnotations)}
          aria-label={showAnnotations ? "Hide annotations" : "Show annotations"}
          aria-pressed={showAnnotations}
        >
          Annotate
        </Button>
      </div>
    </div>
  );
}
