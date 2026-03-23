import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

test("concurrent claimNextJob produces exactly one winner per job", async () => {
  const persistence = new LocalPersistenceAdapter();

  // Create a single job
  await persistence.createIngestAsset(
    { title: "cas-test", sourceUri: "s3://bucket/cas-test.mov" },
    { correlationId: "corr-cas", now: "2026-01-01T00:00:00.000Z" }
  );

  // 10 workers race to claim the single job
  const claimResults = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      persistence.claimNextJob(`worker-${i}`, 30, {
        correlationId: `corr-claim-${i}`,
        now: "2026-01-01T00:00:01.000Z"
      })
    )
  );

  const winners = claimResults.filter((r) => r !== null);
  assert.equal(winners.length, 1, "Exactly one worker should win the claim");
  assert.equal(winners[0]!.status, "processing");
  assert.ok(winners[0]!.leaseOwner?.startsWith("worker-"));
});

test("concurrent claims on multiple jobs award each job to exactly one worker", async () => {
  const persistence = new LocalPersistenceAdapter();
  const jobCount = 5;
  const workerCount = 20;

  // Create multiple jobs
  for (let i = 0; i < jobCount; i++) {
    await persistence.createIngestAsset(
      { title: `multi-cas-${i}`, sourceUri: `s3://bucket/multi-cas-${i}.mov` },
      { correlationId: `corr-multi-${i}`, now: "2026-01-01T00:00:00.000Z" }
    );
  }

  // 20 workers race to claim
  const claimResults = await Promise.all(
    Array.from({ length: workerCount }, (_, i) =>
      persistence.claimNextJob(`worker-${i}`, 30, {
        correlationId: `corr-claim-${i}`,
        now: "2026-01-01T00:00:01.000Z"
      })
    )
  );

  const winners = claimResults.filter((r) => r !== null);
  assert.equal(winners.length, jobCount, `Expected ${jobCount} claims for ${jobCount} jobs`);

  // Each job should be claimed by exactly one worker
  const claimedJobIds = new Set(winners.map((w) => w!.id));
  assert.equal(claimedJobIds.size, jobCount, "Each job should be claimed exactly once");

  // Each claimed job should have a unique leaseOwner
  const leaseOwners = new Set(winners.map((w) => w!.leaseOwner));
  assert.equal(leaseOwners.size, jobCount, "Each claim should have a different worker");
});

test("updateJobStatus CAS rejects stale status", async () => {
  const persistence = new LocalPersistenceAdapter();

  const { job } = await persistence.createIngestAsset(
    { title: "cas-update", sourceUri: "s3://bucket/cas-update.mov" },
    { correlationId: "corr-cas-upd", now: "2026-01-01T00:00:00.000Z" }
  );

  // Try to update with wrong expected status
  const result = await persistence.updateJobStatus(job.id, "processing", "completed", {
    correlationId: "corr-wrong",
    now: "2026-01-01T00:00:01.000Z"
  });

  assert.equal(result, false, "CAS should reject when expected status does not match");

  // Verify job status unchanged
  const current = await persistence.getJobById(job.id);
  assert.ok(current);
  assert.equal(current.status, "pending");
});

test("updateJobStatus CAS succeeds with matching status", async () => {
  const persistence = new LocalPersistenceAdapter();

  const { job } = await persistence.createIngestAsset(
    { title: "cas-success", sourceUri: "s3://bucket/cas-success.mov" },
    { correlationId: "corr-cas-ok", now: "2026-01-01T00:00:00.000Z" }
  );

  // Claim the job first
  const claimed = await persistence.claimNextJob("worker-1", 30, {
    correlationId: "corr-claim",
    now: "2026-01-01T00:00:01.000Z"
  });
  assert.ok(claimed);

  // CAS update with correct expected status
  const result = await persistence.updateJobStatus(claimed.id, "processing", "completed", {
    correlationId: "corr-cas-ok",
    now: "2026-01-01T00:00:02.000Z"
  });

  assert.equal(result, true, "CAS should succeed when expected status matches");

  const current = await persistence.getJobById(claimed.id);
  assert.ok(current);
  assert.equal(current.status, "completed");
});

test("rapid sequential claims drain queue correctly", async () => {
  const persistence = new LocalPersistenceAdapter();
  const jobCount = 50;

  for (let i = 0; i < jobCount; i++) {
    await persistence.createIngestAsset(
      { title: `drain-${i}`, sourceUri: `s3://bucket/drain-${i}.mov` },
      { correlationId: `corr-drain-${i}`, now: "2026-01-01T00:00:00.000Z" }
    );
  }

  const claimed: string[] = [];
  for (let i = 0; i < jobCount + 5; i++) {
    const result = await persistence.claimNextJob(`worker-${i}`, 30, {
      correlationId: `corr-seq-${i}`,
      now: "2026-01-01T00:00:01.000Z"
    });
    if (result) {
      claimed.push(result.id);
    }
  }

  assert.equal(claimed.length, jobCount, `Should claim exactly ${jobCount} jobs`);
  assert.equal(new Set(claimed).size, jobCount, "All claimed job IDs should be unique");

  // Queue should be empty
  const extra = await persistence.claimNextJob("extra-worker", 30, {
    correlationId: "corr-extra",
    now: "2026-01-01T00:00:02.000Z"
  });
  assert.equal(extra, null, "No more jobs should be available");
});

test("double-claim by same worker is prevented", async () => {
  const persistence = new LocalPersistenceAdapter();

  await persistence.createIngestAsset(
    { title: "double-claim", sourceUri: "s3://bucket/double.mov" },
    { correlationId: "corr-double", now: "2026-01-01T00:00:00.000Z" }
  );

  const first = await persistence.claimNextJob("worker-1", 30, {
    correlationId: "corr-first",
    now: "2026-01-01T00:00:01.000Z"
  });
  assert.ok(first);

  // Same worker tries again — no more jobs
  const second = await persistence.claimNextJob("worker-1", 30, {
    correlationId: "corr-second",
    now: "2026-01-01T00:00:02.000Z"
  });
  assert.equal(second, null, "Same worker should not double-claim");
});
