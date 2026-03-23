import type { AssetRow } from "../api";
import {
  deriveDependencyReadiness,
  type DependencyReadiness,
  type DependencyReadinessReason
} from "./dependency-readiness";

export type AgingBucket = "fresh" | "warning" | "critical";

export interface QueueViewRow extends AssetRow {
  ageMinutes: number;
  agingBucket: AgingBucket;
  dependencyReadiness: DependencyReadiness;
  searchableText: string;
}

export interface QueueFilters {
  query?: string;
  status?: string;
  priority?: NonNullable<AssetRow["productionMetadata"]>["priority"];
  owner?: string;
  vendor?: string;
  agingBucket?: AgingBucket;
}

export interface SupervisorSummary {
  total: number;
  byStatus: Record<"pending" | "processing" | "completed" | "failed" | "needs_replay", number>;
  byPriority: Record<"low" | "normal" | "high" | "urgent", number>;
  byAging: Record<AgingBucket, number>;
  dependencyReadiness: {
    ready: number;
    blocked: number;
    byReason: Record<DependencyReadinessReason, number>;
  };
}

interface SummaryCountItem {
  key: string;
  label: string;
  count: number;
}

const supervisorStatusOrder: Array<keyof SupervisorSummary["byStatus"]> = [
  "pending",
  "processing",
  "failed",
  "needs_replay",
  "completed"
];

const supervisorPriorityOrder: Array<keyof SupervisorSummary["byPriority"]> = [
  "low",
  "normal",
  "high",
  "urgent"
];

const supervisorAgingOrder: Array<keyof SupervisorSummary["byAging"]> = ["fresh", "warning", "critical"];
const dependencyReadinessReasonOrder: DependencyReadinessReason[] = [
  "missing_owner",
  "missing_priority",
  "missing_due_date",
  "aged_critical",
  "status_not_actionable"
];

