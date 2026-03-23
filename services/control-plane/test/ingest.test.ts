import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestApp() {
  const persistence = new LocalPersistenceAdapter();
  persistence.reset();
  const app = buildApp({ persistenceAdapter: persistence });
  return { app, persistence };
}

// ---------------------------------------------------------------------------
// Existing: happy path (retained)
// ---------------------------------------------------------------------------

test("POST /assets/ingest creates asset and pending workflow job", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Launch Teaser",
      sourceUri: "s3://bucket/launch-teaser.mov"
    }
  });

  assert.equal(response.statusCode, 201);

  const body = response.json();
  assert.equal(body.asset.title, "Launch Teaser");
  assert.equal(body.asset.sourceUri, "s3://bucket/launch-teaser.mov");
  assert.equal(body.job.status, "pending");
  assert.ok(body.asset.id);
  assert.ok(body.job.id);

  await app.close();
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

test("POST /assets/ingest rejects request missing sourceUri", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "No Source URI Asset"
      // sourceUri intentionally omitted
    }
  });

  assert.equal(response.statusCode, 400);

  await app.close();
});

test("POST /assets/ingest rejects request missing title", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      // title intentionally omitted
      sourceUri: "s3://bucket/some-asset.exr"
    }
  });

  assert.equal(response.statusCode, 400);

  await app.close();
});

test("POST /assets/ingest rejects empty title after trim", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "   ",   // whitespace-only title collapses to empty string
      sourceUri: "s3://bucket/some-asset.exr"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "VALIDATION_ERROR");

  await app.close();
});

test("POST /assets/ingest rejects empty sourceUri after trim", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Valid Title",
      sourceUri: "   "   // whitespace-only
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "VALIDATION_ERROR");

  await app.close();
});

// ---------------------------------------------------------------------------
// Duplicate ingest (same sourceUri)
// The persistence layer does not enforce uniqueness on sourceUri; two ingests
// with the same URI produce two independent assets and two pending jobs.
// This is intentional: re-ingest after re-delivery is a valid VFX workflow.
// ---------------------------------------------------------------------------

test("POST /assets/ingest with same sourceUri creates a second independent asset", async () => {
  const { app } = buildTestApp();

  const payload = {
    title: "Shot A Frame 1001",
    sourceUri: "vast://renderfarm/shots/sh010/sh010_beauty_v003.1001.exr"
  };

  const first = await app.inject({ method: "POST", url: "/api/v1/assets/ingest", payload });
  assert.equal(first.statusCode, 201);

  const second = await app.inject({ method: "POST", url: "/api/v1/assets/ingest", payload });
  assert.equal(second.statusCode, 201);

  const firstId = first.json().asset.id as string;
  const secondId = second.json().asset.id as string;
  assert.notEqual(firstId, secondId, "each ingest should produce a distinct asset id");

  const firstJobId = first.json().job.id as string;
  const secondJobId = second.json().job.id as string;
  assert.notEqual(firstJobId, secondJobId, "each ingest should produce a distinct job id");

  // Both jobs start in pending state
  assert.equal(first.json().job.status, "pending");
  assert.equal(second.json().job.status, "pending");

  await app.close();
});

// ---------------------------------------------------------------------------
// VFX metadata fields: projectId, shotId, versionLabel
// ---------------------------------------------------------------------------

test("POST /assets/ingest accepts and persists VFX metadata fields", async () => {
  const { app, persistence } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "sh010 beauty v003",
      sourceUri: "vast://shots/sh010/sh010_beauty_v003.exr",
      projectId: "proj-abc123",
      shotId: "shot-sh010",
      versionLabel: "v003",
      fileSizeBytes: 104857600,
      md5Checksum: "d41d8cd98f00b204e9800998ecf8427e",
      createdBy: "artist-jane"
    }
  });

  assert.equal(response.statusCode, 201);

  const { asset, job } = response.json() as {
    asset: {
      id: string;
      projectId?: string;
      shotId?: string;
      versionLabel?: string;
    };
    job: { id: string; status: string };
  };

  assert.equal(asset.projectId, "proj-abc123");
  assert.equal(asset.shotId, "shot-sh010");
  assert.equal(asset.versionLabel, "v003");
  assert.equal(job.status, "pending");

  // Verify the asset was stored with VFX fields
  const stored = await persistence.getAssetById(asset.id);
  assert.ok(stored, "asset should be retrievable from persistence");
  assert.equal(stored?.projectId, "proj-abc123");
  assert.equal(stored?.shotId, "shot-sh010");
  assert.equal(stored?.versionLabel, "v003");

  await app.close();
});

test("POST /assets/ingest without VFX metadata fields creates asset without those fields", async () => {
  const { app, persistence } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Generic Asset",
      sourceUri: "s3://bucket/generic.mov"
    }
  });

  assert.equal(response.statusCode, 201);
  const assetId = response.json().asset.id as string;

  const stored = await persistence.getAssetById(assetId);
  assert.ok(stored);
  assert.equal(stored?.projectId, undefined);
  assert.equal(stored?.shotId, undefined);
  assert.equal(stored?.versionLabel, undefined);

  await app.close();
});

// ---------------------------------------------------------------------------
// Error handling when persistence fails
// ---------------------------------------------------------------------------

test("POST /assets/ingest returns 500 when persistence throws unexpectedly", async () => {
  // Build a custom adapter that throws on createIngestAsset
  const persistence = new LocalPersistenceAdapter();
  persistence.reset();

  const original = persistence.createIngestAsset.bind(persistence);
  // Temporarily override the method to simulate a persistence failure
  (persistence as any).createIngestAsset = async () => {
    throw new Error("Simulated persistence failure: disk full");
  };

  const app = buildApp({ persistenceAdapter: persistence as any });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "Failure Test Asset",
      sourceUri: "s3://bucket/failure-test.mov"
    }
  });

  // Fastify default error handler returns 500 for unhandled errors
  assert.equal(response.statusCode, 500);

  // Restore the original method so other tests are unaffected
  (persistence as any).createIngestAsset = original;

  await app.close();
});

// ---------------------------------------------------------------------------
// Both /assets/ingest and /api/v1/assets/ingest are registered
// ---------------------------------------------------------------------------

test("POST /api/v1/assets/ingest (v1 prefix) also creates asset successfully", async () => {
  const { app } = buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: {
      title: "V1 Prefix Asset",
      sourceUri: "s3://bucket/v1-prefix.mov"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().asset.title, "V1 Prefix Asset");
  assert.equal(response.json().job.status, "pending");

  await app.close();
});
