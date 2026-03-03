import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence.js";

test("POST /api/v1/assets/ingest validates payload with unified error envelope", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      sourceUri: "s3://bucket/missing-title.mov"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(Object.keys(response.json()).sort(), ["code", "details", "message", "requestId"]);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.equal(typeof response.json().requestId, "string");

  await app.close();
});

test("GET /api/v1/jobs/:id returns not found envelope", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/jobs/missing-id"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "NOT_FOUND");
  assert.equal(typeof response.json().requestId, "string");

  await app.close();
});

test("POST /api/v1/assets/ingest succeeds with stable v1 response shape", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "v1 launch teaser",
      sourceUri: "s3://bucket/v1-launch-teaser.mov"
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.ok(body.asset.id);
  assert.ok(body.job.id);
  assert.equal(body.job.status, "pending");

  await app.close();
});

test("GET /api/v1/assets returns additive review/QC status values", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "v1 qc status demo",
      sourceUri: "s3://bucket/v1-qc-status-demo.mov"
    }
  });

  const ingestBody = ingest.json();

  const completed = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-api-v1-qc-completed-1",
      eventType: "asset.processing.completed",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-api-v1-qc-completed-1",
      producer: "media-worker",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    }
  });
  assert.equal(completed.statusCode, 202);

  const qcPending = await app.inject({
    method: "POST",
    url: "/api/v1/events",
    payload: {
      eventId: "evt-api-v1-qc-pending-1",
      eventType: "asset.review.qc_pending",
      eventVersion: "1.0",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-api-v1-qc-pending-1",
      producer: "post-qc",
      data: {
        assetId: ingestBody.asset.id,
        jobId: ingestBody.job.id
      }
    }
  });
  assert.equal(qcPending.statusCode, 202);

  const assets = await app.inject({ method: "GET", url: "/api/v1/assets" });
  assert.equal(assets.statusCode, 200);
  assert.ok(Array.isArray(assets.json().assets));
  assert.equal(assets.json().assets[0].status, "qc_pending");
  assert.equal(assets.json().assets[0].thumbnail, null);
  assert.equal(assets.json().assets[0].proxy, null);
  assert.deepEqual(assets.json().assets[0].annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });
  assert.deepEqual(assets.json().assets[0].handoffChecklist, {
    releaseNotesReady: false,
    verificationComplete: false,
    commsDraftReady: false,
    ownerAssigned: false
  });
  assert.deepEqual(assets.json().assets[0].handoff, {
    status: "not_ready",
    owner: null,
    lastUpdatedAt: null
  });

  const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${ingestBody.job.id}` });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().thumbnail, null);
  assert.equal(job.json().proxy, null);
  assert.deepEqual(job.json().annotationHook, {
    enabled: false,
    provider: null,
    contextId: null
  });
  assert.deepEqual(job.json().handoffChecklist, {
    releaseNotesReady: false,
    verificationComplete: false,
    commsDraftReady: false,
    ownerAssigned: false
  });
  assert.deepEqual(job.json().handoff, {
    status: "not_ready",
    owner: null,
    lastUpdatedAt: null
  });

  await app.close();
});

test("incident coordination write routes return validation envelope for invalid payloads", async () => {
  const app = buildApp();

  const invalidRequests = [
    {
      method: "PUT",
      url: "/api/v1/incident/coordination/actions",
      payload: {
        acknowledged: true,
        owner: "oncall-supervisor",
        escalated: false,
        nextUpdateEta: "not-a-date",
        expectedUpdatedAt: null
      }
    },
    {
      method: "POST",
      url: "/api/v1/incident/coordination/notes",
      payload: {
        message: "   ",
        correlationId: "corr-incident-note-1",
        author: "operator-a"
      }
    },
    {
      method: "PUT",
      url: "/api/v1/incident/coordination/handoff",
      payload: {
        state: "handoff_requested",
        fromOwner: "",
        toOwner: "",
        summary: "shift handoff",
        expectedUpdatedAt: null
      }
    }
  ] as const;

  for (const requestConfig of invalidRequests) {
    const response = await app.inject(requestConfig);

    assert.equal(response.statusCode, 400, `expected 400 for ${requestConfig.method} ${requestConfig.url}`);
    const envelope = response.json();
    assert.deepEqual(Object.keys(envelope).sort(), ["code", "details", "message", "requestId"]);
    assert.equal(envelope.code, "VALIDATION_ERROR");
    assert.equal(typeof envelope.requestId, "string");
  }

  await app.close();
});

test("GET /api/v1/audit preserves stable event shape and fallback signal contract", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: false,
      fallbackToLocal: true
    },
    async () => new Response(null, { status: 202 }),
    {
      createIngestAsset: () => {
        throw new Error("database unavailable");
      }
    }
  );

  const app = buildApp({ persistenceAdapter: adapter });

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "v1-audit-fallback-asset",
      sourceUri: "s3://bucket/v1-audit-fallback-asset.mov"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const audit = await app.inject({
    method: "GET",
    url: "/api/v1/audit"
  });

  assert.equal(audit.statusCode, 200);
  const fallbackEvent = audit
    .json()
    .events.find(
      (event: {
        message: string;
        signal?: {
          code?: string;
        };
      }) => event.message.includes("vast fallback")
    );

  assert.ok(fallbackEvent);
  assert.deepEqual(Object.keys(fallbackEvent).sort(), ["at", "id", "message", "signal"]);
  assert.equal(fallbackEvent.signal?.code, "VAST_FALLBACK");

  await app.close();
});
