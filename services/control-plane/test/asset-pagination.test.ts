import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

async function ingestAssets(app: ReturnType<typeof buildApp>, count: number) {
  for (let i = 0; i < count; i++) {
    await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      payload: { title: `asset-${i}`, sourceUri: `s3://bucket/asset-${i}.mov` }
    });
  }
}

test("GET /api/v1/assets returns pagination metadata", async () => {
  const app = createApp();
  await ingestAssets(app, 3);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 3);
  assert.ok(body.pagination);
  assert.equal(body.pagination.total, 3);
  assert.equal(body.pagination.limit, 50);
  assert.equal(body.pagination.offset, 0);
  await app.close();
});

test("GET /api/v1/assets?limit=2 limits results", async () => {
  const app = createApp();
  await ingestAssets(app, 5);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?limit=2" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 2);
  assert.equal(body.pagination.total, 5);
  assert.equal(body.pagination.limit, 2);
  await app.close();
});

test("GET /api/v1/assets?offset=3 skips results", async () => {
  const app = createApp();
  await ingestAssets(app, 5);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?offset=3" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 2);
  assert.equal(body.pagination.offset, 3);
  await app.close();
});

test("GET /api/v1/assets?limit=2&offset=2 paginates correctly", async () => {
  const app = createApp();
  await ingestAssets(app, 5);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?limit=2&offset=2" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 2);
  assert.equal(body.pagination.total, 5);
  assert.equal(body.pagination.limit, 2);
  assert.equal(body.pagination.offset, 2);
  await app.close();
});

test("GET /api/v1/assets?status=pending filters by status", async () => {
  const app = createApp();
  await ingestAssets(app, 3);

  // All new assets should be pending
  const res = await app.inject({ method: "GET", url: "/api/v1/assets?status=pending" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 3);
  for (const asset of body.assets) {
    assert.equal(asset.status, "pending");
  }
  await app.close();
});

test("GET /api/v1/assets?status=completed returns empty for new assets", async () => {
  const app = createApp();
  await ingestAssets(app, 3);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?status=completed" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().assets.length, 0);
  assert.equal(res.json().pagination.total, 0);
  await app.close();
});

test("GET /api/v1/assets?q=asset-1 searches by title", async () => {
  const app = createApp();
  await ingestAssets(app, 5);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?q=asset-1" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assets.length, 1);
  assert.equal(body.assets[0].title, "asset-1");
  await app.close();
});

test("GET /api/v1/assets?q=bucket searches by sourceUri", async () => {
  const app = createApp();
  await ingestAssets(app, 3);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?q=bucket" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().assets.length, 3);
  await app.close();
});

test("GET /api/v1/assets limit is capped at 200", async () => {
  const app = createApp();
  await ingestAssets(app, 1);

  const res = await app.inject({ method: "GET", url: "/api/v1/assets?limit=999" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pagination.limit, 200);
  await app.close();
});

test("legacy /assets also supports pagination", async () => {
  const app = createApp();
  await ingestAssets(app, 3);

  const res = await app.inject({ method: "GET", url: "/assets?limit=1" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().assets.length, 1);
  assert.equal(res.json().pagination.total, 3);
  await app.close();
});
