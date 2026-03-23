import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import {
  createLeaseReapingRunner,
  resolveLeaseReapingConfig
} from "../src/reaping/lease-reaping.js";

test("lease reaping config defaults to enabled with 30s interval", () => {
  const config = resolveLeaseReapingConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.intervalSeconds, 30);
});

test("lease reaping config disabled via env var", () => {
  const config = resolveLeaseReapingConfig({
    SPACEHARBOR_LEASE_REAPING_ENABLED: "false"
  });

  assert.equal(config.enabled, false);
});

test("lease reaping config custom interval from env", () => {
  const config = resolveLeaseReapingConfig({
    SPACEHARBOR_LEASE_REAPING_INTERVAL_SECONDS: "60"
  });

  assert.equal(config.intervalSeconds, 60);
});

test("lease reaping config invalid interval falls back to default", () => {
  const config = resolveLeaseReapingConfig({
    SPACEHARBOR_LEASE_REAPING_INTERVAL_SECONDS: "not-a-number"
  });

  assert.equal(config.intervalSeconds, 30);
});

test("reaps expired leases and returns job to pending", async () => {
  const persistence = new LocalPersistenceAdapter();
  await persistence.createIngestAsset(
    { title: "stale-lease", sourceUri: "s3://bucket/stale-lease.mov" },
    { correlationId: "corr-stale", now: "2026-01-01T00:00:00.000Z" }
  );

  // Claim the job with a 10-second lease
  const claimed = await persistence.claimNextJob("worker-1", 10, {
    correlationId: "corr-claim",
    now: "2026-01-01T00:00:10.000Z"
  });
  assert.ok(claimed);
  assert.equal(claimed.status, "processing");

  // Reap 20 seconds after claim — lease has expired
  const runner = createLeaseReapingRunner(persistence, {});
  const summary = await runner.runNow(new Date("2026-01-01T00:00:30.000Z"));

  assert.equal(summary.skipped, false);
  assert.equal(summary.requeuedCount, 1);

  // Job should be back to pending
  const job = await persistence.getJobById(claimed.id);
  assert.ok(job);
  assert.equal(job.status, "pending");
  assert.equal(job.leaseOwner, null);
});

test("skips jobs with valid leases", async () => {
  const persistence = new LocalPersistenceAdapter();
  await persistence.createIngestAsset(
    { title: "valid-lease", sourceUri: "s3://bucket/valid-lease.mov" },
    { correlationId: "corr-valid", now: "2026-01-01T00:00:00.000Z" }
  );

  // Claim with a 60-second lease
  const claimed = await persistence.claimNextJob("worker-1", 60, {
    correlationId: "corr-claim",
    now: "2026-01-01T00:00:10.000Z"
  });
  assert.ok(claimed);

  // Reap only 5 seconds after claim — lease still valid
  const runner = createLeaseReapingRunner(persistence, {});
  const summary = await runner.runNow(new Date("2026-01-01T00:00:15.000Z"));

  assert.equal(summary.skipped, false);
  assert.equal(summary.requeuedCount, 0);

  // Job should still be processing
  const job = await persistence.getJobById(claimed.id);
  assert.ok(job);
  assert.equal(job.status, "processing");
});

test("overlap lock prevents concurrent runs", async () => {
  const persistence = new LocalPersistenceAdapter();
  const runner = createLeaseReapingRunner(persistence, {});

  const [first, second] = await Promise.all([
    runner.runNow(new Date("2026-01-01T00:00:00.000Z")),
    runner.runNow(new Date("2026-01-01T00:00:00.000Z"))
  ]);

  assert.equal(first.skipped || second.skipped, true);
  assert.equal(first.skipped && second.skipped, false);
});

test("heartbeat extends lease and prevents reaping", async () => {
  const persistence = new LocalPersistenceAdapter();
  await persistence.createIngestAsset(
    { title: "heartbeat-test", sourceUri: "s3://bucket/heartbeat.mov" },
    { correlationId: "corr-hb", now: "2026-01-01T00:00:00.000Z" }
  );

  // Claim with a 10-second lease
  const claimed = await persistence.claimNextJob("worker-1", 10, {
    correlationId: "corr-claim",
    now: "2026-01-01T00:00:10.000Z"
  });
  assert.ok(claimed);

  // Heartbeat at T+15 with a fresh 30-second lease (expires at T+45)
  const extended = await persistence.heartbeatJob(claimed.id, "worker-1", 30, {
    correlationId: "corr-hb",
    now: "2026-01-01T00:00:25.000Z"
  });
  assert.ok(extended);

  // Reap at T+30 — lease was extended to T+55, should NOT reap
  const runner = createLeaseReapingRunner(persistence, {});
  const summary = await runner.runNow(new Date("2026-01-01T00:00:40.000Z"));

  assert.equal(summary.skipped, false);
  assert.equal(summary.requeuedCount, 0);

  const job = await persistence.getJobById(claimed.id);
  assert.ok(job);
  assert.equal(job.status, "processing");
});
