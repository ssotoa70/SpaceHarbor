import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("POST /api/v1/events/vast-dataengine: completion event updates job status", async () => {
  const app = buildApp();
  await app.ready();

  // Ingest + claim
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    body: { title: "frame.exr", sourceUri: "file:///vast/frame.exr" },
  });
  assert.equal(ingestRes.statusCode, 201);
  const { job } = ingestRes.json();

  await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    body: { workerId: "w", leaseSeconds: 30 },
  });

  // Post mock DataEngine completion event
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/events/vast-dataengine",
    body: {
      specversion: "1.0",
      type: "vast.dataengine.pipeline.completed",
      source: "dev-simulation/media-worker",
      id: "evt-dev-001",
      time: new Date().toISOString(),
      data: {
        asset_id: job.assetId,
        job_id: job.id,
        function_id: "exr_inspector",
        success: true,
        metadata: { codec: "exr", resolution: { width: 4096, height: 2160 } },
      },
    },
  });
  assert.equal(res.statusCode, 200);

  const jobRes = await app.inject({ method: "GET", url: `/api/v1/jobs/${job.id}` });
  assert.equal(jobRes.json().status, "completed");

  await app.close();
});

test("POST /api/v1/events/vast-dataengine: rejects invalid event shape", async () => {
  const app = buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/events/vast-dataengine",
    body: { type: "wrong.event.type", data: {} },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});
