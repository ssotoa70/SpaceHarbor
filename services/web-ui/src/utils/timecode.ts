/**
 * Format seconds into professional VFX timecode: HH:MM:SS:FF
 * @param seconds - Time value in seconds
 * @param fps - Frames per second (default: 24)
 */
export function formatTC(seconds: number, fps = 24): string {
  return formatTimecode(seconds, fps);
}

export function formatTimecode(seconds: number, fps = 24): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
