import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { scheduleBadgeBroadcast, cancelPendingBadgeBroadcast } from "../src/routes/events-stream.js";

describe("Nav badge routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    cancelPendingBadgeBroadcast();
    if (app) await app.close();
  });

  describe("GET /api/v1/nav/badges", () => {
    it("returns 200 with correct shape (empty state)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/nav/badges" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.queue === "number");
      assert.ok(typeof body.assignments === "number");
      assert.ok(typeof body.approvals === "number");
      assert.ok(typeof body.feedback === "number");
      assert.ok(typeof body.dlq === "number");
    });

    it("returns zero counts when no data exists", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/nav/badges" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.queue, 0);
      assert.equal(body.assignments, 0);
      assert.equal(body.approvals, 0);
      assert.equal(body.feedback, 0);
      assert.equal(body.dlq, 0);
    });

    it("reflects version review status in approvals count", async () => {
      const persistence = (app as any).persistence;
      const ctx = { correlationId: "test-badge-1" };
      const project = await persistence.createProject({
        code: "BDG1", name: "Badge Test", type: "feature", status: "active"
      }, ctx);
      const seq = await persistence.createSequence({
        projectId: project.id, code: "SQ010", status: "active"
      }, ctx);
      const shot = await persistence.createShot({
        projectId: project.id, sequenceId: seq.id, code: "SH010",
        status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100
      }, ctx);
      await persistence.createVersion({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        versionLabel: "v001", status: "wip", mediaType: "exr",
        createdBy: "artist", reviewStatus: "internal_review"
      }, ctx);
      await persistence.createVersion({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        versionLabel: "v002", status: "wip", mediaType: "exr",
        createdBy: "artist", reviewStatus: "client_review"
      }, ctx);
      await persistence.createVersion({
        shotId: shot.id, projectId: project.id, sequenceId: seq.id,
        versionLabel: "v003", status: "wip", mediaType: "exr",
        createdBy: "artist", reviewStatus: "wip"
      }, ctx);

      const res = await app.inject({ method: "GET", url: "/api/v1/nav/badges" });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.approvals, 2);
      assert.equal(body.feedback, 1);
    });

    it("works on legacy prefix too", async () => {
      const res = await app.inject({ method: "GET", url: "/nav/badges" });
      assert.equal(res.statusCode, 200);
    });
  });

  describe("Badge SSE broadcast", () => {
    it("scheduleBadgeBroadcast does not throw", () => {
      // Just verify the function exists and is callable
      assert.doesNotThrow(() => {
        scheduleBadgeBroadcast({
          queue: 0, assignments: 0, approvals: 0, feedback: 0, dlq: 0
        });
      });
    });

    it("cancelPendingBadgeBroadcast does not throw", () => {
      scheduleBadgeBroadcast({
        queue: 1, assignments: 2, approvals: 3, feedback: 0, dlq: 1
      });
      assert.doesNotThrow(() => {
        cancelPendingBadgeBroadcast();
      });
    });
  });
});
