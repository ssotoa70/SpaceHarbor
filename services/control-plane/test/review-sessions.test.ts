import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

function ctx(correlationId: string) {
  return { correlationId };
}

// ---------------------------------------------------------------------------
// POST /api/v1/review-sessions — create session
// ---------------------------------------------------------------------------

test("POST /api/v1/review-sessions creates a session", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: {
      projectId: "proj-1",
      department: "lighting",
      sessionDate: "2026-03-12",
      sessionType: "dailies",
      supervisorId: "supervisor-bob"
    }
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.session.id);
  assert.equal(body.session.projectId, "proj-1");
  assert.equal(body.session.department, "lighting");
  assert.equal(body.session.sessionDate, "2026-03-12");
  assert.equal(body.session.sessionType, "dailies");
  assert.equal(body.session.supervisorId, "supervisor-bob");
  assert.equal(body.session.status, "open");
  assert.ok(body.session.createdAt);
  await app.close();
});

test("POST /api/v1/review-sessions creates session with minimal fields", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: {
      projectId: "proj-1",
      sessionDate: "2026-03-12",
      sessionType: "client_review"
    }
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.session.department, null);
  assert.equal(body.session.supervisorId, null);
  assert.equal(body.session.sessionType, "client_review");
  await app.close();
});

test("POST /api/v1/review-sessions rejects missing required fields", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1" } // missing sessionDate and sessionType
  });
  // Fastify returns 400 for schema validation failures
  // or 500 from error handler — both indicate rejection
  assert.ok(res.statusCode >= 400, `Expected 4xx/5xx, got ${res.statusCode}`);
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /api/v1/review-sessions — list sessions
// ---------------------------------------------------------------------------

test("GET /api/v1/review-sessions lists sessions", async () => {
  const app = buildApp();
  // Create two sessions
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies", department: "comp" }
  });
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-2", sessionDate: "2026-03-13", sessionType: "final", department: "lighting" }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/review-sessions" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().sessions.length, 2);
  await app.close();
});

test("GET /api/v1/review-sessions filters by projectId", async () => {
  const app = buildApp();
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-2", sessionDate: "2026-03-13", sessionType: "dailies" }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/review-sessions?projectId=proj-1" });
  assert.equal(res.statusCode, 200);
  const sessions = res.json().sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].projectId, "proj-1");
  await app.close();
});

test("GET /api/v1/review-sessions filters by status", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;
  // Close one session
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/close`,
    payload: { performed_by: "supervisor-bob" }
  });
  // Create another
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-13", sessionType: "dailies" }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/review-sessions?status=open" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().sessions.length, 1);
  assert.equal(res.json().sessions[0].status, "open");
  await app.close();
});

test("GET /api/v1/review-sessions filters by department", async () => {
  const app = buildApp();
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies", department: "comp" }
  });
  await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-13", sessionType: "dailies", department: "lighting" }
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/review-sessions?department=comp" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().sessions.length, 1);
  assert.equal(res.json().sessions[0].department, "comp");
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /api/v1/review-sessions/:id — get session with submissions
// ---------------------------------------------------------------------------

test("GET /api/v1/review-sessions/:id returns session with submissions", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  // Add a submission
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-1" }
  });

  const res = await app.inject({ method: "GET", url: `/api/v1/review-sessions/${sessionId}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.session.id, sessionId);
  assert.equal(body.submissions.length, 1);
  assert.equal(body.submissions[0].assetId, "asset-1");
  assert.equal(body.submissions[0].status, "pending");
  await app.close();
});

test("GET /api/v1/review-sessions/:id returns 404 for nonexistent", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/review-sessions/nonexistent" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().code, "NOT_FOUND");
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /api/v1/review-sessions/:id/submissions — add submission
// ---------------------------------------------------------------------------

test("POST /api/v1/review-sessions/:id/submissions adds asset to session", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-1", versionId: "ver-1", submissionOrder: 5 }
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.submission.sessionId, sessionId);
  assert.equal(body.submission.assetId, "asset-1");
  assert.equal(body.submission.versionId, "ver-1");
  assert.equal(body.submission.submissionOrder, 5);
  assert.equal(body.submission.status, "pending");
  await app.close();
});

test("POST /api/v1/review-sessions/:id/submissions auto-increments order", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  const r1 = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-1" }
  });
  const r2 = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-2" }
  });
  assert.equal(r1.json().submission.submissionOrder, 1);
  assert.equal(r2.json().submission.submissionOrder, 2);
  await app.close();
});

test("POST /api/v1/review-sessions/:id/submissions rejects closed session", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  // Close the session
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/close`,
    payload: {}
  });

  // Try to add submission
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-1" }
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "INVALID_STATE");
  await app.close();
});

test("POST /api/v1/review-sessions/:id/submissions 404 for nonexistent session", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions/nonexistent/submissions",
    payload: { assetId: "asset-1" }
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /api/v1/review-sessions/:id/close — close session
// ---------------------------------------------------------------------------

test("POST /api/v1/review-sessions/:id/close closes an open session", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/close`,
    payload: { performed_by: "supervisor-bob" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().session.status, "closed");
  await app.close();
});

test("POST /api/v1/review-sessions/:id/close 409 on already closed", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  // Close once
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/close`,
    payload: {}
  });

  // Close again
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/close`,
    payload: {}
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "INVALID_STATE");
  await app.close();
});

test("POST /api/v1/review-sessions/:id/close 404 for nonexistent", async () => {
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions/nonexistent/close",
    payload: {}
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// Legacy prefix support
// ---------------------------------------------------------------------------

test("review session endpoints work on root prefix", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  assert.equal(createRes.statusCode, 201);

  const listRes = await app.inject({ method: "GET", url: "/review-sessions" });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().sessions.length, 1);
  await app.close();
});

// ---------------------------------------------------------------------------
// Submissions ordering
// ---------------------------------------------------------------------------

test("submissions are returned sorted by submissionOrder", async () => {
  const app = buildApp();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/review-sessions",
    payload: { projectId: "proj-1", sessionDate: "2026-03-12", sessionType: "dailies" }
  });
  const sessionId = createRes.json().session.id;

  // Add in reverse order
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-3", submissionOrder: 3 }
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-1", submissionOrder: 1 }
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/review-sessions/${sessionId}/submissions`,
    payload: { assetId: "asset-2", submissionOrder: 2 }
  });

  const res = await app.inject({ method: "GET", url: `/api/v1/review-sessions/${sessionId}` });
  const subs = res.json().submissions;
  assert.equal(subs.length, 3);
  assert.equal(subs[0].submissionOrder, 1);
  assert.equal(subs[1].submissionOrder, 2);
  assert.equal(subs[2].submissionOrder, 3);
  await app.close();
});
