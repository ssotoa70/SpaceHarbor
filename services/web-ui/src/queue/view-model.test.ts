import { describe, expect, it } from "vitest";

import type { AssetRow } from "../api";

import {
  applyQueueFilters,
  buildSupervisorSummary,
  deriveAgingBucket,
  matchesSearch,
  sortQueueRows,
  toSortedUniqueValues,
  toQueueViewRow
} from "./view-model";

type AssetOverrides = Partial<Omit<AssetRow, "productionMetadata">> & {
  productionMetadata?: Partial<AssetRow["productionMetadata"]>;
};

function buildAsset(overrides: AssetOverrides = {}): AssetRow {
  const baseAsset: AssetRow = {
    id: "asset-1",
    jobId: "job-1",
    title: "Show-A SH010 Comp",
    sourceUri: "s3://bucket/show-a/ep002/shot-010.mov",
    status: "pending",
    productionMetadata: {
      show: "show-a",
      episode: "ep002",
      sequence: "sq020",
      shot: "sh010",
      version: 3,
      vendor: "vendor-west",
      priority: "high",
      dueDate: "2026-02-18T09:00:00.000Z",
      owner: "alex"
    }
  };

  return {
    ...baseAsset,
    ...overrides,
    productionMetadata: {
      ...baseAsset.productionMetadata,
      ...overrides.productionMetadata
    }
  };
}

