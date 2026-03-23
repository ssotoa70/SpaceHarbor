import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchTimelines, type TimelineClipData, type TimelineData, type TimelineTrackData } from "../api";
import { Badge, Button, Card } from "../design-system";
import { CloseIcon } from "../components/CloseIcon";
import { extractVastPath } from "../utils/media-types";
import { formatTC } from "../utils/timecode";

const conformColors: Record<string, string> = {
  matched: "var(--color-ah-success)",
  unmatched: "var(--color-ah-warning)",
  conflict: "var(--color-ah-danger)",
};

const conformBadge: Record<string, "success" | "warning" | "danger"> = {
  matched: "success",
  unmatched: "warning",
  conflict: "danger",
};

interface ClipPopoverProps {
  clip: TimelineClipData;
  onClose: () => void;
}

function ClipPopover({ clip, onClose }: ClipPopoverProps) {
  const vastPath = clip.sourceUri ? extractVastPath(clip.sourceUri) : null;
  return (
    <div
      className="absolute z-10 top-full mt-1 left-0 w-72 p-3 rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg-raised)] shadow-lg text-sm"
      role="dialog"
      aria-label={`Clip: ${clip.name}`}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold">{clip.name}</span>
        <button onClick={onClose} className="text-[var(--color-ah-text-subtle)] hover:text-[var(--color-ah-text)] cursor-pointer" aria-label="Close"><CloseIcon /></button>
      </div>
      <dl className="grid grid-cols-2 gap-1">
        <dt className="text-[var(--color-ah-text-muted)]">Source</dt>
        <dd className="truncate">{clip.source}</dd>
        {vastPath && (
          <>
            <dt className="text-[var(--color-ah-text-muted)]">VAST Path</dt>
            <dd className="truncate font-[var(--font-ah-mono)] text-[10px] text-[var(--color-ah-accent)]">{vastPath}</dd>
          </>
        )}
        <dt className="text-[var(--color-ah-text-muted)]">Frames</dt>
        <dd>{clip.startFrame} - {clip.endFrame}</dd>
        <dt className="text-[var(--color-ah-text-muted)]">Status</dt>
        <dd><Badge variant={conformBadge[clip.conformStatus]}>{clip.conformStatus}</Badge></dd>
        {clip.matchedShotId && (
          <>
            <dt className="text-[var(--color-ah-text-muted)]">Shot</dt>
            <dd>{clip.matchedShotId}</dd>
          </>
        )}
        {clip.versionId && (
          <>
            <dt className="text-[var(--color-ah-text-muted)]">Version</dt>
            <dd>{clip.versionId}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function TimelinePage() {
  const [timelines, setTimelines] = useState<TimelineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedClip, setSelectedClip] = useState<TimelineClipData | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    void fetchTimelines().then((data) => {
      setTimelines(data);
      setSelectedTimelineId(data[0]?.id ?? null);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const timeline = timelines.find(t => t.id === selectedTimelineId) ?? timelines[0] ?? null;
  const pixelsPerFrame = useMemo(() => zoom * 3, [zoom]);
  const totalWidth = (timeline?.totalFrames ?? 0) * pixelsPerFrame;
  const fps = 24;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, Math.min(4, z + (e.deltaY > 0 ? -0.1 : 0.1))));
    }
  }, []);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlayhead(Math.round(x / pixelsPerFrame));
  }, [pixelsPerFrame]);

  if (loading) {
    return (
      <section aria-label="Timeline visualization">
        <div className="h-8 w-48 rounded bg-[var(--color-ah-bg-overlay)] animate-pulse mb-4" />
        <div className="h-[300px] rounded-[var(--radius-ah-lg)] bg-[var(--color-ah-bg-overlay)] animate-pulse" />
      </section>
    );
  }

  if (!timeline) {
    return (
      <section aria-label="Timeline visualization">
        <h1 className="text-xl font-bold mb-4">Timelines</h1>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-4 opacity-40">&#9776;</div>
          <h2 className="text-lg font-semibold text-[var(--color-ah-text)] mb-2">No timelines</h2>
          <p className="text-sm text-[var(--color-ah-text-muted)] max-w-md">
            OTIO timelines will appear here after editorial ingest.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Timeline visualization">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{timeline.name}</h1>
          {timelines.length > 1 && (
            <select
              value={selectedTimelineId ?? ""}
              onChange={(e) => setSelectedTimelineId(e.target.value)}
              className="rounded-[var(--radius-ah-md)] border border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] px-2 py-1 text-sm"
            >
              {timelines.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-ah-text-muted)]">Zoom: {(zoom * 100).toFixed(0)}%</span>
          <Button variant="ghost" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>-</Button>
          <Button variant="ghost" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>+</Button>
          <div className="flex gap-2 text-xs">
            {Object.entries(conformColors).map(([key, color]) => (
              <span key={key} className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                {key}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Minimap */}
      <Card className="mb-3 p-2">
        <div className="relative h-6 bg-[var(--color-ah-bg)] rounded-[var(--radius-ah-sm)] overflow-hidden">
          {timeline.tracks.flatMap((track) =>
            track.clips.map((clip) => {
              const left = ((clip.startFrame - 1001) / timeline.totalFrames) * 100;
              const width = ((clip.endFrame - clip.startFrame) / timeline.totalFrames) * 100;
              return (
                <div
                  key={clip.id}
                  className="absolute h-full opacity-60"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: conformColors[clip.conformStatus] }}
                />
              );
            })
          )}
        </div>
      </Card>

      {/* Track lanes */}
      <Card className="overflow-x-auto p-0" onWheel={handleWheel} ref={containerRef}>
        {/* Frame ruler with SMPTE timecode */}
        <div
          className="relative h-6 border-b border-[var(--color-ah-border)] bg-[var(--color-ah-bg)] cursor-pointer select-none"
          style={{ width: `${totalWidth}px` }}
          onClick={handleRulerClick}
          aria-label="Frame ruler"
        >
          {Array.from({ length: Math.ceil(timeline.totalFrames / fps) + 1 }).map((_, i) => {
            const frameNum = 1001 + i * fps;
            const tc = formatTC(frameNum / fps, fps);
            return (
              <span
                key={i}
                className="absolute top-0 text-[10px] text-[var(--color-ah-text-subtle)] border-l border-[var(--color-ah-border-muted)]"
                style={{ left: `${i * fps * pixelsPerFrame}px`, paddingLeft: 2 }}
              >
                {tc}
              </span>
            );
          })}
          <div
            className="absolute top-0 bottom-0 w-px bg-[var(--color-ah-danger)]"
            style={{ left: `${playhead * pixelsPerFrame}px` }}
            aria-label={`Playhead at frame ${1001 + playhead}`}
          />
        </div>

        {timeline.tracks.map((track) => (
          <div key={track.name} className="relative flex items-center border-b border-[var(--color-ah-border-muted)]" style={{ height: "48px", width: `${totalWidth}px` }}>
            <span className="absolute left-2 text-xs font-semibold text-[var(--color-ah-text-muted)] z-10">{track.name}</span>
            {track.clips.map((clip) => {
              const left = (clip.startFrame - 1001) * pixelsPerFrame;
              const width = (clip.endFrame - clip.startFrame) * pixelsPerFrame;
              return (
                <div
                  key={clip.id}
                  className="absolute top-1 bottom-1 rounded-[var(--radius-ah-sm)] flex items-center px-2 text-xs font-medium text-white cursor-pointer hover:opacity-90 select-none"
                  style={{ left: `${left}px`, width: `${width}px`, backgroundColor: conformColors[clip.conformStatus] }}
                  onClick={() => setSelectedClip(selectedClip?.id === clip.id ? null : clip)}
                >
                  <span className="truncate">{clip.name}</span>
                  {selectedClip?.id === clip.id && <ClipPopover clip={clip} onClose={() => setSelectedClip(null)} />}
                </div>
              );
            })}
            {/* Playhead line */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--color-ah-danger)] pointer-events-none"
              style={{ left: `${playhead * pixelsPerFrame}px` }}
            />
          </div>
        ))}
      </Card>
    </section>
  );
}
