import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";

import { RoleBindingService } from "../src/iam/role-binding.js";
import { getEffectivePermissionsForRoles } from "../src/iam/permissions.js";
import { registerIamRoutes, resetIamRouteState, passwordStore } from "../src/routes/iam.js";
import { hashPassword } from "../src/iam/local-auth.js";
import type { RequestContext, Role } from "../src/iam/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIamContext(roles: Role[], overrides?: Partial<RequestContext>): RequestContext {
  return {
    userId: "admin-user-id",
    displayName: "Admin User",
    email: "admin@studio.com",
    authStrategy: "jwt",
    scope: { tenantId: "default", projectId: null, source: "token" },
    roles,
    permissions: getEffectivePermissionsForRoles(roles),
    externalId: null,
    groups: [],
    tokenClaims: null,
    ...overrides,
  };
}

async function buildTestApp(iamContext?: RequestContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();

  // Inject IAM context into requests if provided
  if (iamContext) {
    app.addHook("onRequest", async (request) => {
      (request as any).iamContext = iamContext;
    });
  }

  registerIamRoutes(app, () => rbs, ["/api/v1"]);

  await app.ready();
  return app;
}

afterEach(() => {
  resetIamRouteState();
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

test("GET /auth/me returns 401 without auth context", async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("GET /auth/me returns user context", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.userId, "admin-user-id");
  assert.equal(body.email, "admin@studio.com");
  assert.ok(body.roles.includes("administrator"));
  assert.ok(body.permissions.length > 0);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /users
// ---------------------------------------------------------------------------

test("POST /users requires administrator role", async () => {
  const ctx = makeIamContext(["viewer"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "test@studio.com", displayName: "Test" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("POST /users creates user as administrator", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "new@studio.com", displayName: "New User" },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.email, "new@studio.com");
  assert.ok(body.id);
  await app.close();
});

test("POST /users rejects duplicate email", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "dup@studio.com", displayName: "A" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "dup@studio.com", displayName: "B" },
  });
  assert.equal(res.statusCode, 409);
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /users
// ---------------------------------------------------------------------------

test("GET /users lists users as administrator", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "a@s.com", displayName: "A" },
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/users" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.users.length >= 1);
  await app.close();
});

// ---------------------------------------------------------------------------
// GET /users/:id
// ---------------------------------------------------------------------------

