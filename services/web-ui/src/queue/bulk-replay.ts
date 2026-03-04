export const MAX_BULK_REPLAY_BATCH = 25;

export type BulkReplayEligibilityReason =
  | "missing_job_id"
  | "status_not_replayable"
  | "dependency_not_ready"
  | "batch_limit_exceeded";

export type BulkReplaySkipReason = BulkReplayEligibilityReason | "halted_rate_limited";

export interface BulkReplayCandidate {
  id: string;
  title: string;
  jobId: string | null;
  status: string;
  dependencyReadiness: {
    ready: boolean;
  };
}

export type BulkReplayRowOutcome =
  | {
      row: BulkReplayCandidate;
      outcome: "replayed";
    }
  | {
      row: BulkReplayCandidate;
      outcome: "failed";
      error: string;
    }
  | {
      row: BulkReplayCandidate;
      outcome: "skipped";
      reason: BulkReplaySkipReason;
    };

export interface BulkReplayPreflightResult {
  eligible: BulkReplayCandidate[];
  blocked: Array<{
    row: BulkReplayCandidate;
    reason: BulkReplayEligibilityReason;
  }>;
}

export interface BulkReplayRunResult {
  haltedReason: "rate_limited" | null;
  outcomes: BulkReplayRowOutcome[];
  summary: {
    replayed: number;
    failed: number;
    skipped: number;
    total: number;
  };
}

const replayableStatuses = new Set(["failed", "needs_replay"]);

function classifyEligibility(row: BulkReplayCandidate): BulkReplayEligibilityReason | null {
  if (!row.jobId) {
    return "missing_job_id";
  }

  if (!replayableStatuses.has(row.status)) {
    return "status_not_replayable";
  }

  if (!row.dependencyReadiness.ready) {
    return "dependency_not_ready";
  }

  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRateLimitedError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 429 || status === "429") {
      return true;
    }
  }

  const message = toErrorMessage(error).toLowerCase();
  const indicatesRateLimit =
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("too many requests");

  if (!indicatesRateLimit) {
    return false;
  }

  if (message.includes("429") || message.includes("http 429")) {
    return true;
  }

  return indicatesRateLimit;
}

export function preflightBulkReplay(rows: BulkReplayCandidate[]): BulkReplayPreflightResult {
  const eligible: BulkReplayCandidate[] = [];
  const blocked: BulkReplayPreflightResult["blocked"] = [];

  for (const row of rows) {
    const reason = classifyEligibility(row);
    if (reason) {
      blocked.push({ row, reason });
      continue;
    }

    if (eligible.length >= MAX_BULK_REPLAY_BATCH) {
      blocked.push({ row, reason: "batch_limit_exceeded" });
      continue;
    }

    eligible.push(row);
  }

  return {
    eligible,
    blocked
  };
}

export async function runBulkReplay(
  rows: BulkReplayCandidate[],
  replayOne: (row: BulkReplayCandidate) => Promise<void>
): Promise<BulkReplayRunResult> {
  const preflight = preflightBulkReplay(rows);
  const blockedReasonByRow = new Map<BulkReplayCandidate, BulkReplayEligibilityReason>();
  for (const item of preflight.blocked) {
    blockedReasonByRow.set(item.row, item.reason);
  }

  const outcomes: BulkReplayRowOutcome[] = [];
  let haltedReason: BulkReplayRunResult["haltedReason"] = null;

  for (const row of rows) {
    const blockedReason = blockedReasonByRow.get(row);
    if (blockedReason) {
      outcomes.push({
        row,
        outcome: "skipped",
        reason: blockedReason
      });
      continue;
    }

    if (haltedReason === "rate_limited") {
      outcomes.push({
        row,
        outcome: "skipped",
        reason: "halted_rate_limited"
      });
      continue;
    }

    try {
      await replayOne(row);
      outcomes.push({
        row,
        outcome: "replayed"
      });
    } catch (error) {
      outcomes.push({
        row,
        outcome: "failed",
        error: toErrorMessage(error)
      });

      if (isRateLimitedError(error)) {
        haltedReason = "rate_limited";
      }
    }
  }

  const summary = outcomes.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      accumulator[item.outcome] += 1;
      return accumulator;
    },
    {
      replayed: 0,
      failed: 0,
      skipped: 0,
      total: 0
    }
  );

  return {
    haltedReason,
    outcomes,
    summary
  };
}