describe("queue view model", () => {
  it("derives aging buckets as fresh, warning, and critical", () => {
    expect(deriveAgingBucket(10)).toBe("fresh");
    expect(deriveAgingBucket(95)).toBe("warning");
    expect(deriveAgingBucket(180)).toBe("critical");
  });

  it("applies warning and critical boundaries at 90 and 180 minutes", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");

    const warningBoundary = toQueueViewRow(buildAsset({
      id: "asset-warning-boundary",
      productionMetadata: {
        dueDate: "2026-02-18T10:30:00.000Z"
      }
    }), nowMs);
    const criticalBoundary = toQueueViewRow(buildAsset({
      id: "asset-critical-boundary",
      productionMetadata: {
        dueDate: "2026-02-18T09:00:00.000Z"
      }
    }), nowMs);

    expect(warningBoundary.ageMinutes).toBe(90);
    expect(warningBoundary.agingBucket).toBe("warning");
    expect(criticalBoundary.ageMinutes).toBe(180);
    expect(criticalBoundary.agingBucket).toBe("critical");
  });

  it("uses fresh aging when due date is null or invalid", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");

    const nullDueDate = toQueueViewRow(buildAsset({
      id: "asset-null-due-date",
      productionMetadata: {
        dueDate: null
      }
    }), nowMs);
    const invalidDueDate = toQueueViewRow(buildAsset({
      id: "asset-invalid-due-date",
      productionMetadata: {
        dueDate: "not-a-date"
      }
    }), nowMs);

    expect(nullDueDate.ageMinutes).toBe(0);
    expect(nullDueDate.agingBucket).toBe("fresh");
    expect(invalidDueDate.ageMinutes).toBe(0);
    expect(invalidDueDate.agingBucket).toBe("fresh");
  });

  it("includes dependency readiness on queue rows with deterministic reason order", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const row = toQueueViewRow(buildAsset({
      id: "asset-readiness-check",
      status: "completed",
      productionMetadata: {
        owner: "   ",
        priority: null,
        dueDate: null
      }
    }), nowMs);

    expect(row.dependencyReadiness).toEqual({
      ready: false,
      blocked: true,
      severity: "warning",
      reasons: [
        "missing_owner",
        "missing_priority",
        "missing_due_date",
        "status_not_actionable"
      ]
    });
  });

  it("matches free-text query across title, source URI, and metadata", () => {
    const row = toQueueViewRow(buildAsset(), Date.parse("2026-02-18T12:00:00.000Z"));

    expect(matchesSearch(row, "show-a sh010")).toBe(true);
    expect(matchesSearch(row, "bucket vendor-west")).toBe(true);
    expect(matchesSearch(row, "nonexistent")).toBe(false);
  });

  it("applies combined status, priority, owner, and vendor filters", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const rows = [
      toQueueViewRow(buildAsset({
        id: "asset-1",
        status: "failed",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "urgent",
          owner: "coordinator-a",
          vendor: "vendor-east"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-2",
        status: "failed",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "urgent",
          owner: "coordinator-a",
          vendor: "vendor-west"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-3",
        status: "pending",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "urgent",
          owner: "coordinator-a",
          vendor: "vendor-east"
        }
      }), nowMs)
    ];

    const filtered = applyQueueFilters(rows, {
      status: "failed",
      priority: "urgent",
      owner: "coordinator-a",
      vendor: "vendor-east"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("asset-1");
  });

  it("sorts queue rows by oldest age first, then title", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const rows = [
      toQueueViewRow(buildAsset({
        id: "asset-young",
        title: "Zulu Clip",
        productionMetadata: {
          dueDate: "2026-02-18T11:45:00.000Z"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-old-zulu",
        title: "Zulu Old Clip",
        productionMetadata: {
          dueDate: "2026-02-18T08:00:00.000Z"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-old-alpha",
        title: "Alpha Old Clip",
        productionMetadata: {
          dueDate: "2026-02-18T08:00:00.000Z"
        }
      }), nowMs)
    ];

    const sorted = sortQueueRows(rows);

    expect(sorted.map((row) => row.id)).toEqual([
      "asset-old-alpha",
      "asset-old-zulu",
      "asset-young"
    ]);
  });

  it("returns a new array when sorting queue rows", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const rows = [
      toQueueViewRow(buildAsset({ id: "asset-1" }), nowMs),
      toQueueViewRow(buildAsset({ id: "asset-2", productionMetadata: { dueDate: "2026-02-18T08:00:00.000Z" } }), nowMs)
    ];

    const sorted = sortQueueRows(rows);

    expect(sorted).not.toBe(rows);
    expect(rows.map((row) => row.id)).toEqual(["asset-1", "asset-2"]);
  });

  it("builds sorted unique values while trimming blanks", () => {
    expect(toSortedUniqueValues([
      "  owner-b  ",
      null,
      "",
      "owner-a",
      "owner-b",
      "   "
    ])).toEqual(["owner-a", "owner-b"]);
  });

  it("builds supervisor summary counts by status, priority, and aging bucket", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const rows = [
      toQueueViewRow(buildAsset({
        id: "asset-fresh",
        status: "pending",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "normal",
          dueDate: "2026-02-18T11:30:00.000Z"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-warning",
        status: "processing",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "high",
          dueDate: "2026-02-18T10:15:00.000Z"
        }
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-critical",
        status: "failed",
        productionMetadata: {
          ...buildAsset().productionMetadata,
          priority: "urgent",
          dueDate: "2026-02-18T08:00:00.000Z"
        }
      }), nowMs)
    ];

    const summary = buildSupervisorSummary(rows);

    expect(summary.total).toBe(3);
    expect(summary.byStatus.pending).toBe(1);
    expect(summary.byStatus.processing).toBe(1);
    expect(summary.byStatus.failed).toBe(1);
    expect(summary.byPriority.normal).toBe(1);
    expect(summary.byPriority.high).toBe(1);
    expect(summary.byPriority.urgent).toBe(1);
    expect(summary.byAging.fresh).toBe(1);
    expect(summary.byAging.warning).toBe(1);
    expect(summary.byAging.critical).toBe(1);
    expect(summary.dependencyReadiness.ready).toBe(1);
    expect(summary.dependencyReadiness.blocked).toBe(2);
    expect(summary.dependencyReadiness.byReason.missing_owner).toBe(0);
    expect(summary.dependencyReadiness.byReason.missing_priority).toBe(0);
    expect(summary.dependencyReadiness.byReason.missing_due_date).toBe(0);
    expect(summary.dependencyReadiness.byReason.aged_critical).toBe(1);
    expect(summary.dependencyReadiness.byReason.status_not_actionable).toBe(1);
  });

  it("ignores unknown status values safely in summary aggregation", () => {
    const nowMs = Date.parse("2026-02-18T12:00:00.000Z");
    const rows = [
      toQueueViewRow(buildAsset({
        id: "asset-known",
        status: "pending"
      }), nowMs),
      toQueueViewRow(buildAsset({
        id: "asset-unknown",
        status: "toString"
      }), nowMs)
    ];

    const summary = buildSupervisorSummary(rows);

    expect(summary.total).toBe(2);
    expect(summary.byStatus.pending).toBe(1);
    expect(summary.byStatus.processing).toBe(0);
    expect(summary.byStatus.completed).toBe(0);
    expect(summary.byStatus.failed).toBe(0);
    expect(summary.byStatus.needs_replay).toBe(0);
    expect(Object.keys(summary.byStatus).sort()).toEqual([
      "completed",
      "failed",
      "needs_replay",
      "pending",
      "processing"
    ]);
  });
});
