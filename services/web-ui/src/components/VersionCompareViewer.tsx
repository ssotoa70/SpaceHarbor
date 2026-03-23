import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../design-system";

export type CompareMode = "flip" | "wipe" | "overlay";

interface VersionSlot {
  id: string;
  label: string;
  src: string;
}

interface VersionCompareViewerProps {
  /** Available versions to pick from */
  versions: VersionSlot[];
  /** Initial version A id */
  initialA?: string;
  /** Initial version B id */
  initialB?: string;
}

export function VersionCompareViewer({
  versions,
  initialA,
  initialB,
}: VersionCompareViewerProps) {
  const [mode, setMode] = useState<CompareMode>("flip");
  const [slotA, setSlotA] = useState<string>(initialA ?? versions[0]?.id ?? "");
  const [slotB, setSlotB] = useState<string>(initialB ?? versions[1]?.id ?? versions[0]?.id ?? "");
  const [activeFlip, setActiveFlip] = useState<"A" | "B">("A");
  const [wipePosition, setWipePosition] = useState(50); // percentage
  const [overlayOpacity, setOverlayOpacity] = useState(50); // percentage
  const [dragging, setDragging] = useState(false);

  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const versionA = versions.find((v) => v.id === slotA);
  const versionB = versions.find((v) => v.id === slotB);

  // Synchronize video playback
  const syncVideos = useCallback(() => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a || !b) return;
    // Sync B to A's time
    if (Math.abs(a.currentTime - b.currentTime) > 0.05) {
      b.currentTime = a.currentTime;
    }
  }, []);

  useEffect(() => {
    const a = videoARef.current;
    if (!a) return;
    a.addEventListener("timeupdate", syncVideos);
    return () => a.removeEventListener("timeupdate", syncVideos);
  }, [syncVideos]);

  // Play/pause both videos together
  const togglePlay = useCallback(() => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a || !b) return;
    if (a.paused) {
      void a.play();
      void b.play();
    } else {
      a.pause();
      b.pause();
    }
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (mode === "flip") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setActiveFlip("A");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setActiveFlip("B");
        } else if (e.key === " ") {
          e.preventDefault();
          setActiveFlip((prev) => (prev === "A" ? "B" : "A"));
        }
      } else if (mode === "wipe") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setWipePosition((p) => Math.max(0, p - 2));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setWipePosition((p) => Math.min(100, p + 2));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // ── Wipe dragging ──
  const handleWipeDrag = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      setWipePosition(pct);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => handleWipeDrag(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, handleWipeDrag]);

  return (
    <div data-testid="version-compare-viewer">
      {/* Mode selector */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-[var(--color-ah-text-muted)]">Compare:</span>
        {(["flip", "wipe", "overlay"] as CompareMode[]).map((m) => (
          <Button
            key={m}
            variant={mode === m ? "primary" : "ghost"}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            aria-label={`Compare mode: ${m}`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
        <span className="flex-1" />
        {/* Version selectors */}
        <label className="text-xs text-[var(--color-ah-text-muted)]">
          A:
          <select
            value={slotA}
            onChange={(e) => setSlotA(e.target.value)}
            className="ml-1 bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-xs px-1 py-0.5"
            aria-label="Version A selector"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-ah-text-muted)]">
          B:
          <select
            value={slotB}
            onChange={(e) => setSlotB(e.target.value)}
            className="ml-1 bg-[var(--color-ah-bg-overlay)] text-[var(--color-ah-text)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-xs px-1 py-0.5"
            aria-label="Version B selector"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Viewport */}
      <div
        ref={containerRef}
        className="relative aspect-video bg-black rounded-[var(--radius-ah-md)] overflow-hidden cursor-pointer"
        onClick={togglePlay}
      >
        {/* ── Flip mode ── */}
        {mode === "flip" && (
          <>
            <video
              ref={videoARef}
              src={versionA?.src}
              className={`absolute inset-0 w-full h-full ${activeFlip === "A" ? "block" : "hidden"}`}
              aria-label={`Version A: ${versionA?.label ?? ""}`}
            />
            <video
              ref={videoBRef}
              src={versionB?.src}
              className={`absolute inset-0 w-full h-full ${activeFlip === "B" ? "block" : "hidden"}`}
              aria-label={`Version B: ${versionB?.label ?? ""}`}
            />
            {/* Active version badge */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 rounded-full text-xs font-mono text-[var(--color-ah-accent)]" data-testid="flip-badge">
              {activeFlip === "A" ? versionA?.label : versionB?.label} ({activeFlip})
            </div>
          </>
        )}

        {/* ── Wipe mode ── */}
        {mode === "wipe" && (
          <>
            <video
              ref={videoBRef}
              src={versionB?.src}
              className="absolute inset-0 w-full h-full"
              aria-label={`Version B: ${versionB?.label ?? ""}`}
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - wipePosition}% 0 0)` }}
            >
              <video
                ref={videoARef}
                src={versionA?.src}
                className="absolute inset-0 w-full h-full"
                aria-label={`Version A: ${versionA?.label ?? ""}`}
              />
            </div>
            {/* Split handle */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-col-resize z-10"
              style={{ left: `${wipePosition}%` }}
              onMouseDown={(e) => { e.stopPropagation(); setDragging(true); }}
              role="separator"
              aria-label="Wipe split handle"
              aria-valuenow={Math.round(wipePosition)}
              data-testid="wipe-handle"
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2L2 6l2 4M8 2l2 4-2 4" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            {/* Labels */}
            <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/70 rounded text-[10px] font-mono text-[var(--color-ah-accent)]">
              A: {versionA?.label}
            </div>
            <div className="absolute top-3 right-3 px-2 py-0.5 bg-black/70 rounded text-[10px] font-mono text-[var(--color-ah-purple)]">
              B: {versionB?.label}
            </div>
          </>
        )}

        {/* ── Overlay mode ── */}
        {mode === "overlay" && (
          <>
            <video
              ref={videoARef}
              src={versionA?.src}
              className="absolute inset-0 w-full h-full"
              aria-label={`Version A: ${versionA?.label ?? ""}`}
            />
            <video
              ref={videoBRef}
              src={versionB?.src}
              className="absolute inset-0 w-full h-full"
              style={{
                mixBlendMode: "difference",
                opacity: overlayOpacity / 100,
              }}
              aria-label={`Version B: ${versionB?.label ?? ""}`}
            />
            {/* Opacity slider */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 rounded-full px-3 py-1">
              <span className="text-[10px] text-white/60">Opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className="w-24 accent-[var(--color-ah-accent)]"
                aria-label="Overlay opacity"
              />
              <span className="text-[10px] text-white/60 w-8 text-right">{overlayOpacity}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
