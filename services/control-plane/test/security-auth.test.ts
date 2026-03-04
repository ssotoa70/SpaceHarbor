import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function withApiKeyEnv<T>(apiKey: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.ASSETHARBOR_API_KEY;
  process.env.ASSETHARBOR_API_KEY = apiKey;

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env.ASSETHARBOR_API_KEY;
      return;
    }
    process.env.ASSETHARBOR_API_KEY = previous;
  });
}

test("POST /api/v1/assets/ingest requires API key when configured", async () => {
  await withApiKeyEnv("phase3-secret", async () => {
    const app = buildApp();

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      payload: {
        title: "Unauthorized asset",
        sourceUri: "s3://bucket/unauthorized.mov"
      }
    });

    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().code, "UNAUTHORIZED");

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      headers: {
        "x-api-key": "wrong"
      },
      payload: {
        title: "Forbidden asset",
        sourceUri: "s3://bucket/forbidden.mov"
      }
    });

    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().code, "FORBIDDEN");

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/assets/ingest",
      headers: {
        "x-api-key": "phase3-secret"
      },
      payload: {
        title: "Authorized asset",
        sourceUri: "s3://bucket/authorized.mov"
      }
    });

    assert.equal(ok.statusCode, 201);

    await app.close();
  });
});

test("GET /api/v1/assets remains accessible without API key", async () => {
  await withApiKeyEnv("phase3-secret", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/assets"
    });

    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.json().assets));

    await app.close();
  });
});

test("legacy write aliases are protected when API key mode is enabled", async () => {
  await withApiKeyEnv("phase3-secret", async () => {
    const app = buildApp();

    const noKey = await app.inject({
      method: "POST",
      url: "/assets/ingest",
      payload: {
        title: "legacy-asset",
        sourceUri: "s3://bucket/legacy-asset.mov"
      }
    });

    assert.equal(noKey.statusCode, 401);
    assert.equal(noKey.json().code, "UNAUTHORIZED");

    const validKey = await app.inject({
      method: "POST",
      url: "/assets/ingest",
      headers: {
        "x-api-key": "phase3-secret"
      },
      payload: {
        title: "legacy-asset-ok",
        sourceUri: "s3://bucket/legacy-asset-ok.mov"
      }
    });

    assert.equal(validKey.statusCode, 201);

    await app.close();
  });
});
