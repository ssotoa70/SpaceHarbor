// ---------------------------------------------------------------------------
// Phase 3.2: Session Security Hardening Tests
// ---------------------------------------------------------------------------

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";

import { RoleBindingService } from "../src/iam/role-binding.js";
import { getEffectivePermissionsForRoles } from "../src/iam/permissions.js";
import {
  registerIamRoutes,
  resetIamRouteState,
  passwordStore,
  refreshTokenStore,
  revokedSessions,
  activeSessions,
  isSessionRevoked,
} from "../src/routes/iam.js";
import { hashPassword } from "../src/iam/local-auth.js";
import {
  resetCsrfState,
  csrfTokenStore,
  validateCsrfToken,
  csrfHook,
  storeCsrfToken,
  generateCsrfToken,
} from "../src/iam/csrf.js";
import {
  resetTokenBindingState,
  createTokenFingerprint,
  bindToken,
  verifyTokenBinding,
  tokenBindings,
} from "../src/iam/token-binding.js";
import type { RequestContext, Role } from "../src/iam/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL = "csrfuser@studio.local";
const TEST_PASSWORD = "SecurePass123!";

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

async function buildTestApp(iamContext?: RequestContext): Promise<{ app: FastifyInstance; rbs: RoleBindingService }> {
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
  return { app, rbs };
}

async function buildTestAppWithCsrf(): Promise<{ app: FastifyInstance; rbs: RoleBindingService }> {
  const app = Fastify({ logger: false });
  const rbs = new RoleBindingService();

  // Register CSRF hook before routes
  app.addHook("onRequest", csrfHook);

  registerIamRoutes(app, () => rbs, ["/api/v1"]);

  await app.ready();
  return { app, rbs };
}

async function createUserAndLogin(app: FastifyInstance, rbs: RoleBindingService) {
  const user = rbs.createUser({ email: TEST_EMAIL, displayName: "CSRF User" });
  const hash = await hashPassword(TEST_PASSWORD);
  passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });
  rbs.grantGlobalRole(user.id, "administrator", "test");

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  return { user, loginResult: res.json() };
}

afterEach(() => {
  resetIamRouteState();
  resetCsrfState();
  resetTokenBindingState();
});

// ---------------------------------------------------------------------------
// CSRF Tests
// ---------------------------------------------------------------------------

test("Phase 3.2: CSRF — login returns a csrfToken", async () => {
  const { app, rbs } = await buildTestApp();
  const { loginResult } = await createUserAndLogin(app, rbs);

  assert.ok(loginResult.csrfToken, "login response should include csrfToken");
  assert.equal(typeof loginResult.csrfToken, "string");
  assert.equal(loginResult.csrfToken.length, 64, "CSRF token should be 32 bytes hex (64 chars)");

  // Verify the CSRF token is stored for this session
  assert.ok(
    validateCsrfToken(loginResult.refreshToken, loginResult.csrfToken),
    "CSRF token should be valid for the session",
  );

  await app.close();
});

test("Phase 3.2: CSRF — POST with session but no CSRF token gets 403", async () => {
  const { app, rbs } = await buildTestAppWithCsrf();
  const { user, loginResult } = await createUserAndLogin(app, rbs);

  // Simulate a session-based POST by adding iamContext and sessionId manually
  // We inject via a custom route that sets sessionId
  const innerApp = Fastify({ logger: false });
  const innerRbs = new RoleBindingService();

  // Set up hooks to simulate session-based auth
  innerApp.addHook("onRequest", async (request) => {
    (request as any).iamContext = makeIamContext(["administrator"], { userId: user.id });
    (request as any).sessionId = loginResult.refreshToken;
  });
  innerApp.addHook("onRequest", csrfHook);

  innerApp.post("/api/v1/test-endpoint", async (_req, reply) => {
    return reply.send({ ok: true });
  });
  await innerApp.ready();

  // POST without CSRF token -> 403
  const noTokenRes = await innerApp.inject({
    method: "POST",
    url: "/api/v1/test-endpoint",
    payload: {},
  });
  assert.equal(noTokenRes.statusCode, 403, "POST without CSRF token should return 403");
  assert.equal(noTokenRes.json().code, "CSRF_REQUIRED");

  // POST with valid CSRF token -> 200
  const withTokenRes = await innerApp.inject({
    method: "POST",
    url: "/api/v1/test-endpoint",
    headers: { "x-csrf-token": loginResult.csrfToken },
    payload: {},
  });
  assert.equal(withTokenRes.statusCode, 200, "POST with valid CSRF token should return 200");

  // POST with wrong CSRF token -> 403
  const wrongTokenRes = await innerApp.inject({
    method: "POST",
    url: "/api/v1/test-endpoint",
    headers: { "x-csrf-token": "wrong-token" },
    payload: {},
  });
  assert.equal(wrongTokenRes.statusCode, 403, "POST with wrong CSRF token should return 403");
  assert.equal(wrongTokenRes.json().code, "CSRF_INVALID");

  await innerApp.close();
  await app.close();
});

test("Phase 3.2: CSRF — GET requests skip CSRF check", async () => {
  const innerApp = Fastify({ logger: false });

  innerApp.addHook("onRequest", async (request) => {
    (request as any).iamContext = makeIamContext(["administrator"]);
    (request as any).sessionId = "some-session";
  });
  innerApp.addHook("onRequest", csrfHook);

  innerApp.get("/api/v1/test-endpoint", async (_req, reply) => {
    return reply.send({ ok: true });
  });
  await innerApp.ready();

  const res = await innerApp.inject({
    method: "GET",
    url: "/api/v1/test-endpoint",
  });
  assert.equal(res.statusCode, 200, "GET requests should skip CSRF check");

  await innerApp.close();
});

