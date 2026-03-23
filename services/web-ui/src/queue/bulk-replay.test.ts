import { describe, expect, it } from "vitest";

import {
  MAX_BULK_REPLAY_BATCH,
  preflightBulkReplay,
  runBulkReplay,
  type BulkReplayCandidate
} from "./bulk-replay";

type RowOverrides = Partial<BulkReplayCandidate> & {
  dependencyReadiness?: Partial<BulkReplayCandidate["dependencyReadiness"]>;
};

function buildRow(overrides: RowOverrides = {}): BulkReplayCandidate {
  return {
    id: "asset-1",
    title: "Asset 1",
    jobId: "job-1",
    status: "failed",
    dependencyReadiness: {
      ready: true,
      ...overrides.dependencyReadiness
    },
    ...overrides
  };
}

describe("bulk replay utility", () => {
  it("classifies eligible and blocked rows deterministically", () => {
    const rows: BulkReplayCandidate[] = [
      buildRow({ id: "eligible-failed", status: "failed" }),
      buildRow({
        id: "blocked-status",
        status: "processing"
      }),
      buildRow({
        id: "blocked-job-id",
        jobId: null
      }),
      buildRow({
        id: "blocked-readiness",
        dependencyReadiness: { ready: false }
      }),
      buildRow({ id: "eligible-needs-replay", status: "needs_replay" })
    ];

    const preflight = preflightBulkReplay(rows);

    expect(preflight.eligible.map((row) => row.id)).toEqual([
      "eligible-failed",
      "eligible-needs-replay"
    ]);
    expect(preflight.blocked).toEqual([
      {
        row: rows[1],
        reason: "status_not_replayable"
      },
      {
        row: rows[2],
        reason: "missing_job_id"
      },
      {
        row: rows[3],
        reason: "dependency_not_ready"
      }
    ]);
  });

  it("limits eligible rows to max replay batch", () => {
    const rows = Array.from({ length: MAX_BULK_REPLAY_BATCH + 5 }, (_, index) =>
      buildRow({
        id: `asset-${index + 1}`,
        title: `Asset ${index + 1}`,
        jobId: `job-${index + 1}`
      })
    );

    const preflight = preflightBulkReplay(rows);

    expect(MAX_BULK_REPLAY_BATCH).toBe(25);
    expect(preflight.eligible).toHaveLength(MAX_BULK_REPLAY_BATCH);
    expect(preflight.eligible[0]?.id).toBe("asset-1");
    expect(preflight.eligible[MAX_BULK_REPLAY_BATCH - 1]?.id).toBe("asset-25");
    expect(preflight.blocked).toHaveLength(5);
    expect(preflight.blocked.every((item) => item.reason === "batch_limit_exceeded")).toBe(true);
  });

  it("runs eligible rows sequentially in order", async () => {
    const rows = [
      buildRow({ id: "asset-1", jobId: "job-1" }),
      buildRow({ id: "asset-2", jobId: "job-2" }),
      buildRow({ id: "asset-3", jobId: "job-3" })
    ];

    const calls: string[] = [];
    const result = await runBulkReplay(rows, async (row) => {
      calls.push(row.id);
    });

    expect(calls).toEqual(["asset-1", "asset-2", "asset-3"]);
    expect(result.outcomes.map((item) => item.outcome)).toEqual(["replayed", "replayed", "replayed"]);
  });

  it("halts immediately on 429 and marks remaining eligible rows skipped", async () => {
    const rows = [
      buildRow({ id: "asset-1", jobId: "job-1" }),
      buildRow({ id: "asset-2", jobId: "job-2" }),
      buildRow({ id: "asset-3", jobId: "job-3" }),
      buildRow({ id: "blocked", jobId: null })
    ];

    const calls: string[] = [];
    const result = await runBulkReplay(rows, async (row) => {
      calls.push(row.id);
      if (row.id === "asset-2") {
        throw new Error("replay failed: 429 Too Many Requests");
      }
    });

    expect(calls).toEqual(["asset-1", "asset-2"]);
    expect(result.haltedReason).toBe("rate_limited");
    expect(result.outcomes).toEqual([
      { row: rows[0], outcome: "replayed" },
      { row: rows[1], outcome: "failed", error: "replay failed: 429 Too Many Requests" },
      { row: rows[2], outcome: "skipped", reason: "halted_rate_limited" },
      { row: rows[3], outcome: "skipped", reason: "missing_job_id" }
    ]);
  });

  it("does not halt for incidental 429 text that is not rate-limit semantics", async () => {
    const rows = [
      buildRow({ id: "asset-1", jobId: "job-1" }),
      buildRow({ id: "asset-2", jobId: "job-2" }),
      buildRow({ id: "asset-3", jobId: "job-3" })
    ];

    const calls: string[] = [];
    const result = await runBulkReplay(rows, async (row) => {
      calls.push(row.id);
      if (row.id === "asset-2") {
        throw new Error("validation failed for field code 429")
      }
    });

    expect(calls).toEqual(["asset-1", "asset-2", "asset-3"]);
    expect(result.haltedReason).toBeNull();
    expect(result.outcomes).toEqual([
      { row: rows[0], outcome: "replayed" },
      { row: rows[1], outcome: "failed", error: "validation failed for field code 429" },
      { row: rows[2], outcome: "replayed" }
    ]);
  });

  it("halts for structured rate-limit errors with string status code", async () => {
    const rows = [
      buildRow({ id: "asset-1", jobId: "job-1" }),
      buildRow({ id: "asset-2", jobId: "job-2" }),
      buildRow({ id: "asset-3", jobId: "job-3" })
    ];

    const calls: string[] = [];
    const result = await runBulkReplay(rows, async (row) => {
      calls.push(row.id);
      if (row.id === "asset-2") {
        throw {
          status: "429",
          message: "Rate limit exceeded"
        };
      }
    });

    expect(calls).toEqual(["asset-1", "asset-2"]);
    expect(result.haltedReason).toBe("rate_limited");
    expect(result.outcomes).toEqual([
      { row: rows[0], outcome: "replayed" },
      { row: rows[1], outcome: "failed", error: "[object Object]" },
      { row: rows[2], outcome: "skipped", reason: "halted_rate_limited" }
    ]);
  });

  it("continues on non-429 failures and returns deterministic aggregate counts", async () => {
    const rows = [
      buildRow({ id: "asset-1", jobId: "job-1" }),
      buildRow({ id: "asset-2", jobId: "job-2" }),
      buildRow({ id: "asset-3", jobId: null }),
      buildRow({ id: "asset-4", jobId: "job-4" })
    ];

    const result = await runBulkReplay(rows, async (row) => {
      if (row.id === "asset-2") {
        throw new Error("replay failed: 500");
      }
    });

    expect(result.haltedReason).toBeNull();
    expect(result.outcomes).toEqual([
      { row: rows[0], outcome: "replayed" },
      { row: rows[1], outcome: "failed", error: "replay failed: 500" },
      { row: rows[2], outcome: "skipped", reason: "missing_job_id" },
      { row: rows[3], outcome: "replayed" }
    ]);
    expect(result.summary).toEqual({
      replayed: 2,
      failed: 1,
      skipped: 1,
      total: 4
    });
  });
});
