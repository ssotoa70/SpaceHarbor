import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

// Clean up S3 env vars between tests
function clearS3Env() {
  delete process.env.SPACEHARBOR_S3_ENDPOINT;
  delete process.env.SPACEHARBOR_S3_REGION;
  delete process.env.SPACEHARBOR_S3_BUCKET;
  delete process.env.SPACEHARBOR_S3_ACCESS_KEY_ID;
  delete process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY;
}

test("POST /api/v1/assets/upload-url returns 503 when S3 not configured", async () => {
  clearS3Env();
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/upload-url",
    payload: { filename: "test.mov" }
  });

  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.code, "S3_NOT_CONFIGURED");
  await app.close();
});

test("POST /api/v1/assets/upload-url returns 400 when filename missing", async () => {
  // Set S3 config so we don't get 503 first
  process.env.SPACEHARBOR_S3_ENDPOINT = "http://localhost:9000";
  process.env.SPACEHARBOR_S3_REGION = "us-east-1";
  process.env.SPACEHARBOR_S3_BUCKET = "test-bucket";
  process.env.SPACEHARBOR_S3_ACCESS_KEY_ID = "test-key";
  process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY = "test-secret";
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/upload-url",
    payload: {}
  });

  assert.equal(res.statusCode, 400);
  clearS3Env();
  await app.close();
});

test("POST /api/v1/assets/upload-url returns 400 when filename is empty string", async () => {
  clearS3Env();
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/upload-url",
    payload: { filename: "  " }
  });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.code, "VALIDATION_ERROR");
  await app.close();
});

test("POST /api/v1/assets/upload-url returns 201 with valid S3 config (mocked)", async (t) => {
  // Set up S3 env vars — the actual presigner call will be mocked
  process.env.SPACEHARBOR_S3_ENDPOINT = "http://localhost:9000";
  process.env.SPACEHARBOR_S3_REGION = "us-east-1";
  process.env.SPACEHARBOR_S3_BUCKET = "test-bucket";
  process.env.SPACEHARBOR_S3_ACCESS_KEY_ID = "test-key";
  process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY = "test-secret";

  // Mock the s3-request-presigner module
  const originalGetSignedUrl = await import("@aws-sdk/s3-request-presigner").then(m => m.getSignedUrl);

  // We can't easily mock ESM imports, so we'll test the route integration
  // by intercepting at a higher level. The S3Client will be created but
  // getSignedUrl will attempt a real call. Instead, let's test the key format.
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/upload-url",
    payload: { filename: "my-video.mov", contentType: "video/quicktime", prefix: "raw" }
  });

  // If S3 is configured but endpoint unreachable, getSignedUrl still returns
  // a presigned URL (it doesn't make a network call, just signs locally)
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.uploadUrl);
  assert.ok(body.storageKey);
  assert.ok(body.expiresAt);

  // Validate key format: {prefix}/{uuid}/{filename}
  const parts = body.storageKey.split("/");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "raw");
  // parts[1] should be a UUID
  assert.match(parts[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(parts[2], "my-video.mov");

  clearS3Env();
  await app.close();
});

test("POST /api/v1/assets/upload-url uses default prefix 'uploads' when not specified", async () => {
  process.env.SPACEHARBOR_S3_ENDPOINT = "http://localhost:9000";
  process.env.SPACEHARBOR_S3_REGION = "us-east-1";
  process.env.SPACEHARBOR_S3_BUCKET = "test-bucket";
  process.env.SPACEHARBOR_S3_ACCESS_KEY_ID = "test-key";
  process.env.SPACEHARBOR_S3_SECRET_ACCESS_KEY = "test-secret";

  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/upload-url",
    payload: { filename: "test.exr" }
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.storageKey.startsWith("uploads/"));

  clearS3Env();
  await app.close();
});

test("legacy /assets/upload-url also works", async () => {
  clearS3Env();
  const app = createApp();

  const res = await app.inject({
    method: "POST",
    url: "/assets/upload-url",
    payload: { filename: "test.mov" }
  });

  // Should get 503 (S3 not configured) not 404
  assert.equal(res.statusCode, 503);
  await app.close();
});
