/**
 * Scanner Ingest Contract Tests
 *
 * Tests the extended POST /assets/ingest route that accepts optional VFX hierarchy
 * context fields populated by the ScannerFunction (VAST DataEngine trigger).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

const CTX = { correlationId: "test-correlation-id" };

test("ingest with shotId creates asset linked to existing shot", async () => {
  const adapter = new LocalPersistenceAdapter();
  const app = buildApp({ persistenceAdapter: adapter });

  // Create hierarchy: project → sequence → shot
  const project = await adapter.createProject(
    { code: "NOVA", name: "Project Nova", type: "feature", status: "active" },
    CTX
  );
  const sequence = await adapter.createSequence(
    { projectId: project.id, code: "SEQ_010", name: "Sequence 010", status: "active" },
    CTX
  );
  const shot = await adapter.createShot(
    {
      sequenceId: sequence.id,
      projectId: project.id,
      code: "SH040",
      name: "Shot 040",
      status: "active",
      frameRangeStart: 1001,
      frameRangeEnd: 1100,
      frameCount: 100,
    },
    CTX
  );

  const response = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "beauty.0001.exr",
      sourceUri: "s3://assetharbor-renders/projects/NOVA/SEQ_010/SH040/render/v001/beauty.0001.exr",
      shotId: shot.id,
      projectId: project.id,
      versionLabel: "v001",
      fileSizeBytes: 104857600,
      md5Checksum: "abc123",
      createdBy: "scanner"
    }
  });

  assert.equal(response.statusCode, 201, `Expected 201 but got ${response.statusCode}: ${response.body}`);

  const body = response.json();
  assert.equal(body.asset.title, "beauty.0001.exr");
  assert.equal(body.asset.shotId, shot.id, "asset.shotId should be set from ingest payload");
  assert.equal(body.asset.versionLabel, "v001", "asset.versionLabel should be set");
  assert.ok(body.job.id);
  assert.equal(body.job.status, "pending");

  await app.close();
});

test("ingest without shotId still works (backward compat)", async () => {
  const app = buildApp();

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
  assert.equal(body.job.status, "pending");
  assert.ok(!body.asset.shotId, "shotId should be absent when not provided");

  await app.close();
});
