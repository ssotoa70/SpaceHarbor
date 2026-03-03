import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

test("GET /health returns service status", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "control-plane");
  assert(typeof body.uptime === "number");
  assert(typeof body.timestamp === "string");

  await app.close();
});

test("GET /health/ready checks persistence connectivity", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/health/ready"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "ready");
  assert.equal(body.database, "connected");
  assert(typeof body.stats === "object");

  await app.close();
});
