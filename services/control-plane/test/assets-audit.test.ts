import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence";

test("GET /assets returns queue rows with status", async () => {
  const app = buildApp();

  await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Queue Asset",
      sourceUri: "s3://bucket/queue-asset.mov"
    }
  });

  const response = await app.inject({ method: "GET", url: "/assets" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    assets: Array<{
      title: string;
      status: string;
      thumbnail: null;
      proxy: null;
      annotationHook: { enabled: boolean; provider: null; contextId: null };
      handoffChecklist: {
        releaseNotesReady: boolean;
        verificationComplete: boolean;
        commsDraftReady: boolean;
        ownerAssigned: boolean;
      };
      handoff: {
        status: "not_ready" | "ready_for_release";
        owner: null;
        lastUpdatedAt: null;
      };
    }>;
  };
  assert.equal(body.assets[0].title, "Queue Asset");
  assert.equal(body.assets[0].status, "pending");
  assert.equal(body.assets[0].thumbnail, null);
  assert.equal(body.assets[0].proxy, null);
  assert.deepEqual(body.assets[0].annotationHook, { enabled: false, provider: null, contextId: null });
  assert.deepEqual(body.assets[0].handoffChecklist, {
    releaseNotesReady: false,
    verificationComplete: false,
    commsDraftReady: false,
    ownerAssigned: false
  });
  assert.deepEqual(body.assets[0].handoff, {
    status: "not_ready",
    owner: null,
    lastUpdatedAt: null
  });

  await app.close();
});

test("GET /audit returns event history", async () => {
  const app = buildApp();

  const ingest = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Audit Asset",
      sourceUri: "s3://bucket/audit-asset.mov"
    }
  });

  const body = ingest.json() as {
    asset: { id: string };
    job: { id: string };
  };

  await app.inject({
    method: "POST",
    url: "/events",
    payload: {
      event_id: "evt-audit-1",
      event_type: "asset.processing.started",
      asset_id: body.asset.id,
      occurred_at: new Date().toISOString(),
      producer: "media-worker",
      schema_version: "1.0",
      data: {
        job_id: body.job.id
      }
    }
  });

  const audit = await app.inject({ method: "GET", url: "/audit" });
  assert.equal(audit.statusCode, 200);
  assert.ok(audit.json().events.length >= 1);

  await app.close();
});

test("GET /api/v1/audit returns structured fallback signal shape", async () => {
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
        throw new Error("vast db unavailable");
      }
    }
  );

  const app = buildApp({ persistenceAdapter: adapter });

  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "audit-contract-fallback-asset",
      sourceUri: "s3://bucket/audit-contract-fallback-asset.mov"
    }
  });
  assert.equal(ingest.statusCode, 201);

  const audit = await app.inject({ method: "GET", url: "/api/v1/audit" });
  assert.equal(audit.statusCode, 200);

  const fallbackEvent = audit.json().events.find(
    (event: {
      message: string;
      signal?: {
        code?: string;
      };
    }) => event.message.includes("vast fallback") && event.message.includes("createIngestAsset")
  );

  assert.ok(fallbackEvent);
  assert.deepEqual(Object.keys(fallbackEvent).sort(), ["at", "id", "message", "signal"]);
  assert.equal(fallbackEvent.signal?.code, "VAST_FALLBACK");

  await app.close();
});
