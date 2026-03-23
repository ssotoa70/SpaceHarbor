import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import type { AssetPriority, ProductionMetadata } from "../src/domain/models.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence.js";

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
      productionMetadata: Omit<ProductionMetadata, "priority"> & { priority: AssetPriority | null };
    }>;
  };
  assert.equal(body.assets[0].title, "Queue Asset");
  assert.equal(body.assets[0].status, "pending");
  assert.deepEqual(Object.keys(body.assets[0].productionMetadata).sort(), [
    "dueDate",
    "episode",
    "owner",
    "priority",
    "sequence",
    "shot",
    "show",
    "vendor",
    "version"
  ]);
  assert.deepEqual(body.assets[0].productionMetadata, {
    dueDate: null,
    episode: null,
    owner: null,
    priority: null,
    sequence: null,
    shot: null,
    show: null,
    vendor: null,
    version: null
  });

  await app.close();
});

test("listAssetQueueRows coalesces legacy partial metadata to null-first defaults", async () => {
  const adapter = new LocalPersistenceAdapter();
  const ingest = await adapter.createIngestAsset(
    {
      title: "Legacy Metadata Asset",
      sourceUri: "s3://bucket/legacy-metadata-asset.mov"
    },
    { correlationId: "corr-legacy" }
  );

  const metadataStore = (
    adapter as unknown as {
      assetProductionMetadata: Map<string, Partial<ProductionMetadata>>;
    }
  ).assetProductionMetadata;

  metadataStore.set(ingest.asset.id, {
    show: "Show A",
    owner: undefined,
    priority: undefined
  });

  const rows = await adapter.listAssetQueueRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].productionMetadata, {
    show: "Show A",
    episode: null,
    sequence: null,
    shot: null,
    version: null,
    vendor: null,
    priority: null,
    dueDate: null,
    owner: null
  });
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
    } as unknown as import("../src/persistence/vast/workflow-client.js").VastWorkflowClient
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

test("local audit retention preview is non-mutating and uses strict cutoff", async () => {
  const persistence = new LocalPersistenceAdapter();

  await persistence.createIngestAsset(
    {
      title: "retention-old-1",
      sourceUri: "s3://bucket/retention-old-1.mov"
    },
    { correlationId: "corr-retention-old-1", now: "2025-09-01T00:00:00.000Z" }
  );
  await persistence.createIngestAsset(
    {
      title: "retention-old-2",
      sourceUri: "s3://bucket/retention-old-2.mov"
    },
    { correlationId: "corr-retention-old-2", now: "2025-12-31T23:59:59.000Z" }
  );
  await persistence.createIngestAsset(
    {
      title: "retention-boundary",
      sourceUri: "s3://bucket/retention-boundary.mov"
    },
    { correlationId: "corr-retention-boundary", now: "2026-01-01T00:00:00.000Z" }
  );

  const before = await persistence.getAuditEvents();
  assert.equal(before.length, 3);

  const preview = await persistence.previewAuditRetention("2026-01-01T00:00:00.000Z");
  assert.equal(preview.eligibleCount, 2);
  assert.equal(preview.oldestEligibleAt, "2025-09-01T00:00:00.000Z");
  assert.equal(preview.newestEligibleAt, "2025-12-31T23:59:59.000Z");

  const after = await persistence.getAuditEvents();
  assert.equal(after.length, 3);
});

test("local audit retention apply respects max-delete cap and idempotency", async () => {
  const persistence = new LocalPersistenceAdapter();

  await persistence.createIngestAsset(
    {
      title: "retention-old-1",
      sourceUri: "s3://bucket/retention-old-1.mov"
    },
    { correlationId: "corr-retention-old-1", now: "2025-09-01T00:00:00.000Z" }
  );
  await persistence.createIngestAsset(
    {
      title: "retention-old-2",
      sourceUri: "s3://bucket/retention-old-2.mov"
    },
    { correlationId: "corr-retention-old-2", now: "2025-12-31T23:59:59.000Z" }
  );
  await persistence.createIngestAsset(
    {
      title: "retention-new",
      sourceUri: "s3://bucket/retention-new.mov"
    },
    { correlationId: "corr-retention-new", now: "2026-02-01T00:00:00.000Z" }
  );

  const firstApply = await persistence.applyAuditRetention("2026-01-01T00:00:00.000Z", 1);
  assert.equal(firstApply.deletedCount, 1);
  assert.equal(firstApply.remainingCount, 2);

  const secondApply = await persistence.applyAuditRetention("2026-01-01T00:00:00.000Z");
  assert.equal(secondApply.deletedCount, 1);
  assert.equal(secondApply.remainingCount, 1);

  const thirdApply = await persistence.applyAuditRetention("2026-01-01T00:00:00.000Z");
  assert.equal(thirdApply.deletedCount, 0);
  assert.equal(thirdApply.remainingCount, 1);
});
