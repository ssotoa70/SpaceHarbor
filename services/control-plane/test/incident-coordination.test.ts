import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTestApp() {
  return buildApp();
}

// ---------------------------------------------------------------------------
// Existing: integration smoke (retained)
// ---------------------------------------------------------------------------

test("incident coordination routes persist shared actions, notes, and handoff state", async () => {
  const app = buildTestApp();

  const initial = await app.inject({
    method: "GET",
    url: "/api/v1/incident/coordination"
  });

  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json(), {
    guidedActions: {
      acknowledged: false,
      owner: "",
      escalated: false,
      nextUpdateEta: null,
      updatedAt: null
    },
    handoff: {
      state: "none",
      fromOwner: "",
      toOwner: "",
      summary: "",
      updatedAt: null
    },
    notes: []
  });

  const actionsUpdate = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    headers: {
      "x-correlation-id": "corr-incident-actions-1"
    },
    payload: {
      acknowledged: true,
      owner: "oncall-supervisor",
      escalated: true,
      nextUpdateEta: "2026-02-15T03:00:00.000Z",
      expectedUpdatedAt: null
    }
  });

  assert.equal(actionsUpdate.statusCode, 200);
  assert.equal(actionsUpdate.json().guidedActions.acknowledged, true);
  assert.equal(actionsUpdate.json().guidedActions.owner, "oncall-supervisor");
  assert.equal(actionsUpdate.json().guidedActions.escalated, true);
  assert.equal(actionsUpdate.json().guidedActions.nextUpdateEta, "2026-02-15T03:00:00.000Z");
  assert.equal(typeof actionsUpdate.json().guidedActions.updatedAt, "string");

  const staleActionsUpdate = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    headers: {
      "x-correlation-id": "corr-incident-actions-stale-1"
    },
    payload: {
      acknowledged: false,
      owner: "oncall-supervisor",
      escalated: true,
      nextUpdateEta: null,
      expectedUpdatedAt: null
    }
  });

  assert.equal(staleActionsUpdate.statusCode, 409);
  assert.equal(staleActionsUpdate.json().code, "COORDINATION_CONFLICT");

  const noteCreate = await app.inject({
    method: "POST",
    url: "/api/v1/incident/coordination/notes",
    headers: {
      "x-correlation-id": "corr-incident-note-write-1"
    },
    payload: {
      message: "Waiting on storage team update",
      correlationId: "corr-vast-fallback-123",
      author: "operator-a"
    }
  });

  assert.equal(noteCreate.statusCode, 201);
  assert.equal(noteCreate.json().note.message, "Waiting on storage team update");
  assert.equal(noteCreate.json().note.correlationId, "corr-vast-fallback-123");
  assert.equal(noteCreate.json().note.author, "operator-a");

  const handoffUpdate = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    headers: {
      "x-correlation-id": "corr-incident-handoff-1"
    },
    payload: {
      state: "handoff_requested",
      fromOwner: "operator-a",
      toOwner: "operator-b",
      summary: "Shift change at 19:00 UTC",
      expectedUpdatedAt: null
    }
  });

  assert.equal(handoffUpdate.statusCode, 200);
  assert.equal(handoffUpdate.json().handoff.state, "handoff_requested");
  assert.equal(handoffUpdate.json().handoff.fromOwner, "operator-a");
  assert.equal(handoffUpdate.json().handoff.toOwner, "operator-b");
  assert.equal(handoffUpdate.json().handoff.summary, "Shift change at 19:00 UTC");
  assert.equal(typeof handoffUpdate.json().handoff.updatedAt, "string");

  const updated = await app.inject({
    method: "GET",
    url: "/api/v1/incident/coordination"
  });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().guidedActions.owner, "oncall-supervisor");
  assert.equal(updated.json().notes.length, 1);
  assert.equal(updated.json().notes[0].correlationId, "corr-vast-fallback-123");
  assert.equal(updated.json().handoff.toOwner, "operator-b");

  const audit = await app.inject({
    method: "GET",
    url: "/api/v1/audit"
  });

  assert.equal(audit.statusCode, 200);
  const messages = (audit.json().events as Array<{ message: string }>).map((event) => event.message);
  assert.equal(messages.some((message) => message.includes("incident actions updated")), true);
  assert.equal(messages.some((message) => message.includes("incident note added")), true);
  assert.equal(messages.some((message) => message.includes("incident handoff updated")), true);

  await app.close();
});

