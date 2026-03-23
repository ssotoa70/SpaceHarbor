import test from "node:test";
import assert from "node:assert/strict";

import {
  getEffectivePermissions,
  getEffectivePermissionsForRoles,
  hasPermission,
  isAtLeast,
  resolveActionPermission,
} from "../../src/iam/permissions.js";
import { PERMISSIONS, type Role } from "../../src/iam/types.js";

const P = PERMISSIONS;

// ---------------------------------------------------------------------------
// Role hierarchy and inheritance
// ---------------------------------------------------------------------------

test("viewer has browse permissions", () => {
  const perms = getEffectivePermissions("viewer");
  assert.ok(perms.has(P.BROWSE_ASSETS));
  assert.ok(perms.has(P.BROWSE_JOBS));
  assert.ok(perms.has(P.BROWSE_MATERIALS));
  assert.ok(perms.has(P.BROWSE_TIMELINES));
  assert.ok(perms.has(P.AUDIT_READ));
});

test("viewer cannot write or approve", () => {
  const perms = getEffectivePermissions("viewer");
  assert.ok(!perms.has(P.METADATA_WRITE_OWN));
  assert.ok(!perms.has(P.APPROVAL_APPROVE));
  assert.ok(!perms.has(P.INGEST_CREATE));
  assert.ok(!perms.has(P.ADMIN_SYSTEM_CONFIG));
});

test("artist inherits viewer permissions and adds own-write + submit", () => {
  const perms = getEffectivePermissions("artist");
  // Inherited from viewer
  assert.ok(perms.has(P.BROWSE_ASSETS));
  assert.ok(perms.has(P.BROWSE_JOBS));
  // Own permissions
  assert.ok(perms.has(P.METADATA_WRITE_OWN));
  assert.ok(perms.has(P.APPROVAL_SUBMIT));
  assert.ok(perms.has(P.DCC_REQUEST));
  // Cannot approve
  assert.ok(!perms.has(P.APPROVAL_APPROVE));
});

test("reviewer inherits artist and adds review permissions", () => {
  const perms = getEffectivePermissions("reviewer");
  // From artist
  assert.ok(perms.has(P.METADATA_WRITE_OWN));
  assert.ok(perms.has(P.APPROVAL_SUBMIT));
  // Own
  assert.ok(perms.has(P.REVIEW_COMMENT));
  assert.ok(perms.has(P.REVIEW_ANNOTATE));
  assert.ok(perms.has(P.REVIEW_REACT));
  // Cannot approve (that's supervisor)
  assert.ok(!perms.has(P.APPROVAL_APPROVE));
});

test("librarian has library management and metadata write", () => {
  const perms = getEffectivePermissions("librarian");
  // From viewer inheritance
  assert.ok(perms.has(P.BROWSE_ASSETS));
  assert.ok(perms.has(P.BROWSE_MATERIALS));
  // Own permissions
  assert.ok(perms.has(P.LIBRARY_MANAGE_COLLECTIONS));
  assert.ok(perms.has(P.LIBRARY_BULK_METADATA));
  assert.ok(perms.has(P.LIBRARY_CURATE_ASSETS));
  assert.ok(perms.has(P.METADATA_WRITE_OTHERS));
  assert.ok(perms.has(P.METADATA_WRITE_MATERIALS));
  // Cannot approve
  assert.ok(!perms.has(P.APPROVAL_APPROVE));
});

test("supervisor inherits reviewer and adds approval authority", () => {
  const perms = getEffectivePermissions("supervisor");
  // From reviewer
  assert.ok(perms.has(P.REVIEW_COMMENT));
  assert.ok(perms.has(P.METADATA_WRITE_OWN));
  // Own
  assert.ok(perms.has(P.APPROVAL_APPROVE));
  assert.ok(perms.has(P.APPROVAL_REJECT));
  assert.ok(perms.has(P.APPROVAL_OVERRIDE));
  assert.ok(perms.has(P.METADATA_WRITE_OTHERS));
  assert.ok(perms.has(P.METADATA_WRITE_SHOT));
  // Cannot manage projects
  assert.ok(!perms.has(P.ADMIN_MANAGE_PROJECTS));
});

test("production inherits supervisor+librarian and adds project management", () => {
  const perms = getEffectivePermissions("production");
  assert.ok(perms.has(P.APPROVAL_APPROVE));
  assert.ok(perms.has(P.ADMIN_MANAGE_PROJECTS));
  assert.ok(perms.has(P.IAM_MANAGE_MEMBERSHIPS));
  assert.ok(perms.has(P.DESTRUCTIVE_ARCHIVE_PROJECT));
  assert.ok(perms.has(P.DESTRUCTIVE_PURGE_DLQ));
  assert.ok(perms.has(P.INGEST_CREATE));
  assert.ok(perms.has(P.LIBRARY_MANAGE_COLLECTIONS));
  // Cannot manage users globally
  assert.ok(!perms.has(P.IAM_MANAGE_USERS));
});

