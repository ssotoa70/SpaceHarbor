import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../../src/app.js";

test("security headers present on responses", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");

  await app.close();
});

test("security headers present on API responses", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/assets",
  });

  assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");

  await app.close();
});

test("security headers present on error responses", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/nonexistent-path",
  });

  assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");

  await app.close();
});
