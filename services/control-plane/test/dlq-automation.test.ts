import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

async function ingestAsset(app: ReturnType<typeof buildApp>, title: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title, sourceUri: `s3://bucket/${title}.mov` }
  });
  assert.equal(res.statusCode, 201);
  return res.json() as { asset: { id: string }; job: { id: string } };
}

async function claimAndFail(
  app: ReturnType<typeof buildApp>,
  assetId: string,
  jobId: string,
  attempt: number
) {
  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: `worker-${attempt}`,
      leaseSeconds: 15,
      now: new Date(Date.now() + attempt * 60_000).toISOString()
    }
  });
  assert.equal(claim.statusCode, 200, `claim attempt ${attempt} failed`);

  const failed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: `evt-dlq-${jobId}-${attempt}`,
      eventType: "asset.processing.failed",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: `corr-dlq-${attempt}`,
      producer: "media-worker",
      data: { assetId, jobId, error: `failure-attempt-${attempt}` }
    }
  });
  assert.equal(failed.statusCode, 202, `event attempt ${attempt} failed`);
  return failed.json() as { retryScheduled: boolean; movedToDlq: boolean };
}

async function exhaustRetries(app: ReturnType<typeof buildApp>, title: string) {
  const { asset, job } = await ingestAsset(app, title);
  for (let i = 1; i <= 3; i++) {
    const result = await claimAndFail(app, asset.id, job.id, i);
    if (i < 3) {
      assert.equal(result.retryScheduled, true);
      assert.equal(result.movedToDlq, false);
    } else {
      assert.equal(result.retryScheduled, false);
      assert.equal(result.movedToDlq, true);
    }
  }
  return { assetId: asset.id, jobId: job.id };
}

test("GET /api/v1/dlq returns empty list initially", async () => {
  const app = createApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().items, []);
  await app.close();
});

test("GET /api/v1/dlq/:jobId returns 404 for unknown job", async () => {
  const app = createApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/dlq/unknown-job" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("POST /api/v1/dlq/:jobId/replay returns 404 for unknown job", async () => {
  const app = createApp();
  const res = await app.inject({ method: "POST", url: "/api/v1/dlq/unknown-job/replay" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("DLQ item appears after max retries exhausted", async () => {
  const app = createApp();
  const { jobId } = await exhaustRetries(app, "dlq-exhaust");

  const dlqRes = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.equal(dlqRes.statusCode, 200);
  const items = dlqRes.json().items;
  const dlqItem = items.find((item: { jobId: string }) => item.jobId === jobId);
  assert.ok(dlqItem, "Expected DLQ item for the failed job");
  assert.equal(dlqItem.attemptCount, 3);
  assert.ok(dlqItem.failedAt);
  await app.close();
});

test("GET /api/v1/dlq/:jobId returns specific DLQ item", async () => {
  const app = createApp();
  const { jobId } = await exhaustRetries(app, "dlq-get");

  const res = await app.inject({ method: "GET", url: `/api/v1/dlq/${jobId}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().jobId, jobId);
  await app.close();
});

test("POST /api/v1/dlq/:jobId/replay moves job back to pending", async () => {
  const app = createApp();
  const { jobId } = await exhaustRetries(app, "dlq-replay");

  // Replay
  const replayRes = await app.inject({ method: "POST", url: `/api/v1/dlq/${jobId}/replay` });
  assert.equal(replayRes.statusCode, 200);
  const body = replayRes.json();
  assert.equal(body.replayed, true);
  assert.equal(body.job.status, "pending");
  assert.equal(body.job.attemptCount, 0);

  // DLQ item should be gone
  const dlqAfter = await app.inject({ method: "GET", url: `/api/v1/dlq/${jobId}` });
  assert.equal(dlqAfter.statusCode, 404);
  await app.close();
});

test("POST /api/v1/dlq/replay-all replays all DLQ items", async () => {
  const app = createApp();
  await exhaustRetries(app, "dlq-bulk-a");
  await exhaustRetries(app, "dlq-bulk-b");

  const before = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.equal(before.json().items.length, 2);

  const res = await app.inject({ method: "POST", url: "/api/v1/dlq/replay-all" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().replayedCount, 2);

  const after = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.deepEqual(after.json().items, []);
  await app.close();
});

test("DELETE /api/v1/dlq/purge requires before parameter", async () => {
  const app = createApp();
  const res = await app.inject({ method: "DELETE", url: "/api/v1/dlq/purge" });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("DELETE /api/v1/dlq/purge removes items older than cutoff", async () => {
  const app = createApp();
  await exhaustRetries(app, "dlq-purge");

  const purgeRes = await app.inject({
    method: "DELETE",
    url: "/api/v1/dlq/purge?before=2099-01-01T00:00:00.000Z"
  });
  assert.equal(purgeRes.statusCode, 200);
  assert.ok(purgeRes.json().purgedCount >= 1);

  const after = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.deepEqual(after.json().items, []);
  await app.close();
});

test("DELETE /api/v1/dlq/purge with past cutoff does not remove recent items", async () => {
  const app = createApp();
  await exhaustRetries(app, "dlq-purge-noop");

  const purgeRes = await app.inject({
    method: "DELETE",
    url: "/api/v1/dlq/purge?before=2020-01-01T00:00:00.000Z"
  });
  assert.equal(purgeRes.statusCode, 200);
  assert.equal(purgeRes.json().purgedCount, 0);

  const after = await app.inject({ method: "GET", url: "/api/v1/dlq" });
  assert.ok(after.json().items.length >= 1);
  await app.close();
});
