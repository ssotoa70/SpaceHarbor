import { describe, it, expect } from "vitest";
import { formatTimecode, formatTC } from "./timecode";

describe("formatTimecode", () => {
  it("formats zero as 00:00:00:00", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
  });

  it("formats seconds-only value", () => {
    expect(formatTimecode(5)).toBe("00:00:05:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTimecode(125)).toBe("00:02:05:00");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatTimecode(3661)).toBe("01:01:01:00");
  });

  it("formats fractional seconds as frames at 24fps", () => {
    // 0.5 seconds * 24fps = 12 frames
    expect(formatTimecode(0.5)).toBe("00:00:00:12");
  });

  it("formats fractional seconds with custom fps", () => {
    // 0.5 seconds * 30fps = 15 frames
    expect(formatTimecode(0.5, 30)).toBe("00:00:00:15");
  });

  it("outputs 4-segment HH:MM:SS:FF format", () => {
    const result = formatTimecode(90.75);
    const segments = result.split(":");
    expect(segments).toHaveLength(4);
    // Each segment should be zero-padded to 2 digits
    segments.forEach((seg) => expect(seg).toMatch(/^\d{2}$/));
  });

  it("clamps negative values to zero", () => {
    expect(formatTimecode(-5)).toBe("00:00:00:00");
  });

  it("formatTC alias delegates to formatTimecode", () => {
    expect(formatTC(90.75)).toBe(formatTimecode(90.75));
    expect(formatTC(0)).toBe("00:00:00:00");
    expect(formatTC(3661.5, 30)).toBe(formatTimecode(3661.5, 30));
  });
});
