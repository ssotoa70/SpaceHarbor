import test from "node:test";
import assert from "node:assert/strict";

import { resolveIamFlags, isEnforcementActive } from "../../src/iam/feature-flags.js";

// ---------------------------------------------------------------------------
// Default flags
// ---------------------------------------------------------------------------

test("default flags have IAM disabled and shadow mode on", () => {
  // Clear any env overrides
  const envBackup: Record<string, string | undefined> = {};
  const keys = [
    "SPACEHARBOR_IAM_ENABLED",
    "SPACEHARBOR_IAM_SHADOW_MODE",
    "SPACEHARBOR_IAM_ENFORCE_READ_SCOPE",
    "SPACEHARBOR_IAM_ENFORCE_WRITE_SCOPE",
    "SPACEHARBOR_IAM_ROLLOUT_RING",
    "SPACEHARBOR_IAM_ALLOWLISTED_TENANTS",
  ];
  for (const k of keys) {
    envBackup[k] = process.env[k];
    delete process.env[k];
  }

  const flags = resolveIamFlags();
  assert.equal(flags.iamEnabled, false);
  assert.equal(flags.shadowMode, true);
  assert.equal(flags.enforceReadScope, false);
  assert.equal(flags.enforceWriteScope, false);
  assert.equal(flags.enforceApprovalSod, false);
  assert.equal(flags.enableLockState, false);
  assert.equal(flags.enableBreakGlass, false);
  assert.equal(flags.enableScimSync, false);
  assert.equal(flags.rolloutRing, "internal");
  assert.deepEqual(flags.allowlistedTenants, []);

  // Restore env
  for (const [k, v] of Object.entries(envBackup)) {
    if (v !== undefined) process.env[k] = v;
  }
});

// ---------------------------------------------------------------------------
// Env overrides
// ---------------------------------------------------------------------------

test("env vars override default flags", () => {
  process.env.SPACEHARBOR_IAM_ENABLED = "true";
  process.env.SPACEHARBOR_IAM_SHADOW_MODE = "false";
  process.env.SPACEHARBOR_IAM_ENFORCE_READ_SCOPE = "true";
  process.env.SPACEHARBOR_IAM_ROLLOUT_RING = "pilot";
  process.env.SPACEHARBOR_IAM_ALLOWLISTED_TENANTS = "tenant-a,tenant-b";

  const flags = resolveIamFlags();
  assert.equal(flags.iamEnabled, true);
  assert.equal(flags.shadowMode, false);
  assert.equal(flags.enforceReadScope, true);
  assert.equal(flags.rolloutRing, "pilot");
  assert.deepEqual(flags.allowlistedTenants, ["tenant-a", "tenant-b"]);

  // Cleanup
  delete process.env.SPACEHARBOR_IAM_ENABLED;
  delete process.env.SPACEHARBOR_IAM_SHADOW_MODE;
  delete process.env.SPACEHARBOR_IAM_ENFORCE_READ_SCOPE;
  delete process.env.SPACEHARBOR_IAM_ROLLOUT_RING;
  delete process.env.SPACEHARBOR_IAM_ALLOWLISTED_TENANTS;
});

// ---------------------------------------------------------------------------
// Enforcement checks
// ---------------------------------------------------------------------------

test("isEnforcementActive returns false when IAM disabled", () => {
  const flags = resolveIamFlags();
  assert.equal(isEnforcementActive(flags, "any-tenant"), false);
});

test("isEnforcementActive returns true for allowlisted tenant", () => {
  const flags = {
    ...resolveIamFlags(),
    iamEnabled: true,
    rolloutRing: "pilot" as const,
    allowlistedTenants: ["tenant-a"],
  };
  assert.equal(isEnforcementActive(flags, "tenant-a"), true);
  assert.equal(isEnforcementActive(flags, "tenant-b"), false);
});

test("isEnforcementActive returns true for all tenants in general ring", () => {
  const flags = {
    ...resolveIamFlags(),
    iamEnabled: true,
    rolloutRing: "general" as const,
    allowlistedTenants: [],
  };
  assert.equal(isEnforcementActive(flags, "any-tenant"), true);
});
