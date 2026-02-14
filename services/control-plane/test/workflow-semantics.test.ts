import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";
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

test("replay endpoint is blocked when replay is disabled", async () => {
  const previousReplayEnabled = process.env.ASSETHARBOR_REPLAY_ENABLED;
  process.env.ASSETHARBOR_REPLAY_ENABLED = "false";

  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "replay-disabled",
      sourceUri: "s3://bucket/replay-disabled.mov"
    }
  });

  const replay = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingest.json().job.id}/replay`
  });

  assert.equal(replay.statusCode, 403);
  assert.equal(replay.json().code, "REPLAY_DISABLED");

  await app.close();
  if (previousReplayEnabled === undefined) {
    delete process.env.ASSETHARBOR_REPLAY_ENABLED;
  } else {
    process.env.ASSETHARBOR_REPLAY_ENABLED = previousReplayEnabled;
  }
});

test("replay endpoint rejects jobs that are not failed or needs_replay", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "replay-status-guard",
      sourceUri: "s3://bucket/replay-status-guard.mov"
    }
  });

  const replay = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingest.json().job.id}/replay`
  });

  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().code, "REPLAY_NOT_ALLOWED");

  await app.close();
});

test("replay endpoint enforces replay rate limit", async () => {
  const previousReplayMax = process.env.ASSETHARBOR_REPLAY_MAX_PER_MINUTE;
  process.env.ASSETHARBOR_REPLAY_MAX_PER_MINUTE = "1";

  const app = buildApp();

  const ingestOne = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "replay-rate-limit-one",
      sourceUri: "s3://bucket/replay-rate-limit-one.mov"
    }
  });

  const ingestTwo = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "replay-rate-limit-two",
      sourceUri: "s3://bucket/replay-rate-limit-two.mov"
    }
  });

  for (const [eventId, jobId, assetId] of [
    ["evt-rate-fail-1", ingestOne.json().job.id, ingestOne.json().asset.id],
    ["evt-rate-fail-2", ingestTwo.json().job.id, ingestTwo.json().asset.id]
  ] as const) {
    const failed = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        event_id: eventId,
        event_type: "asset.processing.failed",
        asset_id: assetId,
        occurred_at: new Date().toISOString(),
        producer: "media-worker",
        schema_version: "1.0",
        data: {
          job_id: jobId,
          error: "rate-limit-test-failure"
        }
      }
    });

    assert.equal(failed.statusCode, 202);
  }

  const firstReplay = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingestOne.json().job.id}/replay`
  });
  assert.equal(firstReplay.statusCode, 202);

  const secondReplay = await app.inject({
    method: "POST",
    url: `/api/v1/jobs/${ingestTwo.json().job.id}/replay`
  });
  assert.equal(secondReplay.statusCode, 429);
  assert.equal(secondReplay.json().code, "RATE_LIMITED");

  await app.close();
  if (previousReplayMax === undefined) {
    delete process.env.ASSETHARBOR_REPLAY_MAX_PER_MINUTE;
  } else {
    process.env.ASSETHARBOR_REPLAY_MAX_PER_MINUTE = previousReplayMax;
  }
});
