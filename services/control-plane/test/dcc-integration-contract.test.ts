import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { clearDccAuditTrail, getDccAuditTrail } from "../src/routes/dcc.js";

test("POST /api/v1/dcc/maya/export-asset returns queued job", async () => {
  const app = buildApp();
  clearDccAuditTrail();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/dcc/maya/export-asset",
    payload: {
      asset_id: "asset-001",
      shot_id: "shot-100",
      version_label: "v1",
      export_format: "exr",
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.job_id.startsWith("dcc-job-"));
  assert.equal(body.status, "queued");

  const trail = getDccAuditTrail();
  assert.equal(trail.length, 1);
  assert.equal(trail[0].action, "DCC export requested via Maya");
  assert.equal(trail[0].asset_id, "asset-001");
  assert.equal(trail[0].format, "exr");

  await app.close();
});

test("POST /api/v1/dcc/nuke/import-metadata returns success", async () => {
  const app = buildApp();
  clearDccAuditTrail();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/dcc/nuke/import-metadata",
    payload: {
      asset_id: "asset-002",
      nuke_project_path: "/projects/shot100/comp_v3.nk",
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.asset_id, "asset-002");
  assert.equal(body.metadata_imported, true);

  const trail = getDccAuditTrail();
  assert.equal(trail.length, 1);
  assert.equal(trail[0].action, "Metadata imported from Nuke");
  assert.equal(trail[0].asset_id, "asset-002");

  await app.close();
});

test("GET /api/v1/dcc/supported-formats returns format list", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/dcc/supported-formats",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Array.isArray(body.formats));
  assert.ok(body.formats.includes("exr"));
  assert.ok(body.formats.includes("mov"));
  assert.ok(body.formats.includes("dpx"));

  await app.close();
});

test("GET /api/v1/dcc/status/:job_id returns completed status", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/dcc/status/dcc-job-test-123",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.job_id, "dcc-job-test-123");
  assert.equal(body.status, "completed");

  await app.close();
});

test("POST /api/v1/dcc/maya/export-asset response includes manager_uri", async () => {
  const app = buildApp();
  clearDccAuditTrail();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/dcc/maya/export-asset",
    payload: {
      asset_id: "asset-001",
      shot_id: "shot-100",
      version_label: "v1",
      export_format: "exr",
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok("manager_uri" in body, "response should include manager_uri");
  assert.ok(
    typeof body.manager_uri === "string" && body.manager_uri.includes("/resolve"),
    `manager_uri should contain /resolve, got: ${body.manager_uri}`,
  );

  await app.close();
});

test("POST /api/v1/dcc/maya/export-asset rejects incomplete payload", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/dcc/maya/export-asset",
    payload: {
      asset_id: "asset-001",
    },
  });

  assert.ok(response.statusCode >= 400, `expected error status, got ${response.statusCode}`);

  await app.close();
});
