// ---------------------------------------------------------------------------
// Phase 8 Slice 10: Pilot Enforcement Rings & KPI Tracking
// SERGIO-107
// ---------------------------------------------------------------------------

import type { RolloutConfig, RolloutRing } from "./types.js";

// ---------------------------------------------------------------------------
// Rollout ring definitions
// ---------------------------------------------------------------------------

/**
 * Ring progression: internal → pilot → expand → general
 * Each ring has explicit go/no-go criteria.
 */
export const RING_ORDER: readonly RolloutRing[] = [
  "internal",
  "pilot",
  "expand",
  "general",
];

export interface RingCriteria {
  ring: RolloutRing;
  description: string;
  goNoGoChecks: string[];
}

export const RING_CRITERIA: Record<RolloutRing, RingCriteria> = {
  internal: {
    ring: "internal",
    description: "Internal team only — shadow mode, no enforcement",
    goNoGoChecks: [
      "Shadow authz decisions generating for all configured actions",
      "Decision logs queryable and accurate",
      "Zero false-positive denies in shadow data",
      "IAM module does not affect existing latency SLOs",
    ],
  },
  pilot: {
    ring: "pilot",
    description: "Single pilot tenant with enforcement enabled",
    goNoGoChecks: [
      "All internal ring go/no-go checks passed",
      "Pilot tenant users onboarded with correct role bindings",
      "Read-scope enforcement tested with real workflows",
      "False-deny rate < 0.1% over 7-day window",
      "Rollback tested and verified < 5 minutes",
    ],
  },
  expand: {
    ring: "expand",
    description: "Multiple tenants with enforcement enabled",
    goNoGoChecks: [
      "All pilot ring go/no-go checks passed for ≥ 30 days",
      "Write-scope enforcement tested with real workflows",
      "Approval SoD verified with zero bypass incidents",
      "Break-glass workflow tested and documented",
      "Operator runbook reviewed and approved",
    ],
  },
  general: {
    ring: "general",
    description: "All tenants with full enforcement",
    goNoGoChecks: [
      "All expand ring go/no-go checks passed for ≥ 60 days",
      "SCIM sync stable for all pilot tenants",
      "Access-change MTTR < 15 minutes",
      "No open security incidents related to IAM",
      "Compliance review passed",
    ],
  },
};

// ---------------------------------------------------------------------------
// KPI tracking
// ---------------------------------------------------------------------------

export interface IamKpis {
  /** Percentage of authz decisions that were false denies. */
  falseDenyRate: number;
  /** Percentage of actions covered by authz evaluation. */
  decisionCoverage: number;
  /** Mean time to resolve access change requests (minutes). */
  accessChangeMttr: number;
  /** Number of cross-scope deny events. */
  crossScopeDenyCount: number;
  /** Total authz decisions evaluated. */
  totalDecisions: number;
  /** Window start (ISO). */
  windowStart: string;
  /** Window end (ISO). */
  windowEnd: string;
}

/**
 * Computes KPIs from authz decision metrics.
 */
export function computeKpis(metrics: {
  totalDecisions: number;
  falseDenies: number;
  coveredActions: number;
  totalActions: number;
  crossScopeDenies: number;
  accessChangeResolutionMinutes: number[];
  windowStart: string;
  windowEnd: string;
}): IamKpis {
  const mttrValues = metrics.accessChangeResolutionMinutes;
  const mttr = mttrValues.length > 0
    ? mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length
    : 0;

  return {
    falseDenyRate: metrics.totalDecisions > 0
      ? (metrics.falseDenies / metrics.totalDecisions) * 100
      : 0,
    decisionCoverage: metrics.totalActions > 0
      ? (metrics.coveredActions / metrics.totalActions) * 100
      : 0,
    accessChangeMttr: Math.round(mttr * 100) / 100,
    crossScopeDenyCount: metrics.crossScopeDenies,
    totalDecisions: metrics.totalDecisions,
    windowStart: metrics.windowStart,
    windowEnd: metrics.windowEnd,
  };
}

/**
 * Checks whether a ring transition is safe based on current KPIs.
 */
export function checkRingTransition(
  currentRing: RolloutRing,
  kpis: IamKpis
): { canAdvance: boolean; nextRing: RolloutRing | null; blockers: string[] } {
  const idx = RING_ORDER.indexOf(currentRing);
  if (idx < 0 || idx >= RING_ORDER.length - 1) {
    return { canAdvance: false, nextRing: null, blockers: ["Already at final ring or unknown ring"] };
  }

  const nextRing = RING_ORDER[idx + 1];
  const blockers: string[] = [];

  // Universal checks
  if (kpis.falseDenyRate > 0.1) {
    blockers.push(`False-deny rate ${kpis.falseDenyRate.toFixed(2)}% exceeds 0.1% threshold`);
  }

  if (kpis.decisionCoverage < 95) {
    blockers.push(`Decision coverage ${kpis.decisionCoverage.toFixed(1)}% below 95% threshold`);
  }

  // Ring-specific checks
  if (nextRing === "expand" || nextRing === "general") {
    if (kpis.accessChangeMttr > 15) {
      blockers.push(`Access-change MTTR ${kpis.accessChangeMttr}min exceeds 15min threshold`);
    }
  }

  return {
    canAdvance: blockers.length === 0,
    nextRing,
    blockers,
  };
}

/**
 * Creates a default RolloutConfig.
 */
export function createDefaultRolloutConfig(): RolloutConfig {
  return {
    ring: "internal",
    allowlistedTenants: [],
    enforcementEnabled: false,
    shadowModeEnabled: true,
  };
}
