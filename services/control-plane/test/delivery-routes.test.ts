import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

describe("Delivery routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("GET /api/v1/delivery/status", () => {
    it("returns 400 without projectId", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/delivery/status" });
      assert.equal(res.statusCode, 400);
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/delivery/status?projectId=nonexistent" });
      assert.equal(res.statusCode, 404);
    });

    it("returns empty delivery status for project with no shots", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-del-1" };
      const project = await persistence.createProject({
        code: "DEL1", name: "Delivery Test", type: "feature", status: "active"
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/api/v1/delivery/status?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.projectId, project.id);
      assert.equal(body.totalShots, 0);
      assert.equal(body.readyCount, 0);
      assert.equal(body.notReadyCount, 0);
      assert.equal(body.readinessPercent, 0);
      assert.ok(Array.isArray(body.shots));
    });

    it("aggregates delivery readiness correctly", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-del-2" };
      const project = await persistence.createProject({
        code: "DEL2", name: "Delivery Test 2", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ010", status: "active"
      }, ctx);

      // Shot 1: delivered (ready)
      await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH010",
        status: "delivered", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100
      }, ctx);

      // Shot 2: locked with approved version (ready)
      const shot2 = await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH020",
        status: "locked", frameRangeStart: 1101, frameRangeEnd: 1200, frameCount: 100
      }, ctx);
      await persistence.createVersion({
        shotId: shot2.id, projectId: project.id, sequenceId: seq.id,
        versionLabel: "v001", status: "wip", mediaType: "exr",
        createdBy: "artist", reviewStatus: "approved"
      }, ctx);

      // Shot 3: active, no approved version (not ready)
      await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH030",
        status: "active", frameRangeStart: 1201, frameRangeEnd: 1300, frameCount: 100
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/api/v1/delivery/status?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.totalShots, 3);
      assert.equal(body.readyCount, 2);
      assert.equal(body.notReadyCount, 1);
      assert.equal(body.readinessPercent, 67);
      assert.equal(body.shots.length, 3);

      // Check individual shot items
      const deliveredShot = body.shots.find((s: any) => s.shotCode === "SH010");
      assert.equal(deliveredShot.deliveryReady, true);

      const activeShot = body.shots.find((s: any) => s.shotCode === "SH030");
      assert.equal(activeShot.deliveryReady, false);
    });

    it("works on legacy prefix too", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-del-3" };
      const project = await persistence.createProject({
        code: "DEL3", name: "Delivery Legacy", type: "feature", status: "active"
      }, ctx);

      const res = await app.inject({ method: "GET", url: `/delivery/status?projectId=${project.id}` });
      assert.equal(res.statusCode, 200);
    });
  });
});
