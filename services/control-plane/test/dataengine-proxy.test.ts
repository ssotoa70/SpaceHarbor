import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

// Ensure test env is configured
process.env.SPACEHARBOR_JWT_SECRET ??= "test-secret-32-chars-minimum-xxxxxx";
process.env.SPACEHARBOR_ALLOW_INSECURE_MODE ??= "true";
process.env.SPACEHARBOR_IAM_ENABLED ??= "false";

// ── Tests ──

test("dataengine-proxy: returns 503 when not configured", async () => {
  // Default app has no VAST_DATA_ENGINE_URL or VMS credentials
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine-proxy/functions",
  });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.code, "NOT_CONFIGURED");
  assert.ok(body.message.includes("not configured"));
  await app.close();
});

test("dataengine-proxy: dashboard stats returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine-proxy/dashboard/stats",
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().code, "NOT_CONFIGURED");
  await app.close();
});

test("dataengine-proxy: triggers endpoint returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine-proxy/triggers",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("dataengine-proxy: pipelines endpoint returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine-proxy/pipelines",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("dataengine-proxy: POST functions returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/dataengine-proxy/functions",
    payload: { name: "test-fn" },
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("dataengine-proxy: DELETE functions/:guid returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "DELETE",
    url: "/api/v1/dataengine-proxy/functions/some-guid",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("dataengine-proxy: telemetry traces returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine-proxy/telemetries/traces",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("dataengine-proxy: deploy pipeline returns 503 when not configured", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/dataengine-proxy/pipelines/123/deploy",
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

// Existing local catalogue routes should still work
test("dataengine local catalogue: GET /api/v1/dataengine/functions still works", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine/functions",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.functions));
  await app.close();
});

test("dataengine local catalogue: GET /api/v1/dataengine/pipelines still works", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/dataengine/pipelines",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.pipelines));
  await app.close();
});
