import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuth, resolveValidApiKeys, isValidApiKey, resetJwksCache, setJwksFetchFn, type AuthResult } from "../../src/iam/auth-plugin.js";
import type { IamFeatureFlags } from "../../src/iam/feature-flags.js";
import type { OidcConfig } from "../../src/iam/auth-plugin.js";
import { PERMISSIONS } from "../../src/iam/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const P = PERMISSIONS;

/** Shared test secret for HS256 JWT signing. */
const TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests";

/** Minimal IAM-enabled flags for testing. */
function enabledFlags(overrides: Partial<IamFeatureFlags> = {}): IamFeatureFlags {
  return {
    iamEnabled: true,
    shadowMode: false,
    enforceReadScope: false,
    enforceWriteScope: false,
    enforceApprovalSod: false,
    enableLockState: false,
    enableBreakGlass: false,
    enableScimSync: false,
    rolloutRing: "internal",
    allowlistedTenants: [],
    ...overrides,
  };
}

/** IAM-disabled flags. */
function disabledFlags(): IamFeatureFlags {
  return { ...enabledFlags(), iamEnabled: false };
}

/** Dev-mode OIDC config (no JWKS URI). */
function devOidc(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer: null,
    audience: null,
    jwksUri: null,
    ...overrides,
  };
}

