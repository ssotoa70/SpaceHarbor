import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export interface PlaybackState {
  /** Current frame number (0-based) */
  currentFrame: number;
  /** Total duration in seconds */
  duration: number;
  /** Current time in seconds */
  currentTime: number;
  /** Frames per second */
  fps: number;
  /** Whether playback is active */
  playing: boolean;
  /** Playback rate multiplier (negative = reverse) */
  playbackRate: number;
  /** Seek to a specific frame */
  seekToFrame: (frame: number) => void;
  /** Start playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Step forward or backward by N frames */
  stepFrame: (delta: number) => void;
  /** Set playback rate (negative for reverse) */
  setPlaybackRate: (rate: number) => void;
  /** Total frame count */
  totalFrames: number;
  /** Bind to a video element */
  videoRef: RefObject<HTMLVideoElement | null>;
}

const PlaybackCtx = createContext<PlaybackState>({
  currentFrame: 0,
  duration: 0,
  currentTime: 0,
  fps: 24,
  playing: false,
  playbackRate: 1,
  seekToFrame: () => {},
  play: () => {},
  pause: () => {},
  togglePlay: () => {},
  stepFrame: () => {},
  setPlaybackRate: () => {},
  totalFrames: 0,
  videoRef: { current: null },
});

export function PlaybackProvider({
  children,
  fps = 24,
}: {
  children: ReactNode;
  fps?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const animFrameRef = useRef<number>(0);

  const currentFrame = Math.floor(currentTime * fps);
  const totalFrames = Math.floor(duration * fps);

  // Tick loop using requestAnimationFrame for smooth frame tracking
  useEffect(() => {
    function tick() {
      const v = videoRef.current;
      if (v) {
        setCurrentTime(v.currentTime);
        setDuration(v.duration || 0);
        setPlaying(!v.paused);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const seekToFrame = useCallback(
    (frame: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, frame / fps));
    },
    [fps],
  );

  const play = useCallback(() => {
    const v = videoRef.current;
    if (v) void v.play();
  }, []);

  const pause = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const stepFrame = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.currentTime = Math.max(
        0,
        Math.min(v.duration || 0, v.currentTime + delta / fps),
      );
    },
    [fps],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const v = videoRef.current;
    if (v) {
      // HTML5 video doesn't support negative playback natively;
      // for reverse we'd need a manual ticker — store the intent
      v.playbackRate = Math.abs(rate) || 1;
    }
    setPlaybackRateState(rate);
  }, []);

  return (
    <PlaybackCtx.Provider
      value={{
        currentFrame,
        duration,
        currentTime,
        fps,
        playing,
        playbackRate,
        seekToFrame,
        play,
        pause,
        togglePlay,
        stepFrame,
        setPlaybackRate,
        totalFrames,
        videoRef,
      }}
    >
      {children}
    </PlaybackCtx.Provider>
  );
}

export function usePlayback(): PlaybackState {
  return useContext(PlaybackCtx);
}