// ---------------------------------------------------------------------------
// OCC: concurrent update conflict on guided actions
// ---------------------------------------------------------------------------

test("concurrent actions update — second writer with stale expectedUpdatedAt receives 409", async () => {
  const app = buildTestApp();

  // Writer A performs the first update
  const firstUpdate = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: true,
      owner: "writer-a",
      escalated: false,
      nextUpdateEta: null,
      expectedUpdatedAt: null  // correct: was null before any writes
    }
  });
  assert.equal(firstUpdate.statusCode, 200);
  const updatedAt = firstUpdate.json().guidedActions.updatedAt as string;
  assert.ok(updatedAt, "first update should return a non-null updatedAt");

  // Writer B — simulates a concurrent writer that also read updatedAt=null
  // (stale view: it still sends expectedUpdatedAt=null even though state has moved)
  const conflictUpdate = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: false,
      owner: "writer-b",
      escalated: true,
      nextUpdateEta: null,
      expectedUpdatedAt: null  // stale — the current updatedAt is now a real timestamp
    }
  });

  assert.equal(conflictUpdate.statusCode, 409);
  assert.equal(conflictUpdate.json().code, "COORDINATION_CONFLICT");
  assert.equal(typeof conflictUpdate.json().details.currentUpdatedAt, "string",
    "conflict response should include the current server updatedAt so the client can refresh");

  // Verify writer A's data is still in place — writer B did not clobber it
  const state = await app.inject({ method: "GET", url: "/api/v1/incident/coordination" });
  assert.equal(state.json().guidedActions.owner, "writer-a");

  await app.close();
});

// ---------------------------------------------------------------------------
// OCC: concurrent update conflict on handoff
// ---------------------------------------------------------------------------

test("concurrent handoff update — second writer with stale expectedUpdatedAt receives 409", async () => {
  const app = buildTestApp();

  // First writer initiates a handoff
  const first = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "handoff_requested",
      fromOwner: "operator-a",
      toOwner: "operator-b",
      summary: "First shift change",
      expectedUpdatedAt: null
    }
  });
  assert.equal(first.statusCode, 200);

  // Second writer still uses the null sentinel — stale
  const conflict = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "handoff_accepted",
      fromOwner: "operator-a",
      toOwner: "operator-c",
      summary: "Different shift change",
      expectedUpdatedAt: null  // stale
    }
  });

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "COORDINATION_CONFLICT");

  await app.close();
});

// ---------------------------------------------------------------------------
// Adding notes: multiple notes accumulate in order
// ---------------------------------------------------------------------------

test("multiple incident notes accumulate in order", async () => {
  const app = buildTestApp();

  const noteA = await app.inject({
    method: "POST",
    url: "/api/v1/incident/coordination/notes",
    payload: {
      message: "Storage failover initiated",
      correlationId: "corr-001",
      author: "operator-a"
    }
  });
  assert.equal(noteA.statusCode, 201);
  const noteAId = noteA.json().note.id as string;
  assert.ok(noteAId);

  const noteB = await app.inject({
    method: "POST",
    url: "/api/v1/incident/coordination/notes",
    payload: {
      message: "Failover complete, monitoring",
      correlationId: "corr-002",
      author: "operator-b"
    }
  });
  assert.equal(noteB.statusCode, 201);
  assert.notEqual(noteB.json().note.id, noteAId, "each note should have a unique id");

  const state = await app.inject({ method: "GET", url: "/api/v1/incident/coordination" });
  const notes = state.json().notes as Array<{ message: string; author: string }>;
  assert.equal(notes.length, 2);
  // Notes are stored newest-first (unshift), so operator-b's note is at index 0
  const authors = notes.map((n) => n.author);
  assert.ok(authors.includes("operator-a"), "operator-a note should be present");
  assert.ok(authors.includes("operator-b"), "operator-b note should be present");

  await app.close();
});

