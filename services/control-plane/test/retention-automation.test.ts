import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence";
import {
  computeAuditRetentionCutoffIso,
  createAuditRetentionRunner,
  resolveAuditRetentionConfig
} from "../src/retention/audit-retention";

test("audit retention config defaults to enabled dry-run mode", () => {
  const config = resolveAuditRetentionConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.mode, "dry-run");
  assert.equal(config.retentionDays, 90);
  assert.equal(config.intervalSeconds, 3600);
});

test("audit retention config falls back to dry-run for invalid mode", () => {
  const config = resolveAuditRetentionConfig({
    ASSETHARBOR_AUDIT_RETENTION_MODE: "invalid"
  });

  assert.equal(config.mode, "dry-run");
});

test("audit retention runner executes preview in dry-run mode", async () => {
  const persistence = new LocalPersistenceAdapter();
  persistence.createIngestAsset(
    {
      title: "retention-preview",
      sourceUri: "s3://bucket/retention-preview.mov"
    },
    { correlationId: "corr-retention-preview", now: "2025-10-01T00:00:00.000Z" }
  );

  const runner = createAuditRetentionRunner(persistence, {
    ASSETHARBOR_AUDIT_RETENTION_MODE: "dry-run",
    ASSETHARBOR_AUDIT_RETENTION_DAYS: "90"
  });

  const summary = await runner.runNow(new Date("2026-02-01T00:00:00.000Z"));
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.skipped, false);
  assert.equal(summary.eligibleCount, 1);
});

test("audit retention runner executes apply in apply mode", async () => {
  const persistence = new LocalPersistenceAdapter();
  persistence.createIngestAsset(
    {
      title: "retention-apply",
      sourceUri: "s3://bucket/retention-apply.mov"
    },
    { correlationId: "corr-retention-apply", now: "2025-10-01T00:00:00.000Z" }
  );

  const runner = createAuditRetentionRunner(persistence, {
    ASSETHARBOR_AUDIT_RETENTION_MODE: "apply",
    ASSETHARBOR_AUDIT_RETENTION_DAYS: "90"
  });

  const summary = await runner.runNow(new Date("2026-02-01T00:00:00.000Z"));
  assert.equal(summary.mode, "apply");
  assert.equal(summary.skipped, false);
  assert.equal(summary.deletedCount, 1);
  assert.equal(summary.remainingCount, 0);
});

test("audit retention runner overlap lock skips concurrent invocation", async () => {
  const persistence = new LocalPersistenceAdapter();
  const runner = createAuditRetentionRunner(persistence, {
    ASSETHARBOR_AUDIT_RETENTION_MODE: "dry-run"
  });

  const [first, second] = await Promise.all([
    runner.runNow(new Date("2026-02-01T00:00:00.000Z")),
    runner.runNow(new Date("2026-02-01T00:00:00.000Z"))
  ]);

  assert.equal(first.skipped || second.skipped, true);
  assert.equal(first.skipped && second.skipped, false);
});

test("audit retention runner exposes disabled config state", () => {
  const persistence = new LocalPersistenceAdapter();
  const runner = createAuditRetentionRunner(persistence, {
    ASSETHARBOR_AUDIT_RETENTION_ENABLED: "false"
  });

  assert.equal(runner.config.enabled, false);
});

test("audit retention cutoff uses day-based subtraction", () => {
  const cutoff = computeAuditRetentionCutoffIso(new Date("2026-02-01T00:00:00.000Z"), 90);
  assert.equal(cutoff, "2025-11-03T00:00:00.000Z");
});
