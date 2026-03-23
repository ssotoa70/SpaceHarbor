import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

describe("Work routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("GET /api/v1/work/queue", () => {
    it("returns 400 without assignee", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/work/queue" });
      assert.equal(res.statusCode, 400);
    });

    it("returns empty tasks for unknown assignee", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/work/queue?assignee=nobody" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.tasks));
      assert.equal(body.tasks.length, 0);
    });

    it("returns tasks filtered by assignee", async () => {
      // Seed hierarchy: project > sequence > shot > tasks
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-1" };
      const project = await persistence.createProject({
        code: "TST", name: "Test Project", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ010", status: "active"
      }, ctx);
      const shot = await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH010",
        status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100
      }, ctx);
      await persistence.createTask({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        code: "comp", type: "comp", status: "in_progress", assignee: "artist-a"
      }, ctx);
      await persistence.createTask({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        code: "roto", type: "roto", status: "not_started", assignee: "artist-b"
      }, ctx);

      const res = await app.inject({ method: "GET", url: "/api/v1/work/queue?assignee=artist-a" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.tasks.length, 1);
      assert.equal(body.tasks[0].assignee, "artist-a");
    });

    it("filters by status when provided", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-2" };
      const project = await persistence.createProject({
        code: "TST2", name: "Test Project 2", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ020", status: "active"
      }, ctx);
      const shot = await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH020",
        status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100
      }, ctx);
      await persistence.createTask({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        code: "comp", type: "comp", status: "in_progress", assignee: "artist-c"
      }, ctx);
      await persistence.createTask({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        code: "roto", type: "roto", status: "not_started", assignee: "artist-c"
      }, ctx);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/work/queue?assignee=artist-c&status=in_progress"
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.tasks.length, 1);
      assert.equal(body.tasks[0].status, "in_progress");
    });

    it("works on legacy prefix too", async () => {
      const res = await app.inject({ method: "GET", url: "/work/queue?assignee=nobody" });
      assert.equal(res.statusCode, 200);
    });
  });

  describe("GET /api/v1/work/assignments", () => {
    it("returns 400 without user", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/work/assignments" });
      assert.equal(res.statusCode, 400);
    });

    it("returns empty results for unknown user", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/work/assignments?user=nobody" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.shots));
      assert.ok(Array.isArray(body.versions));
      assert.equal(body.shots.length, 0);
      assert.equal(body.versions.length, 0);
    });

    it("returns shots by lead and versions by createdBy", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-3" };
      const project = await persistence.createProject({
        code: "TST3", name: "Test Project 3", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ030", status: "active"
      }, ctx);
      const shot = await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH030",
        status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100,
        lead: "supervisor-x"
      }, ctx);
      await persistence.createVersion({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        versionLabel: "v001", status: "wip", mediaType: "exr", createdBy: "supervisor-x"
      }, ctx);

      const res = await app.inject({ method: "GET", url: "/api/v1/work/assignments?user=supervisor-x" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.shots.length, 1);
      assert.equal(body.shots[0].lead, "supervisor-x");
      assert.equal(body.versions.length, 1);
      assert.equal(body.versions[0].createdBy, "supervisor-x");
    });
  });
});
