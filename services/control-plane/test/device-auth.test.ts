// ---------------------------------------------------------------------------
// Phase 3.5: Device Authorization Grant Tests
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
} from "../src/routes/iam.js";
import {
  registerDeviceAuthRoutes,
  resetDeviceAuthState,
  deviceCodeStore,
  userCodeIndex,
} from "../src/routes/device-auth.js";
import { hashPassword } from "../src/iam/local-auth.js";
import { resetCsrfState } from "../src/iam/csrf.js";
import { resetTokenBindingState } from "../src/iam/token-binding.js";
import type { RequestContext, Role } from "../src/iam/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL = "dcc-user@studio.local";
const TEST_PASSWORD = "SecurePass123!";

function makeIamContext(roles: Role[], overrides?: Partial<RequestContext>): RequestContext {
  return {
    userId: "dcc-user-id",
    displayName: "DCC User",
    email: TEST_EMAIL,
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

  if (iamContext) {
    app.addHook("onRequest", async (request) => {
      (request as any).iamContext = iamContext;
    });
  }

  registerIamRoutes(app, () => rbs, ["/api/v1"]);
  registerDeviceAuthRoutes(app, () => rbs, ["/api/v1"]);

  await app.ready();
  return { app, rbs };
}

async function createTestUser(rbs: RoleBindingService) {
  const user = rbs.createUser({ email: TEST_EMAIL, displayName: "DCC User" });
  const hash = await hashPassword(TEST_PASSWORD);
  passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });
  rbs.grantGlobalRole(user.id, "administrator", "test");
  return user;
}

afterEach(() => {
  resetIamRouteState();
  resetDeviceAuthState();
  resetCsrfState();
  resetTokenBindingState();
});

// ---------------------------------------------------------------------------
// Device Code Flow Tests (existing, retained)
// ---------------------------------------------------------------------------

test("Phase 3.5: Device code flow — request code, poll pending, authorize, poll success", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app, rbs } = await buildTestApp(ctx);
  const user = await createTestUser(rbs);

  // Update context to match created user
  ctx.userId = user.id;

  // Step 1: Request device code
  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  assert.equal(codeRes.statusCode, 200);
  const codeBody = codeRes.json();
  assert.ok(codeBody.deviceCode, "response should contain deviceCode");
  assert.ok(codeBody.userCode, "response should contain userCode");
  assert.equal(codeBody.userCode.length, 8, "userCode should be 8 characters");
  assert.ok(codeBody.verificationUri, "response should contain verificationUri");
  assert.ok(codeBody.expiresIn > 0, "expiresIn should be positive");
  assert.ok(codeBody.interval > 0, "interval should be positive");

  // Step 2: Poll for token — should return authorization_pending
  const pendingRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: codeBody.deviceCode },
  });
  assert.equal(pendingRes.statusCode, 400);
  assert.equal(pendingRes.json().error, "authorization_pending");

  // Step 3: Authorize from browser (requires auth — context injected)
  const authRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode: codeBody.userCode },
  });
  assert.equal(authRes.statusCode, 200);
  assert.equal(authRes.json().message, "device authorized successfully");

  // Step 4: Poll for token — should succeed now
  const tokenRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: codeBody.deviceCode },
  });
  assert.equal(tokenRes.statusCode, 200);
  const tokenBody = tokenRes.json();
  assert.ok(tokenBody.accessToken, "response should contain accessToken");
  assert.ok(tokenBody.refreshToken, "response should contain refreshToken");
  assert.equal(tokenBody.expiresIn, 3600);
  assert.equal(tokenBody.tokenType, "Bearer");

  // Verify the refresh token is stored with 30-day expiry
  const rtEntry = refreshTokenStore.get(tokenBody.refreshToken);
  assert.ok(rtEntry, "refresh token should be stored");
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const expectedExpiry = Date.now() + thirtyDaysMs;
  assert.ok(
    Math.abs(rtEntry!.expiresAt - expectedExpiry) < 5000,
    "refresh token should have ~30-day expiry",
  );

  await app.close();
});

