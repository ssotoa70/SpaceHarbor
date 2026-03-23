import test from "node:test";
import assert from "node:assert/strict";

import { RoleBindingService } from "../../src/iam/role-binding.js";

function createService(): RoleBindingService {
  return new RoleBindingService();
}

// ---------------------------------------------------------------------------
// User registry
// ---------------------------------------------------------------------------

test("createUser creates a user with defaults", () => {
  const svc = createService();
  const user = svc.createUser({ email: "alice@studio.com", displayName: "Alice" });
  assert.ok(user.id);
  assert.equal(user.email, "alice@studio.com");
  assert.equal(user.displayName, "Alice");
  assert.equal(user.status, "active");
  assert.equal(user.externalId, null);
});

test("getUserById returns the created user", () => {
  const svc = createService();
  const user = svc.createUser({ email: "bob@studio.com", displayName: "Bob" });
  const found = svc.getUserById(user.id);
  assert.deepEqual(found, user);
});

test("getUserByEmail resolves user", () => {
  const svc = createService();
  svc.createUser({ email: "charlie@studio.com", displayName: "Charlie" });
  const found = svc.getUserByEmail("charlie@studio.com");
  assert.ok(found);
  assert.equal(found.email, "charlie@studio.com");
});

test("getUserByExternalId resolves user", () => {
  const svc = createService();
  svc.createUser({ email: "d@studio.com", displayName: "D", externalId: "ext-001" });
  const found = svc.getUserByExternalId("ext-001");
  assert.ok(found);
  assert.equal(found.externalId, "ext-001");
});

test("getUserById returns null for unknown id", () => {
  const svc = createService();
  assert.equal(svc.getUserById("nope"), null);
});

test("updateUserStatus changes status", () => {
  const svc = createService();
  const user = svc.createUser({ email: "e@studio.com", displayName: "E" });
  const updated = svc.updateUserStatus(user.id, "disabled");
  assert.ok(updated);
  assert.equal(updated.status, "disabled");
});

test("listUsers returns all users", () => {
  const svc = createService();
  svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.createUser({ email: "b@s.com", displayName: "B" });
  assert.equal(svc.listUsers().length, 2);
});

// ---------------------------------------------------------------------------
// Project role binding
// ---------------------------------------------------------------------------

test("grantProjectRole creates membership", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  const membership = svc.grantProjectRole({
    userId: user.id,
    projectId: "proj-1",
    tenantId: "tenant-a",
    role: "artist",
    grantedBy: "admin-1",
  });
  assert.ok(membership.id);
  assert.equal(membership.role, "artist");
  assert.equal(membership.projectId, "proj-1");
  assert.equal(membership.tenantId, "tenant-a");
});

test("grantProjectRole updates existing membership role", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({
    userId: user.id, projectId: "proj-1", tenantId: "t", role: "artist", grantedBy: "admin",
  });
  const updated = svc.grantProjectRole({
    userId: user.id, projectId: "proj-1", tenantId: "t", role: "supervisor", grantedBy: "admin",
  });
  assert.equal(updated.role, "supervisor");
  // Only one membership for this project
  assert.equal(svc.listUserMemberships(user.id).length, 1);
});

test("revokeProjectRole removes membership", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({
    userId: user.id, projectId: "proj-1", tenantId: "t", role: "artist", grantedBy: "admin",
  });
  const revoked = svc.revokeProjectRole(user.id, "proj-1", "admin");
  assert.equal(revoked, true);
  assert.equal(svc.listUserMemberships(user.id).length, 0);
});

test("revokeProjectRole returns false for non-existent", () => {
  const svc = createService();
  assert.equal(svc.revokeProjectRole("unknown", "proj-1", "admin"), false);
});

test("listProjectMembers returns members of a project", () => {
  const svc = createService();
  const a = svc.createUser({ email: "a@s.com", displayName: "A" });
  const b = svc.createUser({ email: "b@s.com", displayName: "B" });
  svc.grantProjectRole({ userId: a.id, projectId: "proj-1", tenantId: "t", role: "artist", grantedBy: "admin" });
  svc.grantProjectRole({ userId: b.id, projectId: "proj-1", tenantId: "t", role: "supervisor", grantedBy: "admin" });
  svc.grantProjectRole({ userId: a.id, projectId: "proj-2", tenantId: "t", role: "viewer", grantedBy: "admin" });

  const members = svc.listProjectMembers("proj-1");
  assert.equal(members.length, 2);
});

test("listTenantMemberships returns all memberships for a tenant", () => {
  const svc = createService();
  const a = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: a.id, projectId: "p1", tenantId: "t-a", role: "artist", grantedBy: "admin" });
  svc.grantProjectRole({ userId: a.id, projectId: "p2", tenantId: "t-b", role: "viewer", grantedBy: "admin" });

  const tenantA = svc.listTenantMemberships("t-a");
  assert.equal(tenantA.length, 1);
  assert.equal(tenantA[0].projectId, "p1");
});

