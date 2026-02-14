import type { MetricsSnapshot } from "./types";

export type HealthState = "normal" | "degraded" | "recovering";

interface DeriveHealthStateInput {
  current: MetricsSnapshot | null;
  previous: MetricsSnapshot | null;
  recentFallbackAudit: boolean;
  now: number;
  lastDegradedAt: number | null;
  cooldownMs: number;
}

interface DerivedHealthState {
  state: HealthState;
}

function fallbackCount(snapshot: MetricsSnapshot | null): number {
  return snapshot?.degradedMode.fallbackEvents ?? 0;
}

export function deriveHealthState(input: DeriveHealthStateInput): DerivedHealthState {
  const currentFallback = fallbackCount(input.current);
  const previousFallback = fallbackCount(input.previous);
  const fallbackDelta = currentFallback - previousFallback;

  if (fallbackDelta > 0 || input.recentFallbackAudit) {
    return {
      state: "degraded"
    };
  }

  if (input.lastDegradedAt !== null && input.now - input.lastDegradedAt < input.cooldownMs) {
    return {
      state: "recovering"
    };
  }

  return {
    state: "normal"
  };
}