test("Phase 3.5: Expired device code returns error", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app, rbs } = await buildTestApp(ctx);
  await createTestUser(rbs);

  // Request device code
  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const codeBody = codeRes.json();

  // Manually expire the device code
  const entry = deviceCodeStore.get(codeBody.deviceCode);
  assert.ok(entry, "device code entry should exist");
  entry!.expiresAt = Date.now() - 1000; // Set to past

  // Poll for token — should return expired_token
  const expiredRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: codeBody.deviceCode },
  });
  assert.equal(expiredRes.statusCode, 400);
  assert.equal(expiredRes.json().error, "expired_token");

  await app.close();
});

test("Phase 3.5: Long-lived refresh token works via device flow", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app, rbs } = await buildTestApp(ctx);
  const user = await createTestUser(rbs);
  ctx.userId = user.id;

  // Request and authorize device code
  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const codeBody = codeRes.json();

  await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode: codeBody.userCode },
  });

  const tokenRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: codeBody.deviceCode },
  });
  const tokenBody = tokenRes.json();

  // Use the refresh token to get a new access token
  const refreshRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken: tokenBody.refreshToken },
  });
  assert.equal(refreshRes.statusCode, 200);
  const refreshBody = refreshRes.json();
  assert.ok(refreshBody.accessToken, "refresh should return new accessToken");
  assert.ok(refreshBody.refreshToken, "refresh should return new refreshToken");

  // Old refresh token should be revoked (rotated)
  const oldEntry = refreshTokenStore.get(tokenBody.refreshToken);
  assert.ok(oldEntry!.revokedAt, "old refresh token should be revoked after rotation");

  // New refresh token should work
  const reRefreshRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken: refreshBody.refreshToken },
  });
  assert.equal(reRefreshRes.statusCode, 200, "rotated refresh token should work");

  await app.close();
});

test("Phase 3.5: Device authorize requires authentication", async () => {
  // Build app without injected context (simulates unauthenticated request)
  const { app } = await buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode: "ABCD1234" },
  });
  assert.equal(res.statusCode, 401, "unauthenticated device authorize should return 401");

  await app.close();
});

test("Phase 3.5: Invalid user code returns 404", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app } = await buildTestApp(ctx);

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode: "NOTEXIST" },
  });
  assert.equal(res.statusCode, 404);

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Polling before user authorizes returns authorization_pending
// ---------------------------------------------------------------------------

test("polling immediately after code request returns authorization_pending", async () => {
  const { app } = await buildTestApp();

  // Request a device code
  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  assert.equal(codeRes.statusCode, 200);
  const { deviceCode } = codeRes.json() as { deviceCode: string; userCode: string };

  // Poll before any authorization — should get authorization_pending
  const pollRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode },
  });
  assert.equal(pollRes.statusCode, 400);
  assert.equal(pollRes.json().error, "authorization_pending",
    "poll before user action should return authorization_pending, not an error");

  // Verify the code is still in pending state and not consumed
  const entry = deviceCodeStore.get(deviceCode);
  assert.ok(entry, "device code should remain in store after a pending poll");
  assert.equal(entry?.status, "pending");

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Expired device code — manually set expiresAt; authorize should also fail
// ---------------------------------------------------------------------------

test("authorizing an expired device code via user code returns 400 EXPIRED", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app } = await buildTestApp(ctx);

  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const { deviceCode, userCode } = codeRes.json() as { deviceCode: string; userCode: string };

  // Expire the code before authorization
  const entry = deviceCodeStore.get(deviceCode);
  assert.ok(entry);
  entry!.expiresAt = Date.now() - 1000;

  const authRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode },
  });

  assert.equal(authRes.statusCode, 400);
  assert.equal(authRes.json().code, "EXPIRED");

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Polling with unknown device code returns invalid_grant
// ---------------------------------------------------------------------------