// ---------------------------------------------------------------------------
// Global roles
// ---------------------------------------------------------------------------

test("grantGlobalRole assigns administrator role", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  const assignment = svc.grantGlobalRole(user.id, "administrator", "system");
  assert.equal(assignment.role, "administrator");
  assert.equal(assignment.userId, user.id);
});

test("getGlobalRole returns assignment", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantGlobalRole(user.id, "administrator", "system");
  const role = svc.getGlobalRole(user.id);
  assert.ok(role);
  assert.equal(role.role, "administrator");
});

test("revokeGlobalRole removes assignment", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantGlobalRole(user.id, "administrator", "system");
  assert.equal(svc.revokeGlobalRole(user.id, "system"), true);
  assert.equal(svc.getGlobalRole(user.id), null);
});

// ---------------------------------------------------------------------------
// Entitlement evaluation
// ---------------------------------------------------------------------------

test("getEffectiveRoles includes project role and global role", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: user.id, projectId: "proj-1", tenantId: "t", role: "artist", grantedBy: "admin" });
  svc.grantGlobalRole(user.id, "administrator", "system");

  const roles = svc.getEffectiveRoles(user.id, "proj-1");
  assert.ok(roles.includes("administrator"));
  assert.ok(roles.includes("artist"));
});

test("getEffectiveRoles returns empty for unknown user", () => {
  const svc = createService();
  const roles = svc.getEffectiveRoles("unknown", "proj-1");
  assert.equal(roles.length, 0);
});

test("getEffectiveRoles with null projectId returns only global role", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: user.id, projectId: "proj-1", tenantId: "t", role: "artist", grantedBy: "admin" });

  const roles = svc.getEffectiveRoles(user.id, null);
  assert.equal(roles.length, 0); // No global role, projectId=null → no project role
});

test("getUserTenantIds returns distinct tenant IDs", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: user.id, projectId: "p1", tenantId: "t-a", role: "artist", grantedBy: "admin" });
  svc.grantProjectRole({ userId: user.id, projectId: "p2", tenantId: "t-a", role: "viewer", grantedBy: "admin" });
  svc.grantProjectRole({ userId: user.id, projectId: "p3", tenantId: "t-b", role: "reviewer", grantedBy: "admin" });

  const tenantIds = svc.getUserTenantIds(user.id);
  assert.equal(tenantIds.length, 2);
  assert.ok(tenantIds.includes("t-a"));
  assert.ok(tenantIds.includes("t-b"));
});

test("getUserProjectIds returns projects within tenant", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: user.id, projectId: "p1", tenantId: "t-a", role: "artist", grantedBy: "admin" });
  svc.grantProjectRole({ userId: user.id, projectId: "p2", tenantId: "t-a", role: "viewer", grantedBy: "admin" });
  svc.grantProjectRole({ userId: user.id, projectId: "p3", tenantId: "t-b", role: "reviewer", grantedBy: "admin" });

  const projects = svc.getUserProjectIds(user.id, "t-a");
  assert.equal(projects.length, 2);
  assert.ok(projects.includes("p1"));
  assert.ok(projects.includes("p2"));
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

test("role changes are recorded in audit log", () => {
  const svc = createService();
  const user = svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.grantProjectRole({ userId: user.id, projectId: "p1", tenantId: "t", role: "artist", grantedBy: "admin-1" });
  svc.revokeProjectRole(user.id, "p1", "admin-1");
  svc.grantGlobalRole(user.id, "administrator", "system");

  const log = svc.getAuditLog();
  assert.equal(log.length, 3);
  assert.equal(log[0].action, "grant");
  assert.equal(log[0].role, "artist");
  assert.equal(log[1].action, "revoke");
  assert.equal(log[2].action, "grant");
  assert.equal(log[2].role, "administrator");
});

test("getAuditLogByUser filters by user", () => {
  const svc = createService();
  const a = svc.createUser({ email: "a@s.com", displayName: "A" });
  const b = svc.createUser({ email: "b@s.com", displayName: "B" });
  svc.grantProjectRole({ userId: a.id, projectId: "p1", tenantId: "t", role: "artist", grantedBy: "admin" });
  svc.grantProjectRole({ userId: b.id, projectId: "p1", tenantId: "t", role: "viewer", grantedBy: "admin" });

  const logA = svc.getAuditLogByUser(a.id);
  assert.equal(logA.length, 1);
  assert.equal(logA[0].role, "artist");
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test("reset clears all state", () => {
  const svc = createService();
  svc.createUser({ email: "a@s.com", displayName: "A" });
  svc.reset();
  assert.equal(svc.listUsers().length, 0);
  assert.equal(svc.getAuditLog().length, 0);
});
