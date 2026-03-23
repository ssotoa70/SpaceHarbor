import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

async function ingestOne(app: ReturnType<typeof buildApp>, title = "test-asset") {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/ingest",
    payload: { title, sourceUri: `s3://bucket/${title}.mov` }
  });
  return res.json();
}

test("GET /api/v1/assets/:id returns 200 with full asset", async () => {
  const app = createApp();
  const { asset } = await ingestOne(app);

  const res = await app.inject({ method: "GET", url: `/api/v1/assets/${asset.id}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.id, asset.id);
  assert.equal(body.title, "test-asset");
  assert.equal(body.sourceUri, "s3://bucket/test-asset.mov");
  assert.ok(body.createdAt);
  await app.close();
});

test("GET /api/v1/assets/:id returns 404 for unknown ID", async () => {
  const app = createApp();

  const res = await app.inject({ method: "GET", url: "/api/v1/assets/nonexistent-id" });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  assert.equal(body.code, "NOT_FOUND");
  await app.close();
});

test("GET /assets/:id (legacy prefix) works", async () => {
  const app = createApp();
  const { asset } = await ingestOne(app);

  const res = await app.inject({ method: "GET", url: `/assets/${asset.id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().id, asset.id);
  await app.close();
});

test("GET /api/v1/assets/:id includes metadata fields when present", async () => {
  const app = createApp();
  const { asset } = await ingestOne(app);

  // Update asset with metadata via persistence
  const persistence = (app as any).persistence;
  persistence.updateAsset(
    asset.id,
    {
      metadata: { codec: "h264", channels: ["RGB"] },
      version: { version_label: "v001" },
      integrity: { file_size_bytes: 1024, checksum: { type: "md5", value: "abc123" } }
    },
    { correlationId: "test" }
  );

  const res = await app.inject({ method: "GET", url: `/api/v1/assets/${asset.id}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.metadata.codec, "h264");
  assert.equal(body.version.version_label, "v001");
  assert.equal(body.integrity.file_size_bytes, 1024);
  await app.close();
});
