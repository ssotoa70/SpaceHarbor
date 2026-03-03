import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

test("POST /events applies workflow status transitions", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Status Demo",
      sourceUri: "s3://bucket/status-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const started = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-started-1",
      event_type: "asset.processing.started",
      asset_id: ingestBody.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "media-worker",
      schema_version: "1.0",
      data: {
        job_id: ingestBody.job.id
      }
    }
  });

  assert.equal(started.statusCode, 202);

  const jobAfterStarted = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterStarted.statusCode, 200);
  assert.equal(jobAfterStarted.json().status, "processing");

  const failed = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-failed-1",
      event_type: "asset.processing.failed",
      asset_id: ingestBody.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "media-worker",
      schema_version: "1.0",
      data: {
        job_id: ingestBody.job.id,
        error: "ffmpeg timeout"
      }
    }
  });

  assert.equal(failed.statusCode, 202);

  const jobAfterFailed = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterFailed.json().status, "failed");

  const replay = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-replay-1",
      event_type: "asset.processing.replay_requested",
      asset_id: ingestBody.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "operator",
      schema_version: "1.0",
      data: {
        job_id: ingestBody.job.id
      }
    }
  });

  assert.equal(replay.statusCode, 202);

  const jobAfterReplay = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterReplay.json().status, "needs_replay");

  const completed = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-completed-1",
      event_type: "asset.processing.completed",
      asset_id: ingestBody.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "media-worker",
      schema_version: "1.0",
      data: {
        job_id: ingestBody.job.id
      }
    }
  });

  assert.equal(completed.statusCode, 202);

  const jobAfterCompleted = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(jobAfterCompleted.json().status, "completed");

  await app.close();
});

test("POST /events is idempotent by event_id", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Idempotency Demo",
      sourceUri: "s3://bucket/idempotency-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const payload = {
    event_id: "evt-same-1",
    event_type: "asset.processing.started",
    asset_id: ingestBody.asset.id,
    occurred_at: new Date().toISOString(),
    producer: "media-worker",
    schema_version: "1.0",
    data: {
      job_id: ingestBody.job.id
    }
  };

  const first = await app.inject({ method: "POST", url: "/events", payload });
  assert.equal(first.statusCode, 202);
  assert.equal(first.json().duplicate, false);

  const second = await app.inject({ method: "POST", url: "/events", payload });
  assert.equal(second.statusCode, 202);
  assert.equal(second.json().duplicate, true);

  await app.close();
});

test("POST /events applies review and QC lifecycle transitions", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "QC Transition Demo",
      sourceUri: "s3://bucket/qc-transition-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  for (const [eventId, eventType] of [
    ["evt-qc-completed-1", "asset.processing.completed"],
    ["evt-qc-pending-1", "asset.review.qc_pending"],
    ["evt-qc-in-review-1", "asset.review.in_review"],
    ["evt-qc-rejected-1", "asset.review.rejected"]
  ] as const) {
    const transition = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        event_id: eventId,
        event_type: eventType,
        asset_id: ingestBody.asset.id,
        occurred_at: new Date().toISOString(),
        producer: "post-qc",
        schema_version: "1.0",
        data: {
          job_id: ingestBody.job.id
        }
      }
    });

    assert.equal(transition.statusCode, 202);
  }

  const rejectedJob = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(rejectedJob.statusCode, 200);
  assert.equal(rejectedJob.json().status, "qc_rejected");

  const needsReplay = await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-qc-needs-replay-1",
      event_type: "asset.processing.replay_requested",
      asset_id: ingestBody.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "operator",
      schema_version: "1.0",
      data: {
        job_id: ingestBody.job.id
      }
    }
  });

  assert.equal(needsReplay.statusCode, 202);

  const replayJob = await app.inject({
    method: "GET",
    url: `/jobs/${ingestBody.job.id}`
  });
  assert.equal(replayJob.statusCode, 200);
  assert.equal(replayJob.json().status, "needs_replay");

  await app.close();
});
