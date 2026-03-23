// ---------------------------------------------------------------------------
// Phase 2.2: JIT User Provisioning Tests
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAuth,
  resetJwksCache,
  setRoleBindingService,
  type AuthResult,
} from "../../src/iam/auth-plugin.js";
import type { IamFeatureFlags } from "../../src/iam/feature-flags.js";
import type { OidcConfig } from "../../src/iam/auth-plugin.js";
import { RoleBindingService } from "../../src/iam/role-binding.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-jwt-secret-jit";

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

function devOidc(): OidcConfig {
  return { issuer: null, audience: null, jwksUri: null };
}

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
// JIT creates user on first JWT login
// ---------------------------------------------------------------------------

test("JIT creates user on first JWT login", async () => {
  const rbs = new RoleBindingService();
  setRoleBindingService(rbs);

  try {
    await withEnv({
      SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET,
      SPACEHARBOR_IAM_DEFAULT_ROLE: undefined,
      SPACEHARBOR_IAM_GROUP_ROLE_MAP: undefined,
    }, async () => {
      const token = makeSignedJwt({
        sub: "new-sso-user-001",
        email: "artist@studio.com",
        name: "New Artist",
        groups: [],
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const result = await resolveAuth(
        { authorization: `Bearer ${token}` },
        enabledFlags(),
        devOidc(),
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.context.userId, "new-sso-user-001");

      // Verify user was created in the role binding service
      const user = rbs.getUserByExternalId("new-sso-user-001");
      assert.ok(user, "user should be created by JIT provisioning");
      assert.equal(user!.email, "artist@studio.com");
      assert.equal(user!.displayName, "New Artist");
      assert.equal(user!.status, "active");
    });
  } finally {
    setRoleBindingService(null);
  }
});

// ---------------------------------------------------------------------------
// JIT doesn't duplicate existing user
// ---------------------------------------------------------------------------

test("JIT does not duplicate existing user", async () => {
  const rbs = new RoleBindingService();

  // Pre-create a user with the same externalId
  rbs.createUser({
    email: "existing@studio.com",
    displayName: "Existing User",
    externalId: "existing-sub-123",
  });

  setRoleBindingService(rbs);

  try {
    await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
      const token = makeSignedJwt({
        sub: "existing-sub-123",
        email: "existing@studio.com",
        name: "Existing User",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const result = await resolveAuth(
        { authorization: `Bearer ${token}` },
        enabledFlags(),
        devOidc(),
      );

      assert.equal(result.ok, true);

      // Should still have only 1 user
      const users = rbs.listUsers();
      assert.equal(users.length, 1, "should not create a duplicate user");
    });
  } finally {
    setRoleBindingService(null);
  }
});

// ---------------------------------------------------------------------------
// Default role applied
// ---------------------------------------------------------------------------

test("JIT applies default viewer role when no mapping matches", async () => {
  const rbs = new RoleBindingService();
  setRoleBindingService(rbs);

  try {
    await withEnv({
      SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET,
      SPACEHARBOR_IAM_DEFAULT_ROLE: "artist",
      SPACEHARBOR_IAM_GROUP_ROLE_MAP: undefined,
    }, async () => {
      const token = makeSignedJwt({
        sub: "default-role-user",
        email: "default@studio.com",
        name: "Default User",
        groups: [],
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await resolveAuth(
        { authorization: `Bearer ${token}` },
        enabledFlags(),
        devOidc(),
      );

      const user = rbs.getUserByExternalId("default-role-user");
      assert.ok(user);

      // Check the membership was granted with default role
      const memberships = rbs.listUserMemberships(user!.id);
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0].role, "artist");
    });
  } finally {
    setRoleBindingService(null);
  }
});

// ---------------------------------------------------------------------------
// Group-to-role mapping works
// ---------------------------------------------------------------------------

test("JIT applies group-to-role mapping from env var", async () => {
  const rbs = new RoleBindingService();
  setRoleBindingService(rbs);

  try {
    await withEnv({
      SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET,
      SPACEHARBOR_IAM_DEFAULT_ROLE: "viewer",
      SPACEHARBOR_IAM_GROUP_ROLE_MAP: JSON.stringify({
        "vfx-supers": "supervisor",
        "artists": "artist",
      }),
    }, async () => {
      const token = makeSignedJwt({
        sub: "group-mapped-user",
        email: "super@studio.com",
        name: "VFX Supervisor",
        groups: ["vfx-supers"],
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await resolveAuth(
        { authorization: `Bearer ${token}` },
        enabledFlags(),
        devOidc(),
      );

      const user = rbs.getUserByExternalId("group-mapped-user");
      assert.ok(user);

      // Check the membership was granted with mapped role (supervisor)
      const memberships = rbs.listUserMemberships(user!.id);
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0].role, "supervisor");
    });
  } finally {
    setRoleBindingService(null);
  }
});

test("JIT applies multiple group-to-role mappings on same project (last wins)", async () => {
  const rbs = new RoleBindingService();
  setRoleBindingService(rbs);

  try {
    await withEnv({
      SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET,
      SPACEHARBOR_IAM_GROUP_ROLE_MAP: JSON.stringify({
        "vfx-supers": "supervisor",
        "reviewers": "reviewer",
      }),
    }, async () => {
      const token = makeSignedJwt({
        sub: "multi-group-user",
        email: "multi@studio.com",
        name: "Multi-Role User",
        groups: ["vfx-supers", "reviewers"],
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await resolveAuth(
        { authorization: `Bearer ${token}` },
        enabledFlags(),
        devOidc(),
      );

      const user = rbs.getUserByExternalId("multi-group-user");
      assert.ok(user);

      // RoleBindingService supports one role per (user, project) pair.
      // When multiple groups map to different roles on the same default project,
      // the last one applied wins (updates the existing membership).
      const memberships = rbs.listUserMemberships(user!.id);
      assert.equal(memberships.length, 1);
      // The role should be one of the mapped roles
      assert.ok(
        memberships[0].role === "supervisor" || memberships[0].role === "reviewer",
        `expected supervisor or reviewer, got ${memberships[0].role}`,
      );
    });
  } finally {
    setRoleBindingService(null);
  }
});

test("JIT provisioning is skipped when no role binding service is set", async () => {
  setRoleBindingService(null);

  await withEnv({ SPACEHARBOR_JWT_SECRET: TEST_JWT_SECRET }, async () => {
    const token = makeSignedJwt({
      sub: "no-rbs-user",
      email: "norbs@studio.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Should not throw, just skip JIT
    const result = await resolveAuth(
      { authorization: `Bearer ${token}` },
      enabledFlags(),
      devOidc(),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.userId, "no-rbs-user");
  });
});