function hasOwnStatusKey(
  byStatus: SupervisorSummary["byStatus"],
  status: string
): status is keyof SupervisorSummary["byStatus"] {
  return Object.prototype.hasOwnProperty.call(byStatus, status);
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function sortQueueRows(rows: QueueViewRow[]): QueueViewRow[] {
  return [...rows].sort((left, right) => {
    if (right.ageMinutes !== left.ageMinutes) {
      return right.ageMinutes - left.ageMinutes;
    }

    return left.title.localeCompare(right.title);
  });
}

export function toSortedUniqueValues(values: Array<string | null>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const next = (value ?? "").trim();
    if (next) {
      unique.add(next);
    }
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function deriveSearchableText(asset: AssetRow): string {
  const metadata = asset.productionMetadata ?? {};
  return [
    asset.title,
    asset.sourceUri,
    metadata.show,
    metadata.episode,
    metadata.sequence,
    metadata.shot,
    metadata.version === null || metadata.version === undefined ? null : String(metadata.version),
    metadata.vendor,
    metadata.priority,
    metadata.dueDate,
    metadata.owner
  ]
    .filter((value): value is string => value !== null && value !== "")
    .join(" ")
    .toLowerCase();
}

function deriveAgeMinutes(dueDate: string | null, nowMs: number): number {
  if (!dueDate) {
    return 0;
  }

  const dueDateMs = Date.parse(dueDate);
  if (Number.isNaN(dueDateMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((nowMs - dueDateMs) / 60_000));
}

export function deriveAgingBucket(ageMinutes: number): AgingBucket {
  if (ageMinutes >= 180) {
    return "critical";
  }

  if (ageMinutes >= 90) {
    return "warning";
  }

  return "fresh";
}

export function toAgingBucketLabel(bucket: AgingBucket): string {
  if (bucket === "critical") {
    return "critical (180m+)";
  }

  if (bucket === "warning") {
    return "warning (90m+)";
  }

  return "fresh (<90m)";
}

function toReadableToken(value: string): string {
  return value.replaceAll("_", " ");
}

export function toStatusLabel(status: string): string {
  return toReadableToken(status);
}

export function toDependencyReadinessReasonLabel(reason: DependencyReadinessReason): string {
  return toReadableToken(reason);
}

export function toSupervisorStatusSummaryItems(summary: SupervisorSummary): SummaryCountItem[] {
  return supervisorStatusOrder.map((status) => ({
    key: status,
    label: toStatusLabel(status),
    count: summary.byStatus[status]
  }));
}

export function toSupervisorPrioritySummaryItems(summary: SupervisorSummary): SummaryCountItem[] {
  return supervisorPriorityOrder.map((priority) => ({
    key: priority,
    label: priority,
    count: summary.byPriority[priority]
  }));
}

export function toSupervisorAgingSummaryItems(summary: SupervisorSummary): SummaryCountItem[] {
  return supervisorAgingOrder.map((agingBucket) => ({
    key: agingBucket,
    label: agingBucket,
    count: summary.byAging[agingBucket]
  }));
}

export function toSupervisorDependencyReadinessSummaryItems(summary: SupervisorSummary): SummaryCountItem[] {
  return [
    {
      key: "ready",
      label: "ready",
      count: summary.dependencyReadiness.ready
    },
    {
      key: "blocked",
      label: "blocked",
      count: summary.dependencyReadiness.blocked
    }
  ];
}

export function toSupervisorBlockerReasonSummaryItems(summary: SupervisorSummary): SummaryCountItem[] {
  return dependencyReadinessReasonOrder.map((reason) => ({
    key: reason,
    label: toDependencyReadinessReasonLabel(reason),
    count: summary.dependencyReadiness.byReason[reason]
  }));
}

export function toQueueViewRow(asset: AssetRow, nowMs: number): QueueViewRow {
  const ageMinutes = deriveAgeMinutes(asset.productionMetadata?.dueDate ?? null, nowMs);
  const agingBucket = deriveAgingBucket(ageMinutes);
  return {
    ...asset,
    ageMinutes,
    agingBucket,
    dependencyReadiness: deriveDependencyReadiness(asset, ageMinutes, agingBucket),
    searchableText: deriveSearchableText(asset)
  };
}

export function matchesSearch(row: QueueViewRow, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => row.searchableText.includes(token));
}

export function applyQueueFilters(rows: QueueViewRow[], filters: QueueFilters): QueueViewRow[] {
  return rows.filter((row) => {
    if (filters.query && !matchesSearch(row, filters.query)) {
      return false;
    }

    if (filters.status && row.status !== filters.status) {
      return false;
    }

    if (filters.priority && row.productionMetadata?.priority !== filters.priority) {
      return false;
    }

    if (filters.agingBucket && row.agingBucket !== filters.agingBucket) {
      return false;
    }

    if (filters.owner && normalize(row.productionMetadata?.owner) !== normalize(filters.owner)) {
      return false;
    }

    if (filters.vendor && normalize(row.productionMetadata?.vendor) !== normalize(filters.vendor)) {
      return false;
    }

    return true;
  });
}

export function buildSupervisorSummary(rows: QueueViewRow[]): SupervisorSummary {
  const summary: SupervisorSummary = {
    total: rows.length,
    byStatus: {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      needs_replay: 0
    },
    byPriority: {
      low: 0,
      normal: 0,
      high: 0,
      urgent: 0
    },
    byAging: {
      fresh: 0,
      warning: 0,
      critical: 0
    },
    dependencyReadiness: {
      ready: 0,
      blocked: 0,
      byReason: {
        missing_owner: 0,
        missing_priority: 0,
        missing_due_date: 0,
        aged_critical: 0,
        status_not_actionable: 0
      }
    }
  };

  for (const row of rows) {
    if (hasOwnStatusKey(summary.byStatus, row.status)) {
      summary.byStatus[row.status] += 1;
    }

    const priority = row.productionMetadata?.priority;
    if (priority) {
      summary.byPriority[priority] += 1;
    }

    summary.byAging[row.agingBucket] += 1;

    if (row.dependencyReadiness.ready) {
      summary.dependencyReadiness.ready += 1;
    }

    if (row.dependencyReadiness.blocked) {
      summary.dependencyReadiness.blocked += 1;
    }

    for (const reason of row.dependencyReadiness.reasons) {
      summary.dependencyReadiness.byReason[reason] += 1;
    }
  }

  return summary;
}
