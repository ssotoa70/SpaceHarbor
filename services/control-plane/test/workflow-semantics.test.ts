import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { canTransitionWorkflowStatus } from "../src/workflow/transitions.js";

function context(correlationId: string) {
  return { correlationId };
}

test("completed jobs reject non-terminal transitions", async () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = await persistence.createIngestAsset(
    {
      title: "completed-transition-guard",
      sourceUri: "s3://bucket/completed-transition-guard.mov"
    },
    context("corr-completed-transition-1")
  );

  const processing = await persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-completed-transition-2"));
  assert.equal(processing?.status, "processing");

  const completed = await persistence.setJobStatus(ingest.job.id, "completed", null, context("corr-completed-transition-3"));
  assert.equal(completed?.status, "completed");

  const invalid = await persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-completed-transition-4"));
  assert.equal(invalid, null);

  const job = await persistence.getJobById(ingest.job.id);
  assert.equal(job?.status, "completed");
});

test("failed jobs reject transition back to processing", async () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = await persistence.createIngestAsset(
    {
      title: "failed-transition-guard",
      sourceUri: "s3://bucket/failed-transition-guard.mov"
    },
    context("corr-failed-transition-1")
  );

  const failed = await persistence.setJobStatus(ingest.job.id, "failed", "media worker error", context("corr-failed-transition-2"));
  assert.equal(failed?.status, "failed");

  const invalid = await persistence.setJobStatus(ingest.job.id, "processing", null, context("corr-failed-transition-3"));
  assert.equal(invalid, null);

  const job = await persistence.getJobById(ingest.job.id);
  assert.equal(job?.status, "failed");
});

test("same-state updates remain idempotent", async () => {
  const persistence = new LocalPersistenceAdapter();
  const ingest = await persistence.createIngestAsset(
    {
      title: "idempotent-state-update",
      sourceUri: "s3://bucket/idempotent-state-update.mov"
    },
    context("corr-idempotent-update-1")
  );

  const pending = await persistence.setJobStatus(ingest.job.id, "pending", null, context("corr-idempotent-update-2"));
  assert.equal(pending?.status, "pending");
});

test("replay endpoint is blocked when replay is disabled", async () => {
  const previousReplayEnabled = process.env.SPACEHARBOR_REPLAY_ENABLED;
  process.env.SPACEHARBOR_REPLAY_ENABLED = "false";

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
    delete process.env.SPACEHARBOR_REPLAY_ENABLED;
  } else {
    process.env.SPACEHARBOR_REPLAY_ENABLED = previousReplayEnabled;
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
  const previousReplayMax = process.env.SPACEHARBOR_REPLAY_MAX_PER_MINUTE;
  process.env.SPACEHARBOR_REPLAY_MAX_PER_MINUTE = "1";

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
    delete process.env.SPACEHARBOR_REPLAY_MAX_PER_MINUTE;
  } else {
    process.env.SPACEHARBOR_REPLAY_MAX_PER_MINUTE = previousReplayMax;
  }
});

test("review/QC transitions allow expected progression", () => {
  assert.equal(canTransitionWorkflowStatus("completed", "qc_pending"), true);
  assert.equal(canTransitionWorkflowStatus("qc_pending", "qc_in_review"), true);
  assert.equal(canTransitionWorkflowStatus("qc_in_review", "qc_approved"), true);
  assert.equal(canTransitionWorkflowStatus("qc_in_review", "qc_rejected"), true);
  assert.equal(canTransitionWorkflowStatus("qc_rejected", "needs_replay"), true);
});

test("review/QC transitions block invalid jumps", () => {
  assert.equal(canTransitionWorkflowStatus("pending", "qc_in_review"), false);
  assert.equal(canTransitionWorkflowStatus("processing", "qc_approved"), false);
});

// ---------------------------------------------------------------------------
// Extended state machine: revision_required, retake, client workflow
// ---------------------------------------------------------------------------

test("revision_required transition from qc_in_review", () => {
  assert.equal(canTransitionWorkflowStatus("qc_in_review", "revision_required"), true);
});

test("retake transition from revision_required", () => {
  assert.equal(canTransitionWorkflowStatus("revision_required", "retake"), true);
});

test("retake returns to pending for re-processing", () => {
  assert.equal(canTransitionWorkflowStatus("retake", "pending"), true);
});

test("client_submitted transition from qc_approved", () => {
  assert.equal(canTransitionWorkflowStatus("qc_approved", "client_submitted"), true);
});

test("client_approved and client_rejected from client_submitted", () => {
  assert.equal(canTransitionWorkflowStatus("client_submitted", "client_approved"), true);
  assert.equal(canTransitionWorkflowStatus("client_submitted", "client_rejected"), true);
});

test("client_rejected can transition to revision_required", () => {
  assert.equal(canTransitionWorkflowStatus("client_rejected", "revision_required"), true);
});

test("client_approved is terminal", () => {
  assert.equal(canTransitionWorkflowStatus("client_approved", "pending"), false);
  assert.equal(canTransitionWorkflowStatus("client_approved", "qc_in_review"), false);
});

test("extended state machine blocks invalid jumps", () => {
  assert.equal(canTransitionWorkflowStatus("pending", "revision_required"), false);
  assert.equal(canTransitionWorkflowStatus("revision_required", "qc_approved"), false);
  assert.equal(canTransitionWorkflowStatus("retake", "client_submitted"), false);
  assert.equal(canTransitionWorkflowStatus("qc_rejected", "client_submitted"), false);
});