// ---------------------------------------------------------------------------
// Note validation: missing required fields
// ---------------------------------------------------------------------------

test("note creation rejects missing message field", async () => {
  const app = buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/incident/coordination/notes",
    payload: {
      message: "",   // empty after trim
      correlationId: "corr-999",
      author: "operator-z"
    }
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "VALIDATION_ERROR");

  await app.close();
});

test("note creation rejects missing author field", async () => {
  const app = buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/incident/coordination/notes",
    payload: {
      message: "Something happened",
      correlationId: "corr-999",
      author: ""   // empty after trim
    }
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "VALIDATION_ERROR");

  await app.close();
});

// ---------------------------------------------------------------------------
// Handoff workflow: full state machine progression
// ---------------------------------------------------------------------------

test("handoff workflow: none -> handoff_requested -> handoff_accepted", async () => {
  const app = buildTestApp();

  // Initiate handoff request
  const requested = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "handoff_requested",
      fromOwner: "shift-lead-alice",
      toOwner: "shift-lead-bob",
      summary: "EOD handoff — all systems green",
      expectedUpdatedAt: null
    }
  });
  assert.equal(requested.statusCode, 200);
  const requestedAt = requested.json().handoff.updatedAt as string;
  assert.equal(requested.json().handoff.state, "handoff_requested");

  // Accept handoff — must supply the current updatedAt to prevent OCC conflict
  const accepted = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "handoff_accepted",
      fromOwner: "shift-lead-alice",
      toOwner: "shift-lead-bob",
      summary: "Handoff accepted by bob",
      expectedUpdatedAt: requestedAt
    }
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().handoff.state, "handoff_accepted");
  assert.notEqual(accepted.json().handoff.updatedAt, requestedAt,
    "updatedAt should advance on each write");

  // Reset back to none
  const reset = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "none",
      fromOwner: "",
      toOwner: "",
      summary: "",
      expectedUpdatedAt: accepted.json().handoff.updatedAt
    }
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().handoff.state, "none");

  await app.close();
});

test("handoff with active state (handoff_requested) requires fromOwner and toOwner", async () => {
  const app = buildTestApp();

  const res = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/handoff",
    payload: {
      state: "handoff_requested",
      fromOwner: "",   // missing
      toOwner: "",     // missing
      summary: "No owners provided",
      expectedUpdatedAt: null
    }
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "VALIDATION_ERROR");

  await app.close();
});

// ---------------------------------------------------------------------------
// Missing / invalid expectedUpdatedAt on actions update
// ---------------------------------------------------------------------------

test("actions update with correct expectedUpdatedAt succeeds after initial write", async () => {
  const app = buildTestApp();

  // First write — expectedUpdatedAt must be null (matches initial state)
  const first = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: false,
      owner: "first-writer",
      escalated: false,
      nextUpdateEta: null,
      expectedUpdatedAt: null
    }
  });
  assert.equal(first.statusCode, 200);
  const firstUpdatedAt = first.json().guidedActions.updatedAt as string;

  // Second write — client refreshed and now sends the correct current timestamp
  const second = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: true,
      owner: "second-writer",
      escalated: true,
      nextUpdateEta: null,
      expectedUpdatedAt: firstUpdatedAt
    }
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().guidedActions.owner, "second-writer");

  await app.close();
});

test("actions update with wrong expectedUpdatedAt (wrong timestamp) returns 409", async () => {
  const app = buildTestApp();

  // First write
  const first = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: false,
      owner: "owner-one",
      escalated: false,
      nextUpdateEta: null,
      expectedUpdatedAt: null
    }
  });
  assert.equal(first.statusCode, 200);

  // Client sends an arbitrary wrong timestamp
  const stale = await app.inject({
    method: "PUT",
    url: "/api/v1/incident/coordination/actions",
    payload: {
      acknowledged: true,
      owner: "owner-two",
      escalated: false,
      nextUpdateEta: null,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z"  // wrong — predates the system
    }
  });

  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "COORDINATION_CONFLICT");

  await app.close();
});
