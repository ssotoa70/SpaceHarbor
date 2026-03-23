import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "../hooks/useEventStream";

export interface BadgeCounts {
  queue: number;
  assignments: number;
  approvals: number;
  feedback: number;
  dlq: number;
}

const EMPTY: BadgeCounts = { queue: 0, assignments: 0, approvals: 0, feedback: 0, dlq: 0 };
const POLL_INTERVAL = 60_000;

/**
 * Fetches nav badge counts from the backend and subscribes to SSE updates.
 * Falls back to polling every 60s.
 */
export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/nav/badges");
      if (res.ok) {
        const data = (await res.json()) as BadgeCounts;
        setCounts(data);
      }
    } catch {
      // silently ignore — badges are non-critical
    }
  }, []);

  // SSE handler for real-time badge updates
  const onEvent = useCallback((event: { type: string; data: unknown }) => {
    if (event.type === "nav:badges") {
      setCounts(event.data as BadgeCounts);
    }
  }, []);

  useEventStream({
    url: "/api/v1/events/stream",
    onEvent,
  });

  // Initial fetch + polling fallback
  useEffect(() => {
    void fetchCounts();
    pollRef.current = setInterval(() => void fetchCounts(), POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchCounts]);

  return counts;
}