test("pipeline_td has pipeline configuration permissions", () => {
  const perms = getEffectivePermissions("pipeline_td");
  // From viewer inheritance
  assert.ok(perms.has(P.BROWSE_ASSETS));
  // Own
  assert.ok(perms.has(P.PIPELINE_CONFIGURE_STAGES));
  assert.ok(perms.has(P.PIPELINE_MANAGE_FUNCTIONS));
  assert.ok(perms.has(P.PIPELINE_TRIGGER_REPROCESS));
  assert.ok(perms.has(P.EVENTS_PUBLISH));
  assert.ok(perms.has(P.EVENTS_VAST_SUBSCRIBE));
  // No approval authority
  assert.ok(!perms.has(P.APPROVAL_APPROVE));
});

test("platform_operator inherits pipeline_td and adds platform ops", () => {
  const perms = getEffectivePermissions("platform_operator");
  // From pipeline_td
  assert.ok(perms.has(P.PIPELINE_CONFIGURE_STAGES));
  assert.ok(perms.has(P.EVENTS_PUBLISH));
  // Own
  assert.ok(perms.has(P.ADMIN_METRICS));
  assert.ok(perms.has(P.ADMIN_INCIDENT));
  assert.ok(perms.has(P.PLATFORM_HEALTH_DASHBOARD));
  assert.ok(perms.has(P.PLATFORM_MANAGE_ALERTS));
  // No system config
  assert.ok(!perms.has(P.ADMIN_SYSTEM_CONFIG));
});

test("administrator has all permissions except super_admin-exclusive", () => {
  const perms = getEffectivePermissions("administrator");
  const allPermissions = Object.values(PERMISSIONS);
  for (const p of allPermissions) {
    if (p === P.IAM_PROMOTE_ADMIN || p === P.IAM_SYSTEM_BOOTSTRAP) continue;
    assert.ok(perms.has(p), `administrator missing permission: ${p}`);
  }
  // administrator does NOT have super_admin-exclusive permissions
  assert.ok(!perms.has(P.IAM_PROMOTE_ADMIN));
  assert.ok(!perms.has(P.IAM_SYSTEM_BOOTSTRAP));
});

test("super_admin has all permissions including promote_admin", () => {
  const perms = getEffectivePermissions("super_admin");
  const allPermissions = Object.values(PERMISSIONS);
  for (const p of allPermissions) {
    assert.ok(perms.has(p), `super_admin missing permission: ${p}`);
  }
});

// ---------------------------------------------------------------------------
// Multi-role resolution
// ---------------------------------------------------------------------------

test("getEffectivePermissionsForRoles unions permissions", () => {
  const roles: Role[] = ["viewer", "pipeline_td"];
  const perms = getEffectivePermissionsForRoles(roles);
  assert.ok(perms.has(P.BROWSE_ASSETS));
  assert.ok(perms.has(P.PIPELINE_CONFIGURE_STAGES));
  assert.ok(perms.has(P.EVENTS_PUBLISH));
});

test("hasPermission checks against role set", () => {
  assert.ok(hasPermission(["artist"], P.APPROVAL_SUBMIT));
  assert.ok(!hasPermission(["artist"], P.APPROVAL_APPROVE));
  assert.ok(hasPermission(["supervisor"], P.APPROVAL_APPROVE));
  assert.ok(hasPermission(["administrator"], P.ADMIN_SYSTEM_CONFIG));
});

// ---------------------------------------------------------------------------
// Role comparison
// ---------------------------------------------------------------------------

test("isAtLeast compares privilege levels", () => {
  assert.ok(isAtLeast("administrator", "viewer"));
  assert.ok(isAtLeast("supervisor", "artist"));
  assert.ok(isAtLeast("artist", "artist"));
  assert.ok(!isAtLeast("viewer", "artist"));
  assert.ok(isAtLeast("super_admin", "administrator"));
  assert.ok(!isAtLeast("administrator", "super_admin"));
});

// ---------------------------------------------------------------------------
// Action → Permission resolution
// ---------------------------------------------------------------------------

test("resolveActionPermission maps known routes", () => {
  const result = resolveActionPermission("GET", "/assets");
  assert.ok(result);
  assert.equal(result.permission, P.BROWSE_ASSETS);

  const ingest = resolveActionPermission("POST", "/assets/ingest");
  assert.ok(ingest);
  assert.equal(ingest.permission, P.INGEST_CREATE);
});

test("resolveActionPermission strips /api/v1 prefix", () => {
  const result = resolveActionPermission("GET", "/api/v1/assets");
  assert.ok(result);
  assert.equal(result.permission, P.BROWSE_ASSETS);
});

test("resolveActionPermission matches parameterized routes", () => {
  const result = resolveActionPermission("GET", "/jobs/abc-123");
  assert.ok(result);
  assert.equal(result.permission, P.BROWSE_JOBS);
});

test("resolveActionPermission returns null for unmapped routes", () => {
  const result = resolveActionPermission("GET", "/health");
  assert.equal(result, null);
});

test("resolveActionPermission maps approval routes", () => {
  const approve = resolveActionPermission("POST", "/approve");
  assert.ok(approve);
  assert.equal(approve.permission, P.APPROVAL_APPROVE);

  const reject = resolveActionPermission("POST", "/reject");
  assert.ok(reject);
  assert.equal(reject.permission, P.APPROVAL_REJECT);
});

test("resolveActionPermission maps destructive routes", () => {
  const dlq = resolveActionPermission("DELETE", "/dlq");
  assert.ok(dlq);
  assert.equal(dlq.permission, P.DESTRUCTIVE_PURGE_DLQ);
});
