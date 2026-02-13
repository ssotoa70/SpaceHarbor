import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence";

test("VAST mode ingest preserves v1 response contract", async () => {
  const previousBackend = process.env.ASSETHARBOR_PERSISTENCE_BACKEND;
  process.env.ASSETHARBOR_PERSISTENCE_BACKEND = "vast";

  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "vast-mode-contract-asset",
      sourceUri: "s3://bucket/vast-mode-contract-asset.mov"
    }
  });

  assert.equal(ingest.statusCode, 201);
  assert.ok(ingest.json().asset.id);
  assert.ok(ingest.json().job.id);

  const claim = await app.inject({
    method: "POST",
    url: "/api/v1/queue/claim",
    payload: {
      workerId: "worker-vast-contract"
    }
  });

  assert.equal(claim.statusCode, 200);
  assert.ok(claim.json().job);

  await app.close();
  if (previousBackend === undefined) {
    delete process.env.ASSETHARBOR_PERSISTENCE_BACKEND;
  } else {
    process.env.ASSETHARBOR_PERSISTENCE_BACKEND = previousBackend;
  }
});

test("strict VAST workflow failures return unified 500 envelope", async () => {
  const adapter = new VastPersistenceAdapter(
    {
      databaseUrl: "https://db.example",
      eventBrokerUrl: "https://events.example",
      dataEngineUrl: "https://engine.example",
      strict: true,
      fallbackToLocal: false
    },
    async () => new Response(null, { status: 200 }),
    {
      createIngestAsset: () => {
        throw new Error("database unavailable");
      }
    }
  );

  const app = buildApp({
    persistenceAdapter: adapter
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "strict-vast-failure",
      sourceUri: "s3://bucket/strict-vast-failure.mov"
    }
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "INTERNAL_ERROR");
  assert.equal(typeof response.json().requestId, "string");
  assert.deepEqual(Object.keys(response.json()).sort(), ["code", "details", "message", "requestId"]);

  await app.close();
});
