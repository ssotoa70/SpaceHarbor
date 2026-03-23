import test from "node:test";
import assert from "node:assert/strict";

import {
  RING_CRITERIA,
  RING_ORDER,
  checkRingTransition,
  computeKpis,
  createDefaultRolloutConfig,
} from "../../src/iam/rollout-rings.js";
import type { IamKpis } from "../../src/iam/rollout-rings.js";

// ---------------------------------------------------------------------------
// Ring order
// ---------------------------------------------------------------------------

test("RING_ORDER is internal → pilot → expand → general", () => {
  assert.deepEqual(RING_ORDER, ["internal", "pilot", "expand", "general"]);
});

test("all rings have criteria defined", () => {
  for (const ring of RING_ORDER) {
    assert.ok(RING_CRITERIA[ring], `Missing criteria for ring: ${ring}`);
    assert.ok(RING_CRITERIA[ring].goNoGoChecks.length > 0);
  }
});

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

test("computeKpis calculates correct values", () => {
  const kpis = computeKpis({
    totalDecisions: 1000,
    falseDenies: 1,
    coveredActions: 38,
    totalActions: 40,
    crossScopeDenies: 5,
    accessChangeResolutionMinutes: [10, 12, 8],
    windowStart: "2026-03-01T00:00:00Z",
    windowEnd: "2026-03-08T00:00:00Z",
  });

  assert.equal(kpis.falseDenyRate, 0.1);
  assert.equal(kpis.decisionCoverage, 95);
  assert.equal(kpis.accessChangeMttr, 10);
  assert.equal(kpis.crossScopeDenyCount, 5);
  assert.equal(kpis.totalDecisions, 1000);
});

test("computeKpis handles zero decisions", () => {
  const kpis = computeKpis({
    totalDecisions: 0,
    falseDenies: 0,
    coveredActions: 0,
    totalActions: 0,
    crossScopeDenies: 0,
    accessChangeResolutionMinutes: [],
    windowStart: "2026-03-01T00:00:00Z",
    windowEnd: "2026-03-08T00:00:00Z",
  });
  assert.equal(kpis.falseDenyRate, 0);
  assert.equal(kpis.decisionCoverage, 0);
  assert.equal(kpis.accessChangeMttr, 0);
});

// ---------------------------------------------------------------------------
// Ring transition checks
// ---------------------------------------------------------------------------

function makeGoodKpis(): IamKpis {
  return {
    falseDenyRate: 0.05,
    decisionCoverage: 98,
    accessChangeMttr: 10,
    crossScopeDenyCount: 0,
    totalDecisions: 5000,
    windowStart: "2026-03-01T00:00:00Z",
    windowEnd: "2026-03-08T00:00:00Z",
  };
}

test("checkRingTransition: can advance from internal to pilot", () => {
  const result = checkRingTransition("internal", makeGoodKpis());
  assert.equal(result.canAdvance, true);
  assert.equal(result.nextRing, "pilot");
  assert.equal(result.blockers.length, 0);
});

test("checkRingTransition: blocked by high false-deny rate", () => {
  const kpis = { ...makeGoodKpis(), falseDenyRate: 0.5 };
  const result = checkRingTransition("internal", kpis);
  assert.equal(result.canAdvance, false);
  assert.ok(result.blockers[0].includes("False-deny rate"));
});

test("checkRingTransition: blocked by low decision coverage", () => {
  const kpis = { ...makeGoodKpis(), decisionCoverage: 80 };
  const result = checkRingTransition("pilot", kpis);
  assert.equal(result.canAdvance, false);
  assert.ok(result.blockers.some((b) => b.includes("coverage")));
});

test("checkRingTransition: blocked by high MTTR for expand ring", () => {
  const kpis = { ...makeGoodKpis(), accessChangeMttr: 20 };
  const result = checkRingTransition("pilot", kpis);
  assert.equal(result.canAdvance, false);
  assert.ok(result.blockers.some((b) => b.includes("MTTR")));
});

test("checkRingTransition: cannot advance from general", () => {
  const result = checkRingTransition("general", makeGoodKpis());
  assert.equal(result.canAdvance, false);
  assert.equal(result.nextRing, null);
});

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

test("createDefaultRolloutConfig returns safe defaults", () => {
  const config = createDefaultRolloutConfig();
  assert.equal(config.ring, "internal");
  assert.equal(config.enforcementEnabled, false);
  assert.equal(config.shadowModeEnabled, true);
  assert.deepEqual(config.allowlistedTenants, []);
});