test("polling with an unknown device code returns invalid_grant", async () => {
  const { app } = await buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode: "0000000000000000000000000000000000000000000000000000000000000000" },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_grant");

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Missing deviceCode body on token poll returns 400 BAD_REQUEST
// ---------------------------------------------------------------------------

test("polling with missing deviceCode body field returns 400", async () => {
  const { app } = await buildTestApp();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: {},  // no deviceCode field
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "BAD_REQUEST");

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Device code is removed from store after successful token issuance
// (code cleanup verification — prevents token replay)
// ---------------------------------------------------------------------------

test("device code is removed from store after successful token issuance", async () => {
  process.env.SPACEHARBOR_JWT_SECRET = "test-secret-for-device-cleanup-test";

  const ctx = makeIamContext(["administrator"]);
  const { app, rbs } = await buildTestApp(ctx);
  const user = await createTestUser(rbs);
  ctx.userId = user.id;

  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const { deviceCode, userCode } = codeRes.json() as { deviceCode: string; userCode: string };

  // Authorize
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode },
  });

  // Poll to consume token
  const tokenRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode },
  });
  assert.equal(tokenRes.statusCode, 200, "first poll should succeed");

  // Verify the device code has been removed from the store
  assert.equal(deviceCodeStore.has(deviceCode), false,
    "device code should be deleted from store after token issuance");
  assert.equal(userCodeIndex.has(userCode), false,
    "user code reverse index should be cleared after token issuance");

  // Second poll with the same device code should return invalid_grant (code gone)
  const replayRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/token",
    payload: { deviceCode },
  });
  assert.equal(replayRes.statusCode, 400);
  assert.equal(replayRes.json().error, "invalid_grant",
    "replaying a consumed device code should return invalid_grant");

  delete process.env.SPACEHARBOR_JWT_SECRET;
  await app.close();
});

// ---------------------------------------------------------------------------
// New: Rate limiting simulation — multiple rapid polls do not leak state
// The route does not implement HTTP 429 (rate limiting is an infra concern);
// each poll returns authorization_pending without advancing or corrupting state.
// ---------------------------------------------------------------------------

test("repeated polls while pending all return authorization_pending without corrupting state", async () => {
  const { app } = await buildTestApp();

  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const { deviceCode } = codeRes.json() as { deviceCode: string };

  // Simulate rapid polling (5 times) — simulates a DCC plugin polling faster than the interval
  const pollResults = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/device/token",
        payload: { deviceCode },
      })
    )
  );

  for (const res of pollResults) {
    assert.equal(res.statusCode, 400,
      "each poll before authorization should return 400");
    assert.equal(res.json().error, "authorization_pending",
      "each poll before authorization should return authorization_pending");
  }

  // Code should still be valid and in pending state
  const entry = deviceCodeStore.get(deviceCode);
  assert.ok(entry, "device code should still exist after repeated pending polls");
  assert.equal(entry?.status, "pending",
    "device code should remain pending after repeated polls");

  await app.close();
});

// ---------------------------------------------------------------------------
// New: Device code already used — second authorize attempt rejected
// ---------------------------------------------------------------------------

test("attempting to authorize an already-approved device code is rejected", async () => {
  const ctx = makeIamContext(["administrator"]);
  const { app, rbs } = await buildTestApp(ctx);
  const user = await createTestUser(rbs);
  ctx.userId = user.id;

  const codeRes = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/code",
    payload: {},
  });
  const { userCode } = codeRes.json() as { userCode: string };

  // First authorization — should succeed
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode },
  });
  assert.equal(first.statusCode, 200);

  // Second authorization with same user code — should fail (code already used)
  const second = await app.inject({
    method: "POST",
    url: "/api/v1/auth/device/authorize",
    payload: { userCode },
  });
  assert.equal(second.statusCode, 400);
  assert.equal(second.json().code, "BAD_REQUEST",
    "second authorize attempt should be rejected with BAD_REQUEST");

  await app.close();
});
