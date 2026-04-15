/**
 * Pure formatters for metadata field values.
 *
 * Every formatter accepts possibly-absent / possibly-invalid input and returns
 * `string | null`. A `null` return means "hide this row". Formatters never throw.
 * They contain no DOM, no React, no logging — they are trivially unit-testable.
 */

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function formatFps(meta: { fps_num?: number; fps_den?: number; fps?: number }): string | null {
  if (isFiniteNumber(meta.fps_num) && isFiniteNumber(meta.fps_den) && meta.fps_den > 0 && meta.fps_num > 0) {
    const fps = meta.fps_num / meta.fps_den;
    return `${roundForDisplay(fps)} fps`;
  }
  if (isFiniteNumber(meta.fps) && meta.fps > 0) {
    return `${roundForDisplay(meta.fps)} fps`;
  }
  return null;
}

function roundForDisplay(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 1000) / 1000).toString();
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!isFiniteNumber(seconds) || seconds < 0) return null;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

export function formatBitRate(bps: number | null | undefined): string | null {
  if (!isFiniteNumber(bps) || bps < 0) return null;
  if (bps >= 1_000_000_000) return `${trimTrailingZeros(bps / 1_000_000_000)} Gbps`;
  if (bps >= 1_000_000) return `${trimTrailingZeros(bps / 1_000_000)} Mbps`;
  if (bps >= 1_000) return `${trimTrailingZeros(bps / 1_000)} kbps`;
  return `${bps} bps`;
}

function trimTrailingZeros(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatFileSize(bytes: number | null | undefined): string | null {
  if (!isFiniteNumber(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${value.toFixed(1)} ${FILE_SIZE_UNITS[unitIdx]}`;
}

export function formatAperture(value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) return null;
  return `T${trimTrailingZeros(value)}`;
}

export function formatIso(value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) return null;
  return `ISO ${Math.round(value)}`;
}

export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return `${width} \u00d7 ${height}`;
}

export function formatBoolean(value: boolean | null | undefined): string | null {
  if (typeof value !== "boolean") return null;
  return value ? "Yes" : "No";
}

export function formatCoordinate(
  value: number | null | undefined,
  axis: "lat" | "lon",
): string | null {
  if (!isFiniteNumber(value)) return null;
  const limit = axis === "lat" ? 90 : 180;
  if (value < -limit || value > limit) return null;
  const cardinal = axis === "lat" ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
  return `${Math.abs(value).toFixed(4)}\u00b0 ${cardinal}`;
}

export function formatShutterAngle(value: number | null | undefined): string | null {
  if (!isFiniteNumber(value) || value <= 0) return null;
  return `${trimTrailingZeros(value)}\u00b0`;
}

const SMPTE_TIMECODE_RE = /^\d{2}:\d{2}:\d{2}[:;]\d{2}$/;

export function formatTimecode(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!SMPTE_TIMECODE_RE.test(value)) return null;
  return value;
}