test("Phase 3.2: CSRF — Bearer token auth skips CSRF check", async () => {
  const innerApp = Fastify({ logger: false });

  innerApp.addHook("onRequest", async (request) => {
    (request as any).iamContext = makeIamContext(["administrator"]);
    (request as any).sessionId = "some-session";
  });
  innerApp.addHook("onRequest", csrfHook);

  innerApp.post("/api/v1/test-endpoint", async (_req, reply) => {
    return reply.send({ ok: true });
  });
  await innerApp.ready();

  // Bearer token should bypass CSRF
  const res = await innerApp.inject({
    method: "POST",
    url: "/api/v1/test-endpoint",
    headers: { authorization: "Bearer some-jwt-token" },
    payload: {},
  });
  assert.equal(res.statusCode, 200, "Bearer auth should bypass CSRF");

  await innerApp.close();
});

// ---------------------------------------------------------------------------
// Session Revocation Tests
// ---------------------------------------------------------------------------

test("Phase 3.2: Session revocation — revoked session rejected on refresh", async () => {
  const { app, rbs } = await buildTestApp();
  const { loginResult } = await createUserAndLogin(app, rbs);
  const refreshToken = loginResult.refreshToken;

  // Revoke the session
  const revokeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/revoke",
    payload: { refreshToken },
  });
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.json().message, "session revoked");

  // Verify the session is in the revoked set
  assert.ok(isSessionRevoked(refreshToken), "session should be marked as revoked");

  // Attempt to refresh with the revoked token
  const refreshRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken },
  });
  assert.equal(refreshRes.statusCode, 401, "refresh with revoked token should return 401");

  await app.close();
});

test("Phase 3.2: Session revocation — revoke non-existent session returns 404", async () => {
  const { app } = await buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/revoke",
    payload: { refreshToken: "nonexistent-token" },
  });
  assert.equal(res.statusCode, 404);

  await app.close();
});

// ---------------------------------------------------------------------------
// Concurrent Session Limit Tests
// ---------------------------------------------------------------------------

test("Phase 3.2: Concurrent sessions — 6th login revokes 1st session", async () => {
  const { app, rbs } = await buildTestApp();

  const user = rbs.createUser({ email: TEST_EMAIL, displayName: "Multi Session User" });
  const hash = await hashPassword(TEST_PASSWORD);
  passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });
  rbs.grantGlobalRole(user.id, "administrator", "test");

  // Login 6 times
  const sessions: string[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    sessions.push(res.json().refreshToken);
  }

  // The first session should be revoked
  assert.ok(isSessionRevoked(sessions[0]), "first session should be revoked after 6th login");

  // Sessions 2-6 should still be active
  for (let i = 1; i < 6; i++) {
    assert.ok(!isSessionRevoked(sessions[i]), `session ${i + 1} should still be active`);
  }

  // Verify the first refresh token is revoked in the store too
  const firstEntry = refreshTokenStore.get(sessions[0]);
  assert.ok(firstEntry, "first session entry should still exist");
  assert.ok(firstEntry!.revokedAt, "first session should have revokedAt set");

  // The user should have exactly 5 active sessions
  const userSessionList = activeSessions.get(user.id);
  assert.ok(userSessionList, "user should have active sessions");
  assert.equal(userSessionList!.length, 5, "user should have exactly 5 active sessions");

  await app.close();
});

// ---------------------------------------------------------------------------
// Token Binding Tests
// ---------------------------------------------------------------------------

test("Phase 3.2: Token binding — createTokenFingerprint produces consistent hash", () => {
  const fp1 = createTokenFingerprint("Mozilla/5.0", "192.168.1.100");
  const fp2 = createTokenFingerprint("Mozilla/5.0", "192.168.1.200");
  const fp3 = createTokenFingerprint("Mozilla/5.0", "192.168.2.100");

  // Same /24 subnet should produce same fingerprint
  assert.equal(fp1, fp2, "same user-agent + same /24 subnet should match");

  // Different /24 subnet should differ
  assert.notEqual(fp1, fp3, "different /24 subnet should produce different fingerprint");
});

test("Phase 3.2: Token binding — verifyTokenBinding rejects different fingerprint", () => {
  const tokenId = "test-token-123";
  const fp1 = createTokenFingerprint("Mozilla/5.0", "10.0.1.5");
  const fp2 = createTokenFingerprint("Mozilla/5.0", "172.16.0.5");

  bindToken(tokenId, fp1);

  assert.ok(verifyTokenBinding(tokenId, fp1), "same fingerprint should pass");
  assert.ok(!verifyTokenBinding(tokenId, fp2), "different fingerprint should fail");
});

test("Phase 3.2: Token binding — unbound token always passes", () => {
  const fp = createTokenFingerprint("Chrome", "10.0.0.1");
  assert.ok(verifyTokenBinding("unbound-token", fp), "unbound token should pass any fingerprint");
});

test("Phase 3.2: Token binding — login binds token to client fingerprint", async () => {
  const { app, rbs } = await buildTestApp();
  const { loginResult } = await createUserAndLogin(app, rbs);

  // Verify a binding was created for the refresh token
  assert.ok(
    tokenBindings.has(loginResult.refreshToken),
    "login should create a token binding for the refresh token",
  );

  await app.close();
});
