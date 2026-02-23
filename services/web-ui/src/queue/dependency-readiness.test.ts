import { describe, expect, it } from "vitest";

import type { AssetRow } from "../api";

import {
  deriveDependencyReadiness,
  type DependencyReadinessReason
} from "./dependency-readiness";
import { toQueueViewRow } from "./view-model";

type AssetOverrides = Partial<Omit<AssetRow, "productionMetadata">> & {
  productionMetadata?: Partial<AssetRow["productionMetadata"]>;
};

function buildAsset(overrides: AssetOverrides = {}): AssetRow {
  const baseAsset: AssetRow = {
    id: "asset-1",
    jobId: "job-1",
    title: "Queue Asset",
    sourceUri: "s3://bucket/asset.mov",
    status: "pending",
    productionMetadata: {
      show: "show-a",
      episode: "ep001",
      sequence: "sq010",
      shot: "sh010",
      version: 1,
      vendor: "vendor-a",
      priority: "high",
      dueDate: "2026-02-18T09:00:00.000Z",
      owner: "owner-a"
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

describe("dependency readiness", () => {
  it("returns ready with info severity when dependencies are satisfied", () => {
    const readiness = deriveDependencyReadiness(buildAsset(), 60, "warning");

    expect(readiness.ready).toBe(true);
    expect(readiness.blocked).toBe(false);
    expect(readiness.severity).toBe("info");
    expect(readiness.reasons).toEqual([]);
  });

  it("returns warning when blocked without aged critical", () => {
    const asset = buildAsset({
      productionMetadata: {
        owner: null,
        priority: null,
        dueDate: null
      },
      status: "processing"
    });

    const readiness = deriveDependencyReadiness(asset, 0, "fresh");

    expect(readiness.ready).toBe(false);
    expect(readiness.blocked).toBe(true);
    expect(readiness.severity).toBe("warning");
    expect(readiness.reasons).toEqual<DependencyReadinessReason[]>([
      "missing_owner",
      "missing_priority",
      "missing_due_date",
      "status_not_actionable"
    ]);
  });

  it("returns critical when aged_critical is present", () => {
    const asset = buildAsset();
    const readiness = deriveDependencyReadiness(asset, 185, "critical");

    expect(readiness.ready).toBe(false);
    expect(readiness.blocked).toBe(true);
    expect(readiness.severity).toBe("critical");
    expect(readiness.reasons).toContain("aged_critical");
  });

  it("includes dependency readiness in queue view rows", () => {
    const nowMs = Date.parse("2026-02-18T10:00:00.000Z");
    const row = toQueueViewRow(buildAsset({ productionMetadata: { owner: null } }), nowMs);

    expect(row.dependencyReadiness.ready).toBe(false);
    expect(row.dependencyReadiness.reasons).toEqual(["missing_owner"]);
    expect(row.dependencyReadiness.severity).toBe("warning");
  });
});