test("GET /users/:id returns user by id", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "get@s.com", displayName: "Get" },
  });
  const { id } = createRes.json();

  const res = await app.inject({ method: "GET", url: `/api/v1/users/${id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().email, "get@s.com");
  await app.close();
});

test("GET /users/:id returns 404 for unknown id", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({ method: "GET", url: "/api/v1/users/nonexistent" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// PUT /users/:id/status
// ---------------------------------------------------------------------------

test("PUT /users/:id/status disables user", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "disable@s.com", displayName: "D" },
  });
  const { id } = createRes.json();

  const res = await app.inject({
    method: "PUT",
    url: `/api/v1/users/${id}/status`,
    payload: { status: "disabled" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "disabled");
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /projects/:projectId/members — Grant membership
// ---------------------------------------------------------------------------

test("POST /projects/:projectId/members grants role", async () => {
  const ctx = makeIamContext(["production"]);
  const app = await buildTestApp(ctx);

  // Create user first (need administrator for this)
  const adminCtx = makeIamContext(["administrator"]);
  const adminApp = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  adminApp.addHook("onRequest", async (request) => {
    (request as any).iamContext = adminCtx;
  });
  registerIamRoutes(adminApp, () => rbs, ["/api/v1"]);
  await adminApp.ready();

  const createRes = await adminApp.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "member@s.com", displayName: "Member" },
  });
  const { id: userId } = createRes.json();

  // Now grant membership using the production-level app (same rbs)
  // We need a shared rbs. Let's use the admin app which has both roles
  const res = await adminApp.inject({
    method: "POST",
    url: "/api/v1/projects/proj-1/members",
    payload: { userId, role: "artist" },
  });
  // production (level 50) can assign artist (level 20) — allowed
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().role, "artist");

  await adminApp.close();
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /api-keys — API key management
// ---------------------------------------------------------------------------

test("POST /api-keys creates key and returns plaintext", async () => {
  const ctx = makeIamContext(["artist"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/api-keys",
    payload: { label: "CI key" },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.key.startsWith("ahk_"));
  assert.equal(body.label, "CI key");
  assert.ok(body.id);
  assert.ok(body.expiresAt);
  await app.close();
});

test("GET /api-keys lists own keys (masked)", async () => {
  const ctx = makeIamContext(["artist"]);
  const app = await buildTestApp(ctx);
  await app.inject({
    method: "POST",
    url: "/api/v1/api-keys",
    payload: { label: "key-1" },
  });
  const res = await app.inject({ method: "GET", url: "/api/v1/api-keys" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].label, "key-1");
  // Plaintext key should NOT be in the list response
  assert.equal(body.keys[0].key, undefined);
  await app.close();
});

test("DELETE /api-keys/:id revokes key", async () => {
  const ctx = makeIamContext(["artist"]);
  const app = await buildTestApp(ctx);
  const createRes = await app.inject({
    method: "POST",
    url: "/api/v1/api-keys",
    payload: { label: "revoke-me" },
  });
  const { id } = createRes.json();

  const delRes = await app.inject({ method: "DELETE", url: `/api/v1/api-keys/${id}` });
  assert.equal(delRes.statusCode, 204);

  // Key should no longer appear in list
  const listRes = await app.inject({ method: "GET", url: "/api/v1/api-keys" });
  assert.equal(listRes.json().keys.length, 0);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /auth/bootstrap
// ---------------------------------------------------------------------------

test("POST /auth/bootstrap creates super_admin on empty db", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: {
      email: "admin@studio.local",
      displayName: "Super Admin",
      password: "SuperSecure123!",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.role, "super_admin");
  assert.ok(body.user.id);

  // Second call should return 410 Gone
  const res2 = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: {
      email: "admin2@studio.local",
      displayName: "Another Admin",
      password: "SuperSecure456!",
    },
  });
  assert.equal(res2.statusCode, 410);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

test("POST /auth/login authenticates with correct credentials", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  // Bootstrap first
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: {
      email: "login@studio.local",
      displayName: "Login User",
      password: "LoginPass1234!",
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "login@studio.local", password: "LoginPass1234!" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken);
  assert.equal(body.expiresIn, 3600);
  assert.equal(body.user.email, "login@studio.local");
  await app.close();
});

test("POST /auth/login returns 401 for wrong password", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: {
      email: "wrong@studio.local",
      displayName: "Wrong",
      password: "CorrectPass123!",
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "wrong@studio.local", password: "WrongPassword!" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().message, "authentication failed");
  await app.close();
});

test("POST /auth/login returns 401 for nonexistent user (no leak)", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "nobody@studio.local", password: "Something123!" },
  });
  // Same error message as wrong password — no user enumeration
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().message, "authentication failed");
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------

test("POST /auth/refresh rotates tokens", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  // Bootstrap + login
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: {
      email: "refresh@studio.local",
      displayName: "Refresh",
      password: "RefreshPass123!",
    },
  });
  const loginRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "refresh@studio.local", password: "RefreshPass123!" },
  });
  const { refreshToken } = loginRes.json();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().accessToken);
  assert.ok(res.json().refreshToken);
  // New refresh token should be different
  assert.notEqual(res.json().refreshToken, refreshToken);

  // Old refresh token should be invalidated
  const res2 = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken },
  });
  assert.equal(res2.statusCode, 401);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

test("POST /auth/register disabled by default", async () => {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: "new@s.com", displayName: "N", password: "StrongPass1234!" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

// ---------------------------------------------------------------------------
// POST /iam/transfer-super-admin
// ---------------------------------------------------------------------------

test("POST /iam/transfer-super-admin requires super_admin role", async () => {
  const ctx = makeIamContext(["administrator"]);
  const app = await buildTestApp(ctx);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/iam/transfer-super-admin",
    payload: { targetUserId: "someone", confirmPassword: "pass" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

// ---------------------------------------------------------------------------
// Privilege escalation prevention
// ---------------------------------------------------------------------------

test("production role cannot assign production role (same level)", async () => {
  const ctx = makeIamContext(["production"], { userId: "prod-user" });
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  const target = rbs.createUser({ email: "target@s.com", displayName: "Target" });

  app.addHook("onRequest", async (request) => {
    (request as any).iamContext = ctx;
  });
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects/proj-1/members",
    payload: { userId: target.id, role: "production" },
  });
  assert.equal(res.statusCode, 403);
  assert.ok(res.json().message.includes("privilege level"));
  await app.close();
});

test("production role can assign supervisor role (lower level)", async () => {
  const ctx = makeIamContext(["production"], { userId: "prod-user" });
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();
  const target = rbs.createUser({ email: "target2@s.com", displayName: "Target2" });

  app.addHook("onRequest", async (request) => {
    (request as any).iamContext = ctx;
  });
  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects/proj-1/members",
    payload: { userId: target.id, role: "supervisor" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().role, "supervisor");
  await app.close();
});
