import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("POST /api/v1/queue/claim returns sourceUri in job response", async () => {
  const app = buildApp();
  await app.ready();

  // First ingest an asset to create a job
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "test.exr", sourceUri: "file:///vast/renders/test.exr" },
  });
  assert.equal(ingestRes.statusCode, 201);

  // Claim the job
  const claimRes = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "worker-1", leaseSeconds: 30 },
  });
  assert.equal(claimRes.statusCode, 200);
  const body = claimRes.json();
  assert.ok(body.job, "job should not be null");
  assert.equal(body.job.sourceUri, "file:///vast/renders/test.exr");

  await app.close();
});
