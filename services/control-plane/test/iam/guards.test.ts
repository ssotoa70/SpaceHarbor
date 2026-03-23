import test from "node:test";
import assert from "node:assert/strict";

import {
  checkPermission,
  checkSeparationOfDuties,
  checkDualControl,
} from "../../src/iam/guards.js";
import { resolveIamFlags } from "../../src/iam/feature-flags.js";
import { PERMISSIONS } from "../../src/iam/types.js";
import type { IamFeatureFlags } from "../../src/iam/feature-flags.js";

const P = PERMISSIONS;

function makeFlags(overrides: Partial<IamFeatureFlags> = {}): IamFeatureFlags {
  return { ...resolveIamFlags(), iamEnabled: true, ...overrides };
}

// ---------------------------------------------------------------------------
// checkPermission
// ---------------------------------------------------------------------------

test("checkPermission: viewer allowed browse:assets", () => {
  const result = checkPermission(["viewer"], P.BROWSE_ASSETS, makeFlags(), "tenant-a");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "role_granted");
});

test("checkPermission: viewer denied approval:approve in shadow mode (still allowed)", () => {
  const flags = makeFlags({ shadowMode: true });
  const result = checkPermission(["viewer"], P.APPROVAL_APPROVE, flags, "tenant-a");
  // Shadow mode: allowed but reason shows missing permission
  assert.equal(result.allowed, true);
  assert.equal(result.shadow, true);
  assert.ok(result.reason.includes("missing_permission"));
});

test("checkPermission: viewer denied approval:approve in enforcement mode", () => {
  const flags = makeFlags({
    shadowMode: false,
    allowlistedTenants: ["tenant-a"],
    rolloutRing: "pilot",
  });
  const result = checkPermission(["viewer"], P.APPROVAL_APPROVE, flags, "tenant-a");
  assert.equal(result.allowed, false);
  assert.equal(result.shadow, false);
});

test("checkPermission: administrator allowed everything", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(["administrator"], P.ADMIN_SYSTEM_CONFIG, flags, "any");
  assert.equal(result.allowed, true);
});

test("checkPermission: enforcement not active for non-allowlisted tenant", () => {
  const flags = makeFlags({
    shadowMode: false,
    allowlistedTenants: ["tenant-a"],
    rolloutRing: "pilot",
  });
  // tenant-b is NOT allowlisted, so enforcement not active → shadow mode
  const result = checkPermission(["viewer"], P.APPROVAL_APPROVE, flags, "tenant-b");
  assert.equal(result.allowed, true); // shadow: allowed
  assert.equal(result.shadow, true);
});

test("checkPermission: supervisor allowed approval:approve", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(["supervisor"], P.APPROVAL_APPROVE, flags, "t");
  assert.equal(result.allowed, true);
});

test("checkPermission: artist allowed metadata_write:own", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(["artist"], P.METADATA_WRITE_OWN, flags, "t");
  assert.equal(result.allowed, true);
});

test("checkPermission: artist denied metadata_write:others", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(["artist"], P.METADATA_WRITE_OTHERS, flags, "t");
  assert.equal(result.allowed, false);
});

test("checkPermission: supervisor allowed metadata_write:others", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(["supervisor"], P.METADATA_WRITE_OTHERS, flags, "t");
  assert.equal(result.allowed, true);
});

test("checkPermission: multi-role union grants", () => {
  const flags = makeFlags({ shadowMode: false, rolloutRing: "general" });
  const result = checkPermission(
    ["viewer", "pipeline_td"],
    P.EVENTS_PUBLISH,
    flags,
    "t"
  );
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// Separation of duties
// ---------------------------------------------------------------------------

test("checkSeparationOfDuties: different actors allowed", () => {
  const flags = makeFlags({ enforceApprovalSod: true });
  const result = checkSeparationOfDuties("user-1", "user-2", flags);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "different_actors");
});

test("checkSeparationOfDuties: same actor denied", () => {
  const flags = makeFlags({ enforceApprovalSod: true });
  const result = checkSeparationOfDuties("user-1", "user-1", flags);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "separation_of_duties_violation");
});

test("checkSeparationOfDuties: not enforced allows same actor", () => {
  const flags = makeFlags({ enforceApprovalSod: false });
  const result = checkSeparationOfDuties("user-1", "user-1", flags);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "sod_not_enforced");
});

// ---------------------------------------------------------------------------
// Dual control
// ---------------------------------------------------------------------------

test("checkDualControl: different actors with confirmer allowed", () => {
  const flags = makeFlags({ enforceApprovalSod: true });
  const result = checkDualControl("user-1", "user-2", flags);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "dual_control_satisfied");
});

test("checkDualControl: no confirmer denied", () => {
  const flags = makeFlags({ enforceApprovalSod: true });
  const result = checkDualControl("user-1", null, flags);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "dual_control_requires_confirmer");
});

test("checkDualControl: same actor denied", () => {
  const flags = makeFlags({ enforceApprovalSod: true });
  const result = checkDualControl("user-1", "user-1", flags);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "dual_control_same_actor");
});

test("checkDualControl: not enforced allows anything", () => {
  const flags = makeFlags({ enforceApprovalSod: false });
  const result = checkDualControl("user-1", null, flags);
  assert.equal(result.allowed, true);
});
