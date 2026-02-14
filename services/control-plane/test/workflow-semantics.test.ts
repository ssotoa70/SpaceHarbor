import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence";

function context(correlationId: string) {
  return { correlationId };
}

test("completed jobs reject non-terminal transitions", () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = persistence.createIngestAsset(
    {
      title: "completed-transition-guard",
      sourceUri: "s3://bucket/completed-transition-guard.mov"
    },
    context("corr-completed-transition-1")
  );

  const processing = persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-completed-transition-2"));
  assert.equal(processing?.status, "processing");

  const completed = persistence.setJobStatus(ingest.job.id, "completed", null, context("corr-completed-transition-3"));
  assert.equal(completed?.status, "completed");

  const invalid = persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-completed-transition-4"));
  assert.equal(invalid, null);

  const job = persistence.getJobById(ingest.job.id);
  assert.equal(job?.status, "completed");
});

test("failed jobs reject transition back to processing", () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = persistence.createIngestAsset(
    {
      title: "failed-transition-guard",
      sourceUri: "s3://bucket/failed-transition-guard.mov"
    },
    context("corr-failed-transition-1")
  );

  const failed = persistence.setJobStatus(ingest.job.id, "failed", "media worker error", context("corr-failed-transition-2"));
  assert.equal(failed?.status, "failed");

  const invalid = persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-failed-transition-3"));
  assert.equal(invalid, null);

  const job = persistence.getJobById(ingest.job.id);
  assert.equal(job?.status, "failed");
});

test("same-state updates remain idempotent", () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = persistence.createIngestAsset(
    {
      title: "idempotent-state-update",
      sourceUri: "s3://bucket/idempotent-state-update.mov"
    },
    context("corr-idempotent-update-1")
  );

  const pending = persistence.setJobStatus(ingest.job.id, "pending", null, context("corr-idempotent-update-2"));
  assert.equal(pending?.status, "pending");
});
