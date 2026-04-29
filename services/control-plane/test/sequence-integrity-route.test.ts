import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerSequenceIntegrityRoute } from "../src/routes/sequence-integrity.js";

function mkApp() {
  const app = Fastify();
  registerSequenceIntegrityRoute(app, ["/api/v1"]);
  return app;
}

test("POST /assets/:id/sequence-integrity returns 503 NOT_IMPLEMENTED", async () => {
  const app = mkApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/abc-123/sequence-integrity",
  });
  assert.equal(res.statusCode, 503);
  const body = res.json() as { code: string; message: string };
  assert.equal(body.code, "NOT_IMPLEMENTED");
  assert.match(body.message, /scanner not yet implemented/i);
  await app.close();
});

test("POST /assets/:id/sequence-integrity rejects malformed asset ids (400)", async () => {
  const app = mkApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/assets/abc'%20OR%201=1/sequence-integrity",
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
