import { describe, expect, it } from "vitest";

import {
  formatAperture,
  formatBitRate,
  formatBoolean,
  formatCoordinate,
  formatDuration,
  formatFileSize,
  formatFps,
  formatIso,
  formatResolution,
  formatShutterAngle,
  formatTimecode,
} from "./formatters";

describe("formatters", () => {
  describe("formatFps", () => {
    it("computes from num/den", () => {
      expect(formatFps({ fps_num: 24000, fps_den: 1001 })).toBe("23.976 fps");
      expect(formatFps({ fps_num: 24, fps_den: 1 })).toBe("24 fps");
    });
    it("falls back to pre-computed fps", () => {
      expect(formatFps({ fps: 23.976 })).toBe("23.976 fps");
    });
    it("returns null on missing or zero denominator", () => {
      expect(formatFps({})).toBeNull();
      expect(formatFps({ fps_num: 24000, fps_den: 0 })).toBeNull();
      expect(formatFps({ fps_num: 0, fps_den: 1 })).toBeNull();
    });
    it("rejects non-finite input", () => {
      expect(formatFps({ fps: Number.NaN })).toBeNull();
      expect(formatFps({ fps: Infinity })).toBeNull();
    });
  });

  describe("formatDuration", () => {
    it("formats seconds as HH:MM:SS.mmm", () => {
      expect(formatDuration(127.5)).toBe("00:02:07.500");
      expect(formatDuration(3661.25)).toBe("01:01:01.250");
      expect(formatDuration(0)).toBe("00:00:00.000");
    });
    it("returns null on negative or non-finite", () => {
      expect(formatDuration(-1)).toBeNull();
      expect(formatDuration(Number.NaN)).toBeNull();
      expect(formatDuration(Infinity)).toBeNull();
      expect(formatDuration(null)).toBeNull();
      expect(formatDuration(undefined)).toBeNull();
    });
  });

  describe("formatBitRate", () => {
    it("scales to Mbps and Gbps", () => {
      expect(formatBitRate(100_000_000)).toBe("100 Mbps");
      expect(formatBitRate(1_500_000_000)).toBe("1.5 Gbps");
      expect(formatBitRate(500_000)).toBe("500 kbps");
      expect(formatBitRate(500)).toBe("500 bps");
    });
    it("returns null on invalid", () => {
      expect(formatBitRate(-1)).toBeNull();
      expect(formatBitRate(null)).toBeNull();
      expect(formatBitRate(Number.NaN)).toBeNull();
    });
  });

  describe("formatFileSize", () => {
    it("scales to KB/MB/GB/TB", () => {
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(5_000_000)).toBe("4.8 MB");
      expect(formatFileSize(2_000_000_000)).toBe("1.9 GB");
    });
    it("returns null on invalid", () => {
      expect(formatFileSize(-1)).toBeNull();
      expect(formatFileSize(null)).toBeNull();
    });
  });

  describe("formatAperture", () => {
    it("renders with T prefix", () => {
      expect(formatAperture(2.8)).toBe("T2.8");
      expect(formatAperture(1.4)).toBe("T1.4");
    });
    it("returns null on invalid", () => {
      expect(formatAperture(0)).toBeNull();
      expect(formatAperture(-1)).toBeNull();
      expect(formatAperture(null)).toBeNull();
    });
  });

  describe("formatIso", () => {
    it("renders as ISO prefix", () => {
      expect(formatIso(800)).toBe("ISO 800");
      expect(formatIso(12800)).toBe("ISO 12800");
    });
    it("returns null on invalid", () => {
      expect(formatIso(0)).toBeNull();
      expect(formatIso(-100)).toBeNull();
      expect(formatIso(null)).toBeNull();
    });
  });

  describe("formatResolution", () => {
    it("formats WxH", () => {
      expect(formatResolution(3840, 2160)).toBe("3840 × 2160");
    });
    it("returns null when either dim missing or invalid", () => {
      expect(formatResolution(null, 2160)).toBeNull();
      expect(formatResolution(3840, 0)).toBeNull();
      expect(formatResolution(-1, 100)).toBeNull();
    });
  });

  describe("formatBoolean", () => {
    it("renders Yes/No", () => {
      expect(formatBoolean(true)).toBe("Yes");
      expect(formatBoolean(false)).toBe("No");
    });
    it("returns null on non-boolean", () => {
      expect(formatBoolean(null)).toBeNull();
      expect(formatBoolean(undefined)).toBeNull();
    });
  });

  describe("formatCoordinate", () => {
    it("renders lat/lon with cardinal", () => {
      expect(formatCoordinate(34.0522, "lat")).toBe("34.0522° N");
      expect(formatCoordinate(-118.2437, "lon")).toBe("118.2437° W");
      expect(formatCoordinate(0, "lat")).toBe("0.0000° N");
    });
    it("returns null on out-of-range", () => {
      expect(formatCoordinate(95, "lat")).toBeNull();
      expect(formatCoordinate(-200, "lon")).toBeNull();
      expect(formatCoordinate(null, "lat")).toBeNull();
    });
  });

  describe("formatShutterAngle", () => {
    it("renders with degree symbol", () => {
      expect(formatShutterAngle(172.8)).toBe("172.8°");
      expect(formatShutterAngle(180)).toBe("180°");
    });
    it("returns null on invalid", () => {
      expect(formatShutterAngle(0)).toBeNull();
      expect(formatShutterAngle(-1)).toBeNull();
      expect(formatShutterAngle(null)).toBeNull();
    });
  });

  describe("formatTimecode", () => {
    it("passes through SMPTE strings", () => {
      expect(formatTimecode("01:00:00:00")).toBe("01:00:00:00");
    });
    it("rejects malformed input", () => {
      expect(formatTimecode("")).toBeNull();
      expect(formatTimecode(null)).toBeNull();
      expect(formatTimecode("not-a-timecode")).toBeNull();
    });
  });
});
