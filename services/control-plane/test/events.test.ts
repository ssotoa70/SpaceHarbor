import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

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
