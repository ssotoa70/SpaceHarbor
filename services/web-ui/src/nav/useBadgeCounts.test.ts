import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBadgeCounts } from "./useBadgeCounts";

// Mock useEventStream
vi.mock("../hooks/useEventStream", () => ({
  useEventStream: vi.fn(() => ({ status: "connected" })),
}));

const mockBadges = { queue: 3, assignments: 5, approvals: 2, feedback: 1, dlq: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockBadges),
  }));
});

describe("useBadgeCounts", () => {
  it("returns zero counts initially", () => {
    const { result } = renderHook(() => useBadgeCounts());
    expect(result.current.queue).toBe(0);
    expect(result.current.dlq).toBe(0);
  });

  it("fetches counts from /api/v1/nav/badges", async () => {
    const { result } = renderHook(() => useBadgeCounts());
    await waitFor(() => {
      expect(result.current.queue).toBe(3);
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/nav/badges");
  });

  it("handles fetch errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { result } = renderHook(() => useBadgeCounts());
    // Should stay at zero, no crash
    expect(result.current.queue).toBe(0);
    expect(result.current.approvals).toBe(0);
  });

  it("handles non-ok responses gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useBadgeCounts());
    expect(result.current.queue).toBe(0);
  });
});
