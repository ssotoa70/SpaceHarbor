import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("GET /openapi.json returns OpenAPI document with critical workflow paths", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.openapi, "string");
  assert.equal(body.openapi.startsWith("3."), true);

  const requiredPaths = [
    "/api/v1/assets/ingest",
    "/api/v1/events",
    "/api/v1/queue/claim",
    "/api/v1/jobs/{id}/heartbeat",
    "/api/v1/jobs/{id}/replay"
  ];

  for (const path of requiredPaths) {
    assert.ok(body.paths[path], `missing path in OpenAPI doc: ${path}`);
  }

  await app.close();
});

test("GET /docs is available in non-production mode", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;

  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/docs"
  });

  assert.notEqual(response.statusCode, 404);

  await app.close();

  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("OpenAPI critical workflow operations expose stable operation metadata", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/openapi.json"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  const criticalOperations = [
    { path: "/api/v1/assets/ingest", method: "post", expectedStatus: "201", requiresBody: true },
    { path: "/api/v1/events", method: "post", expectedStatus: "202", requiresBody: true },
    { path: "/api/v1/queue/claim", method: "post", expectedStatus: "200", requiresBody: true },
    { path: "/api/v1/jobs/{id}/heartbeat", method: "post", expectedStatus: "200", requiresBody: true },
    { path: "/api/v1/jobs/{id}/replay", method: "post", expectedStatus: "202", requiresBody: false }
  ] as const;

  for (const operationConfig of criticalOperations) {
    const operation = body.paths?.[operationConfig.path]?.[operationConfig.method];
    assert.ok(operation, `missing operation ${operationConfig.method.toUpperCase()} ${operationConfig.path}`);

    assert.equal(typeof operation.operationId, "string", `missing operationId for ${operationConfig.path}`);
    assert.equal(operation.operationId.length > 0, true, `empty operationId for ${operationConfig.path}`);

    assert.ok(operation.responses?.[operationConfig.expectedStatus], `missing ${operationConfig.expectedStatus} response for ${operationConfig.path}`);

    assert.ok(operation.security, `missing security declaration for ${operationConfig.path}`);
    assert.deepEqual(operation.security, [{ ApiKeyAuth: [] }], `unexpected security for ${operationConfig.path}`);

    if (operationConfig.requiresBody) {
      assert.equal(operation.requestBody?.required, true, `requestBody is not required for ${operationConfig.path}`);
    }
  }

  await app.close();
});