/** Build a properly signed HS256 JWT for testing. */
function makeSignedJwt(payload: Record<string, unknown>, secret: string = TEST_JWT_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

/** Build an unsigned JWT with alg: "none" (for testing rejection). */
function makeUnsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.nosig`;
}

/** Saves and restores env vars around a test callback. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const backup: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    backup[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, val] of Object.entries(backup)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// IAM disabled — anonymous context
// ---------------------------------------------------------------------------

test("returns anonymous context when IAM is disabled", async () => {
  const result = await resolveAuth({}, disabledFlags(), devOidc());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.context.authStrategy, "anonymous");
  assert.equal(result.context.userId, "anonymous");
  assert.equal(result.context.roles.length, 0);
  assert.equal(result.context.permissions.size, 0);
  assert.equal(result.context.externalId, null);
});

// ---------------------------------------------------------------------------
// API key auth (backward-compatible)
// ---------------------------------------------------------------------------

test("resolves API key auth when IAM enabled", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: "test-key-123" }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "test-key-123" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "api_key");
    assert.equal(result.context.userId, "api-key-user");
    assert.ok(result.context.roles.includes("administrator"));
    assert.ok(result.context.permissions.has(P.ADMIN_SYSTEM_CONFIG));
  });
});

test("rejects invalid API key", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: "correct-key" }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "wrong-key" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 403);
    assert.equal(result.code, "FORBIDDEN");
    assert.equal(result.message, "invalid API key");
  });
});

test("rejects API key when no key configured", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "some-key" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.equal(result.code, "UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// JWT bearer token (HS256 signed)
// ---------------------------------------------------------------------------

test("parses HS256-signed JWT bearer token", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "user-42",
      email: "artist@studio.com",
      name: "Jane Artist",
      groups: ["artist"],
      tenant_id: "tenant-abc",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "jwt");
    assert.equal(result.context.userId, "user-42");
    assert.equal(result.context.email, "artist@studio.com");
    assert.equal(result.context.displayName, "Jane Artist");
    assert.equal(result.context.externalId, "user-42");
    assert.equal(result.context.scope.tenantId, "tenant-abc");
    assert.equal(result.context.scope.source, "token");
    assert.deepEqual(result.context.groups, ["artist"]);
  });
});

// ---------------------------------------------------------------------------
// OIDC claim extraction
// ---------------------------------------------------------------------------

test("extracts OIDC claims: sub, email, groups, tenant_id", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "oidc-sub-99",
      email: "production@vfx.co",
      display_name: "Senior Production",
      groups: ["supervisor", "reviewer"],
      roles: ["production"],
      tenant_id: "tenant-vfx",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.externalId, "oidc-sub-99");
    assert.equal(result.context.email, "production@vfx.co");
    assert.equal(result.context.displayName, "Senior Production");
    assert.equal(result.context.scope.tenantId, "tenant-vfx");
    // roles from explicit roles claim + groups
    assert.ok(result.context.roles.includes("production"));
    assert.ok(result.context.roles.includes("supervisor"));
    assert.ok(result.context.roles.includes("reviewer"));
    // Production has destructive perms
    assert.ok(result.context.permissions.has(P.DESTRUCTIVE_PURGE_DLQ));
    // Token claims preserved
    assert.ok(result.context.tokenClaims !== null);
    assert.equal(result.context.tokenClaims!.sub, "oidc-sub-99");
  });
});

test("defaults to viewer role when no roles or matching groups", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "plain-user",
      email: "viewer@studio.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.context.roles, ["viewer"]);
    assert.ok(result.context.permissions.has(P.BROWSE_ASSETS));
    assert.ok(!result.context.permissions.has(P.INGEST_CREATE));
  });
});

// ---------------------------------------------------------------------------
// JWT validation — expired token
// ---------------------------------------------------------------------------

test("rejects expired JWT", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "expired-user",
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour in the past
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.equal(result.code, "UNAUTHORIZED");
    assert.equal(result.message, "token expired");
  });
});

// ---------------------------------------------------------------------------
// JWT validation — issuer mismatch
// ---------------------------------------------------------------------------

test("rejects JWT with wrong issuer", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "user-1",
      iss: "https://wrong-issuer.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ issuer: "https://idp.spaceharbor.io" }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.match(result.message, /issuer mismatch/);
  });
});

// ---------------------------------------------------------------------------
// JWT validation — audience mismatch
// ---------------------------------------------------------------------------

test("rejects JWT with wrong audience", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "user-1",
      aud: "wrong-audience",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ audience: "spaceharbor-api" }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.match(result.message, /audience mismatch/);
  });
});

test("accepts JWT with matching audience in array", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "user-1",
      aud: ["spaceharbor-api", "other-service"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ audience: "spaceharbor-api" }),
    );

    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Malformed JWT
// ---------------------------------------------------------------------------

test("rejects malformed JWT", async () => {
  const result = await resolveAuth(
    { authorization: "Bearer not-a-jwt" },
    enabledFlags(),
    devOidc(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.equal(result.message, "malformed JWT");
});

test("rejects empty bearer token", async () => {
  const result = await resolveAuth(
    { authorization: "Bearer " },
    enabledFlags(),
    devOidc(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.equal(result.message, "empty bearer token");
});

// ---------------------------------------------------------------------------
// Service token auth
// ---------------------------------------------------------------------------

test("resolves service token auth", async () => {
  await withEnv({ SPACEHARBOR_SERVICE_TOKEN: "svc-token-xyz" }, async () => {
    const result = await resolveAuth(
      { "x-service-token": "svc-token-xyz" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "service_token");
    assert.equal(result.context.userId, "service-account");
    assert.ok(result.context.roles.includes("administrator"));
    assert.ok(result.context.permissions.has(P.ADMIN_SYSTEM_CONFIG));
  });
});

test("rejects invalid service token", async () => {
  await withEnv({ SPACEHARBOR_SERVICE_TOKEN: "correct-token" }, async () => {
    const result = await resolveAuth(
      { "x-service-token": "wrong-token" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 403);
    assert.equal(result.code, "FORBIDDEN");
    assert.equal(result.message, "invalid service token");
  });
});

test("rejects service token when not configured", async () => {
  await withEnv({ SPACEHARBOR_SERVICE_TOKEN: undefined }, async () => {
    const result = await resolveAuth(
      { "x-service-token": "some-token" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// No credentials: deny when IAM is enabled (CWE-287)
// ---------------------------------------------------------------------------

test("denies when no auth headers present and IAM is enabled", async () => {
  const result = await resolveAuth({}, enabledFlags(), devOidc());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.equal(result.code, "UNAUTHORIZED");
  assert.equal(result.message, "authentication required");
});

// ---------------------------------------------------------------------------
// Strategy priority (JWT > API key > service token)
// ---------------------------------------------------------------------------

test("JWT takes precedence over API key header", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: "test-key",
    SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET,
  }, async () => {
    const token = makeSignedJwt({
      sub: "jwt-user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      {
        authorization: `Bearer ${token}`,
        "x-api-key": "test-key",
      },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "jwt");
    assert.equal(result.context.userId, "jwt-user");
  });
});

test("API key takes precedence over service token", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: "api-key-val",
    SPACEHARBOR_SERVICE_TOKEN: "svc-token-val",
  }, async () => {
    const result = await resolveAuth(
      {
        "x-api-key": "api-key-val",
        "x-service-token": "svc-token-val",
      },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "api_key");
  });
});

// ---------------------------------------------------------------------------
// Default tenant_id
// ---------------------------------------------------------------------------

test("defaults tenant_id to 'default' when not in JWT claims", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "no-tenant-user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.scope.tenantId, "default");
  });
});

// ---------------------------------------------------------------------------
// C1: JWT signature verification — alg: "none" rejection
// ---------------------------------------------------------------------------

test("rejects JWT with alg: none", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeUnsignedJwt({
      sub: "attacker",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.match(result.message, /algorithm 'none' is not allowed/);
  });
});

test("rejects JWT with unsupported algorithm", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS384", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify({
    sub: "user",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const token = `${header}.${body}.fakesig`;

  const result = await resolveAuth(
    { authorization: `Bearer ${token}` },
    enabledFlags(),
    devOidc(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.match(result.message, /not supported/);
});

test("rejects HS256 JWT when no secret configured", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: undefined }, async () => {
    const token = makeSignedJwt({
      sub: "user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.match(result.message, /SPACEHARBOR_JWT_SECRET/);
  });
});

test("rejects HS256 JWT with wrong signature", async () => {
  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    // Sign with a different secret
    const token = makeSignedJwt(
      { sub: "user", exp: Math.floor(Date.now() / 1000) + 3600 },
      "wrong-secret",
    );

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.equal(result.message, "invalid JWT signature");
  });
});

test("rejects RS256 JWT when no JWKS URI configured", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify({
    sub: "user",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const token = `${header}.${body}.fakesig`;

  const result = await resolveAuth(
    { authorization: `Bearer ${token}` },
    enabledFlags(),
    devOidc(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.match(result.message, /SPACEHARBOR_OIDC_JWKS_URI/);
});

// ---------------------------------------------------------------------------
// Per-service credentials — resolveValidApiKeys / isValidApiKey (Item 17)
// ---------------------------------------------------------------------------

test("resolveValidApiKeys: returns empty when neither env var is set", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined, SPACEHARBOR_API_KEYS: undefined }, () => {
    assert.deepEqual(resolveValidApiKeys(), []);
  });
});

test("resolveValidApiKeys: returns single key from SPACEHARBOR_API_KEY", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: "single-key", SPACEHARBOR_API_KEYS: undefined }, () => {
    assert.deepEqual(resolveValidApiKeys(), ["single-key"]);
  });
});

test("resolveValidApiKeys: returns multiple keys from SPACEHARBOR_API_KEYS", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined, SPACEHARBOR_API_KEYS: "key-a,key-b,key-c" }, () => {
    const keys = resolveValidApiKeys();
    assert.equal(keys.length, 3);
    assert.ok(keys.includes("key-a"));
    assert.ok(keys.includes("key-b"));
    assert.ok(keys.includes("key-c"));
  });
});

test("resolveValidApiKeys: merges single key and multi keys without duplicates", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: "key-a", SPACEHARBOR_API_KEYS: "key-a,key-b" }, () => {
    const keys = resolveValidApiKeys();
    assert.equal(keys.length, 2);
    assert.ok(keys.includes("key-a"));
    assert.ok(keys.includes("key-b"));
  });
});

test("resolveValidApiKeys: trims whitespace and ignores empty entries", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined, SPACEHARBOR_API_KEYS: " key-x , , key-y , " }, () => {
    const keys = resolveValidApiKeys();
    assert.equal(keys.length, 2);
    assert.ok(keys.includes("key-x"));
    assert.ok(keys.includes("key-y"));
  });
});

test("isValidApiKey: returns true for a matching key from multi-key list", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined, SPACEHARBOR_API_KEYS: "svc-cp-001,svc-mw-002,svc-sc-003" }, () => {
    assert.ok(isValidApiKey("svc-mw-002"));
  });
});

test("isValidApiKey: returns false for non-matching key", async () => {
  await withEnv({ SPACEHARBOR_API_KEY: undefined, SPACEHARBOR_API_KEYS: "svc-cp-001,svc-mw-002" }, () => {
    assert.ok(!isValidApiKey("wrong-key"));
  });
});

test("resolveAuth: accepts any per-service key via SPACEHARBOR_API_KEYS", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: undefined,
    SPACEHARBOR_API_KEYS: "key-cp,key-mw,key-scanner",
  }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "key-mw" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "api_key");
    assert.ok(result.context.roles.includes("administrator"));
  });
});

test("resolveAuth: rejects key not in SPACEHARBOR_API_KEYS", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: undefined,
    SPACEHARBOR_API_KEYS: "key-cp,key-mw,key-scanner",
  }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "key-unknown" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 403);
    assert.equal(result.message, "invalid API key");
  });
});

test("resolveAuth: legacy single key still works alongside multi-key", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: "legacy-key",
    SPACEHARBOR_API_KEYS: "key-cp,key-mw",
  }, async () => {
    // Legacy key should still be accepted
    const result = await resolveAuth(
      { "x-api-key": "legacy-key" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "api_key");
  });
});

test("resolveAuth: per-service key works when only SPACEHARBOR_API_KEYS is set", async () => {
  await withEnv({
    SPACEHARBOR_API_KEY: undefined,
    SPACEHARBOR_API_KEYS: "scanner-key-abc",
  }, async () => {
    const result = await resolveAuth(
      { "x-api-key": "scanner-key-abc" },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "api_key");
  });
});

// ---------------------------------------------------------------------------
// Phase 1.1: RS256 JWT signature verification via JWKS
// ---------------------------------------------------------------------------

// Generate an RSA key pair for testing
const rsaKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = rsaKeyPair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;

/** Sign a JWT with RS256. */
function makeRS256Jwt(
  payload: Record<string, unknown>,
  kid = "test-rsa-kid",
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign(rsaKeyPair.privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

/** Mock JWKS fetch function that returns our test RSA key. */
function mockRsaJwksFetch(_url: string) {
  return Promise.resolve({
    keys: [{ ...rsaJwk, kid: "test-rsa-kid", alg: "RS256", use: "sig" }],
  });
}

test("verifies RS256-signed JWT via JWKS", async () => {
  resetJwksCache();
  setJwksFetchFn(mockRsaJwksFetch);
  try {
    const token = makeRS256Jwt({
      sub: "rs256-user",
      email: "rs256@studio.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "jwt");
    assert.equal(result.context.userId, "rs256-user");
    assert.equal(result.context.email, "rs256@studio.com");
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

test("rejects RS256 JWT with tampered payload", async () => {
  resetJwksCache();
  setJwksFetchFn(mockRsaJwksFetch);
  try {
    const token = makeRS256Jwt({
      sub: "rs256-user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Tamper with the payload
    const parts = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({
      sub: "admin-attacker",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = await resolveAuth(
      { authorization: `Bearer ${tamperedToken}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.equal(result.message, "invalid JWT signature");
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

test("selects correct key by kid from JWKS", async () => {
  resetJwksCache();
  const rsaKeyPair2 = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaJwk2 = rsaKeyPair2.publicKey.export({ format: "jwk" }) as Record<string, unknown>;

  setJwksFetchFn((_url: string) => Promise.resolve({
    keys: [
      { ...rsaJwk, kid: "key-1", alg: "RS256", use: "sig" },
      { ...rsaJwk2, kid: "key-2", alg: "RS256", use: "sig" },
    ],
  }));

  try {
    // Sign with the original key but use kid "key-1"
    const token = makeRS256Jwt(
      { sub: "kid-test-user", exp: Math.floor(Date.now() / 1000) + 3600 },
      "key-1",
    );

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.userId, "kid-test-user");
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

test("auto-refreshes JWKS on unknown kid", async () => {
  resetJwksCache();
  let callCount = 0;

  setJwksFetchFn((_url: string) => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        keys: [{ ...rsaJwk, kid: "key-old", alg: "RS256", use: "sig" }],
      });
    }
    return Promise.resolve({
      keys: [
        { ...rsaJwk, kid: "key-old", alg: "RS256", use: "sig" },
        { ...rsaJwk, kid: "key-new", alg: "RS256", use: "sig" },
      ],
    });
  });

  try {
    // Prime the cache with key-old
    const token1 = makeRS256Jwt(
      { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 },
      "key-old",
    );
    const r1 = await resolveAuth(
      { authorization: `Bearer ${token1}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );
    assert.equal(r1.ok, true);

    // Use key-new — should trigger JWKS refresh
    const token2 = makeRS256Jwt(
      { sub: "user-2", exp: Math.floor(Date.now() / 1000) + 3600 },
      "key-new",
    );
    const r2 = await resolveAuth(
      { authorization: `Bearer ${token2}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.context.userId, "user-2");
    assert.equal(callCount, 2);
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

// ---------------------------------------------------------------------------
// Phase 1.1: ES256 JWT signature verification via JWKS
// ---------------------------------------------------------------------------

const ecKeyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecJwk = ecKeyPair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;

/** Sign a JWT with ES256. */
function makeES256Jwt(
  payload: Record<string, unknown>,
  kid = "test-ec-kid",
): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  // Node.js produces DER; JWT needs raw R||S (64 bytes)
  const derSig = signer.sign(ecKeyPair.privateKey);
  const rawSig = derToRawES256(derSig);
  const signature = rawSig.toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Convert DER-encoded ECDSA signature to raw R||S (64 bytes). */
function derToRawES256(der: Buffer): Buffer {
  let offset = 2; // skip SEQUENCE tag + length
  if (der[0] !== 0x30) throw new Error("not a DER SEQUENCE");
  if (der[offset] !== 0x02) throw new Error("expected INTEGER tag for R");
  offset++;
  const rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error("expected INTEGER tag for S");
  offset++;
  const sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);
  if (r.length === 33 && r[0] === 0) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0) s = s.subarray(1);
  const result = Buffer.alloc(64);
  r.copy(result, 32 - r.length);
  s.copy(result, 64 - s.length);
  return result;
}

function mockEcJwksFetch(_url: string) {
  return Promise.resolve({
    keys: [{ ...ecJwk, kid: "test-ec-kid", alg: "ES256", use: "sig" }],
  });
}

test("verifies ES256-signed JWT via JWKS", async () => {
  resetJwksCache();
  setJwksFetchFn(mockEcJwksFetch);
  try {
    const token = makeES256Jwt({
      sub: "es256-user",
      email: "es256@studio.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authStrategy, "jwt");
    assert.equal(result.context.userId, "es256-user");
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

test("rejects ES256 JWT with tampered payload", async () => {
  resetJwksCache();
  setJwksFetchFn(mockEcJwksFetch);
  try {
    const token = makeES256Jwt({
      sub: "es256-user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const parts = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({
      sub: "attacker",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = await resolveAuth(
      { authorization: `Bearer ${tamperedToken}` },
      enabledFlags(),
      devOidc({ jwksUri: "https://mock-jwks.example.com/.well-known/jwks.json" }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 401);
    assert.equal(result.message, "invalid JWT signature");
  } finally {
    setJwksFetchFn(null);
    resetJwksCache();
  }
});

test("rejects alg:none with mixed case (NoNe)", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "NoNe", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify({
    sub: "attacker",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const token = `${header}.${body}.`;

  const result = await resolveAuth(
    { authorization: `Bearer ${token}` },
    enabledFlags(),
    devOidc(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.statusCode, 401);
  assert.match(result.message, /algorithm 'none' is not allowed/);
});
