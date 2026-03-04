import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

test("incident coordination routes persist shared actions, notes, and handoff state", async () => {
  const app = buildApp();

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
