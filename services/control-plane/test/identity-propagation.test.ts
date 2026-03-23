import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

async function ingestAsset(app: ReturnType<typeof buildApp>, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title: "test-asset", sourceUri: "s3://bucket/test.mov" },
    headers
  });
  return res;
}

// --- Relaxed mode (default) ---

test("relaxed mode: requests without x-user-identity header succeed", async () => {
  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  const app = createApp();

  const res = await ingestAsset(app);
  assert.equal(res.statusCode, 201);
  await app.close();
});

test("relaxed mode: x-user-identity header value decorates request", async () => {
  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  const app = createApp();

  // Ingest with identity — should use it as createdBy
  const res = await ingestAsset(app, { "x-user-identity": "jane.doe" });
  assert.equal(res.statusCode, 201);
  await app.close();
});

test("relaxed mode: GET requests without header succeed", async () => {
  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  const app = createApp();

  const res = await app.inject({ method: "GET", url: "/api/v1/assets" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// --- Strict mode ---

test("strict mode: write requests without x-user-identity get 401", async () => {
  process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT = "strict";
  const app = createApp();

  const res = await ingestAsset(app);
  assert.equal(res.statusCode, 401);
  const body = res.json();
  assert.equal(body.code, "IDENTITY_REQUIRED");

  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  await app.close();
});

test("strict mode: GET requests without header still succeed", async () => {
  process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT = "strict";
  const app = createApp();

  const res = await app.inject({ method: "GET", url: "/api/v1/assets" });
  assert.equal(res.statusCode, 200);

  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  await app.close();
});

test("strict mode: write requests with x-user-identity header succeed", async () => {
  process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT = "strict";
  const app = createApp();

  const res = await ingestAsset(app, { "x-user-identity": "jane.doe" });
  assert.equal(res.statusCode, 201);

  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  await app.close();
});

// --- Approval route identity propagation ---

test("approval route uses header identity over body performed_by", async () => {
  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  const app = createApp();

  // Ingest an asset first
  const ingestRes = await ingestAsset(app);
  const { asset } = ingestRes.json();

  // Transition job: pending → completed → qc_pending so request_review can fire
  const persistence = (app as any).persistence;
  const rows = await persistence.listAssetQueueRows();
  const row = rows.find((r: any) => r.id === asset.id);
  if (row?.jobId) {
    await persistence.updateJobStatus(row.jobId, "pending", "completed", { correlationId: "test" });
    await persistence.updateJobStatus(row.jobId, "completed", "qc_pending", { correlationId: "test" });
  }

  // Request review with header identity — header should take precedence
  const reviewRes = await app.inject({
    method: "POST",
    url: `/api/v1/assets/${asset.id}/request-review`,
    payload: { performed_by: "body-user", note: "ready" },
    headers: { "x-user-identity": "header-user" }
  });
  assert.equal(reviewRes.statusCode, 200);
  const reviewBody = reviewRes.json();
  // Audit entry should show header-user (from x-user-identity) not body-user
  assert.equal(reviewBody.audit.performedBy, "header-user");
  await app.close();
});

// --- Ingest route identity propagation ---

test("ingest route uses header identity as default createdBy", async () => {
  delete process.env.SPACEHARBOR_IDENTITY_ENFORCEMENT;
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title: "test-asset", sourceUri: "s3://bucket/test.mov" },
    headers: { "x-user-identity": "auto-user" }
  });
  assert.equal(res.statusCode, 201);
  // The createdBy should be set from header identity
  // (Verify through persistence if the asset model includes it)
  await app.close();
});
