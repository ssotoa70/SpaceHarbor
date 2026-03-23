import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

describe("Shot board routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("GET /api/v1/shots/board", () => {
    it("returns 400 without projectId", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/shots/board" });
      assert.equal(res.statusCode, 400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/shots/board?projectId=nonexistent" });
      assert.equal(res.statusCode, 404);
    });

    it("returns empty columns for project with no shots", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-sb-1" };
      const project = await persistence.createProject({
        code: "SB1", name: "Shot Board Test", type: "feature", status: "active"
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/api/v1/shots/board?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.projectId, project.id);
      assert.equal(body.totalShots, 0);
      assert.ok(body.columns);
      assert.ok(Array.isArray(body.columns.active));
      assert.ok(Array.isArray(body.columns.delivered));
    });

    it("returns shots grouped by status columns", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-sb-2" };
      const project = await persistence.createProject({
        code: "SB2", name: "Shot Board Test 2", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ010", status: "active"
      }, ctx);
      await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH010",
        status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100
      }, ctx);
      await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH020",
        status: "delivered", frameRangeStart: 1101, frameRangeEnd: 1200, frameCount: 100
      }, ctx);
      await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH030",
        status: "active", frameRangeStart: 1201, frameRangeEnd: 1300, frameCount: 100
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/api/v1/shots/board?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.totalShots, 3);
      assert.equal(body.columns.active.length, 2);
      assert.equal(body.columns.delivered.length, 1);
      assert.equal(body.columns.omit.length, 0);
      assert.equal(body.columns.locked.length, 0);
    });

    it("works on legacy prefix too", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-sb-3" };
      const project = await persistence.createProject({
        code: "SB3", name: "Shot Board Legacy", type: "feature", status: "active"
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/shots/board?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
    });
  });
});
