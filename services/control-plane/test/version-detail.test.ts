import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";

const CTX = { correlationId: "test-correlation-id" };

async function setupVersionInApp() {
  const persistence = new LocalPersistenceAdapter();
  const app = buildApp({ persistenceAdapter: persistence });

  const project = await persistence.createProject(
    { code: "TEST", name: "Test Project", type: "feature", status: "active" },
    CTX,
  );
  const sequence = await persistence.createSequence(
    { projectId: project.id, code: "SEQ010", status: "active" },
    CTX,
  );
  const shot = await persistence.createShot(
    {
      projectId: project.id,
      sequenceId: sequence.id,
      code: "SH040",
      status: "active",
      frameRangeStart: 1001,
      frameRangeEnd: 1240,
      frameCount: 240,
    },
    CTX,
  );
  const version = await persistence.createVersion(
    {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: sequence.id,
      versionLabel: "v003",
      status: "draft",
      mediaType: "exr_sequence",
      createdBy: "artist@studio.com",
    },
    CTX,
  );

  return { app, persistence, project, sequence, shot, version };
}

test("GET /api/v1/versions/:id/detail returns info tab", async () => {
  const { app, version } = await setupVersionInApp();

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/versions/${version.id}/detail?tabs=info`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.info);
  assert.equal(body.info.version.id, version.id);
  assert.equal(body.info.version.versionLabel, "v003");
  assert.equal(body.info.version.elementPath, null);
  assert.ok(body.info.protocols);
  assert.equal(body.info.protocols.nfs, null);
  assert.equal(body.info.protocols.smb, null);
  assert.equal(body.info.protocols.s3, null);
  await app.close();
});

test("GET /api/v1/versions/:id/detail returns 404 for unknown version", async () => {
  const persistence = new LocalPersistenceAdapter();
  const app = buildApp({ persistenceAdapter: persistence });

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/versions/nonexistent/detail?tabs=info",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().code, "NOT_FOUND");
  await app.close();
});

test("GET /api/v1/versions/:id/detail returns history tab with created event", async () => {
  const { app, version } = await setupVersionInApp();

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/versions/${version.id}/detail?tabs=history`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.history));
  assert.ok(body.history.length >= 1);
  const createdEvent = body.history.find((e: any) => e.eventType === "created");
  assert.ok(createdEvent);
  assert.equal(createdEvent.actor, "artist@studio.com");
  await app.close();
});

test("GET /api/v1/versions/:id/detail supports multiple tabs", async () => {
  const { app, version } = await setupVersionInApp();

  const res = await app.inject({
    method: "GET",
    url: `/api/v1/versions/${version.id}/detail?tabs=info,history,aovs,vast`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.info);
  assert.ok(Array.isArray(body.history));
  assert.equal(body.aovs, null);
  assert.equal(body.vast, null);
  await app.close();
});
