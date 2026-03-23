import type { AssetRow } from "../api";

export type DependencyReadinessReason =
  | "missing_owner"
  | "missing_priority"
  | "missing_due_date"
  | "aged_critical"
  | "status_not_actionable";

export type DependencyReadinessSeverity = "info" | "warning" | "critical";

export interface DependencyReadiness {
  ready: boolean;
  blocked: boolean;
  severity: DependencyReadinessSeverity;
  reasons: DependencyReadinessReason[];
}

type AgingBucket = "fresh" | "warning" | "critical";

const actionableStatuses = new Set(["pending", "failed", "needs_replay"]);

function hasValue(value: string | null): boolean {
  return (value ?? "").trim().length > 0;
}

export function deriveDependencyReadiness(
  asset: AssetRow,
  _ageMinutes: number,
  agingBucket: AgingBucket
): DependencyReadiness {
  const reasons: DependencyReadinessReason[] = [];
  const metadata = asset.productionMetadata ?? {};

  if (!hasValue(metadata.owner ?? null)) {
    reasons.push("missing_owner");
  }

  if (metadata.priority === null || metadata.priority === undefined) {
    reasons.push("missing_priority");
  }

  if (!hasValue(metadata.dueDate ?? null)) {
    reasons.push("missing_due_date");
  }

  if (agingBucket === "critical") {
    reasons.push("aged_critical");
  }

  if (!actionableStatuses.has(asset.status)) {
    reasons.push("status_not_actionable");
  }

  const blocked = reasons.length > 0;
  const severity: DependencyReadinessSeverity = reasons.includes("aged_critical")
    ? "critical"
    : blocked
      ? "warning"
      : "info";

  return {
    ready: !blocked,
    blocked,
    severity,
    reasons
  };
}
