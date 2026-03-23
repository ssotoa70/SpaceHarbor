import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

function buildTestApp() {
  const persistence = new LocalPersistenceAdapter();
  persistence.reset();
  const app = buildApp({ persistenceAdapter: persistence });
  return { app, persistence };
}

/**
 * Ingest an asset, then use persistence directly to advance:
 * pending -> processing -> completed -> qc_pending
 */
async function ingestAndAdvanceToQcPending(
  app: ReturnType<typeof buildApp>,
  persistence: LocalPersistenceAdapter
) {
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title: "Test EXR", sourceUri: "s3://bucket/test.exr" },
  });
  const { asset, job } = ingestRes.json() as {
    asset: { id: string };
    job: { id: string };
  };

  const ctx = { correlationId: "test-advance" };

  // pending -> processing
  persistence.setJobStatus(job.id, "processing", null, ctx);
  // processing -> completed
  persistence.setJobStatus(job.id, "completed", null, ctx);
  // completed -> qc_pending
  persistence.setJobStatus(job.id, "qc_pending", null, ctx);

  return { assetId: asset.id, jobId: job.id };
}

test("request-review transitions qc_pending -> qc_in_review", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  const res = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/request-review`,
    payload: { performed_by: "supervisor_jane" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { asset: { status: string }; audit: { action: string; performedBy: string } };
  assert.equal(body.asset.status, "qc_in_review");
  assert.equal(body.audit.action, "request_review");
  assert.equal(body.audit.performedBy, "supervisor_jane");
  await app.close();
});

test("approve transitions qc_in_review -> qc_approved", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  await app.inject({
    method: "POST",
    url: `/assets/${assetId}/request-review`,
    payload: { performed_by: "supervisor_jane" },
  });

  const res = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/approve`,
    payload: { performed_by: "reviewer_bob", note: "Looks great" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { asset: { status: string }; audit: { action: string; note: string } };
  assert.equal(body.asset.status, "qc_approved");
  assert.equal(body.audit.action, "approve");
  assert.equal(body.audit.note, "Looks great");
  await app.close();
});

test("reject transitions qc_in_review -> qc_rejected", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  await app.inject({
    method: "POST",
    url: `/assets/${assetId}/request-review`,
    payload: { performed_by: "supervisor_jane" },
  });

  const res = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/reject`,
    payload: { performed_by: "reviewer_bob", reason: "Color space mismatch" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { asset: { status: string }; audit: { action: string; note: string } };
  assert.equal(body.asset.status, "qc_rejected");
  assert.equal(body.audit.action, "reject");
  assert.equal(body.audit.note, "Color space mismatch");
  await app.close();
});

test("cannot approve asset in qc_pending status (guard)", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  const res = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/approve`,
    payload: { performed_by: "reviewer_bob" },
  });

  assert.equal(res.statusCode, 409);
  const body = res.json() as { code: string; message: string };
  assert.equal(body.code, "WRONG_STATUS");
  assert.ok(body.message.includes("qc_pending"));
  await app.close();
});

test("cannot reject asset in pending status (guard)", async () => {
  const { app } = buildTestApp();

  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title: "Raw Asset", sourceUri: "s3://bucket/raw.exr" },
  });
  const { asset } = ingestRes.json() as { asset: { id: string } };

  const res = await app.inject({
    method: "POST",
    url: `/assets/${asset.id}/reject`,
    payload: { performed_by: "reviewer_bob", reason: "Bad asset" },
  });

  assert.equal(res.statusCode, 409);
  const body = res.json() as { code: string };
  assert.equal(body.code, "WRONG_STATUS");
  await app.close();
});

test("approval-queue returns only qc_in_review assets", async () => {
  const { app, persistence } = buildTestApp();

  const { assetId: id1 } = await ingestAndAdvanceToQcPending(app, persistence);
  const { assetId: id2 } = await ingestAndAdvanceToQcPending(app, persistence);

  // Move only id1 to qc_in_review
  await app.inject({
    method: "POST",
    url: `/assets/${id1}/request-review`,
    payload: { performed_by: "supervisor_jane" },
  });

  const res = await app.inject({
    method: "GET",
    url: "/assets/approval-queue",
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { assets: Array<{ id: string; status: string; auditTrail: unknown[] }> };
  assert.equal(body.assets.length, 1);
  assert.equal(body.assets[0].id, id1);
  assert.equal(body.assets[0].status, "qc_in_review");
  assert.ok(body.assets[0].auditTrail.length >= 1);
  await app.close();
});

test("request-review returns 400 when performed_by missing", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  const res = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/request-review`,
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as { code: string };
  assert.equal(body.code, "VALIDATION_ERROR");
  await app.close();
});

test("approve returns 404 for nonexistent asset", async () => {
  const { app } = buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/assets/nonexistent-id/approve",
    payload: { performed_by: "reviewer_bob" },
  });

  assert.equal(res.statusCode, 404);
  const body = res.json() as { code: string };
  assert.equal(body.code, "NOT_FOUND");
  await app.close();
});

test("full approval flow with audit trail", async () => {
  const { app, persistence } = buildTestApp();
  const { assetId } = await ingestAndAdvanceToQcPending(app, persistence);

  // Step 1: request review
  const reviewRes = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/request-review`,
    payload: { performed_by: "supervisor_jane", note: "Ready for QC" },
  });
  assert.equal(reviewRes.statusCode, 200);

  // Step 2: approve
  const approveRes = await app.inject({
    method: "POST",
    url: `/assets/${assetId}/approve`,
    payload: { performed_by: "reviewer_bob", note: "All checks passed" },
  });
  assert.equal(approveRes.statusCode, 200);

  // Step 3: verify approval queue is now empty
  const queueRes = await app.inject({
    method: "GET",
    url: "/assets/approval-queue",
  });
  const queue = queueRes.json() as { assets: unknown[] };
  assert.equal(queue.assets.length, 0);

  await app.close();
});
