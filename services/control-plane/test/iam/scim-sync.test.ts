import test from "node:test";
import assert from "node:assert/strict";

import { RoleBindingService } from "../../src/iam/role-binding.js";
import { ScimSyncService, type ScimUser } from "../../src/iam/scim-sync.js";

function setup() {
  const rbs = new RoleBindingService();
  const scim = new ScimSyncService(rbs);
  scim.setGroupRoleMappings([
    { groupName: "studio-artists", projectId: "proj-1", tenantId: "t-a", role: "artist" },
    { groupName: "studio-supervisors", projectId: "proj-1", tenantId: "t-a", role: "supervisor" },
    { groupName: "studio-reviewers", projectId: "proj-2", tenantId: "t-a", role: "reviewer" },
  ]);
  return { rbs, scim };
}

function makeScimUser(overrides: Partial<ScimUser> = {}): ScimUser {
  return {
    id: "scim-1",
    externalId: "ext-001",
    userName: "alice",
    displayName: "Alice Smith",
    emails: [{ value: "alice@studio.com", primary: true }],
    active: true,
    groups: [{ value: "g-1", display: "studio-artists" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// User creation
// ---------------------------------------------------------------------------

test("syncUsers creates new user from SCIM", () => {
  const { rbs, scim } = setup();
  const result = scim.syncUsers([makeScimUser()]);
  assert.equal(result.usersCreated, 1);
  assert.equal(result.errors.length, 0);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  assert.equal(user.displayName, "Alice Smith");
  assert.equal(user.email, "alice@studio.com");
});

test("syncUsers does not duplicate existing user", () => {
  const { rbs, scim } = setup();
  scim.syncUsers([makeScimUser()]);
  const result = scim.syncUsers([makeScimUser()]);
  assert.equal(result.usersCreated, 0);
  assert.equal(rbs.listUsers().length, 1);
});

// ---------------------------------------------------------------------------
// Group-to-role mapping
// ---------------------------------------------------------------------------

test("syncUsers grants project role based on group mapping", () => {
  const { rbs, scim } = setup();
  scim.syncUsers([makeScimUser({
    groups: [{ value: "g-1", display: "studio-artists" }],
  })]);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  const memberships = rbs.listUserMemberships(user.id);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role, "artist");
  assert.equal(memberships[0].projectId, "proj-1");
});

test("syncUsers grants multiple roles from multiple groups", () => {
  const { rbs, scim } = setup();
  scim.syncUsers([makeScimUser({
    groups: [
      { value: "g-1", display: "studio-artists" },
      { value: "g-2", display: "studio-reviewers" },
    ],
  })]);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  const memberships = rbs.listUserMemberships(user.id);
  assert.equal(memberships.length, 2);
});

test("syncUsers revokes memberships when user removed from group", () => {
  const { rbs, scim } = setup();
  // First sync: user in two groups
  scim.syncUsers([makeScimUser({
    groups: [
      { value: "g-1", display: "studio-artists" },
      { value: "g-2", display: "studio-reviewers" },
    ],
  })]);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  assert.equal(rbs.listUserMemberships(user.id).length, 2);

  // Second sync: user only in one group
  const result = scim.syncUsers([makeScimUser({
    groups: [{ value: "g-1", display: "studio-artists" }],
  })]);
  assert.equal(result.membershipsRevoked, 1);
  assert.equal(rbs.listUserMemberships(user.id).length, 1);
});

// ---------------------------------------------------------------------------
// User disable
// ---------------------------------------------------------------------------

test("syncUsers disables inactive user", () => {
  const { rbs, scim } = setup();
  scim.syncUsers([makeScimUser()]);
  const result = scim.syncUsers([makeScimUser({ active: false })]);
  assert.equal(result.usersDisabled, 1);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  assert.equal(user.status, "disabled");
});

test("syncUsers re-enables user", () => {
  const { rbs, scim } = setup();
  scim.syncUsers([makeScimUser({ active: false })]);
  scim.syncUsers([makeScimUser({ active: true })]);
  const user = rbs.getUserByExternalId("ext-001");
  assert.ok(user);
  assert.equal(user.status, "active");
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test("syncUsers records error for user without email", () => {
  const { scim } = setup();
  const result = scim.syncUsers([makeScimUser({ emails: [] })]);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].includes("no email"));
});

// ---------------------------------------------------------------------------
// Batch sync
// ---------------------------------------------------------------------------

test("syncUsers handles batch of multiple users", () => {
  const { rbs, scim } = setup();
  const result = scim.syncUsers([
    makeScimUser({ externalId: "ext-001", emails: [{ value: "a@s.com", primary: true }] }),
    makeScimUser({ externalId: "ext-002", userName: "bob", displayName: "Bob", emails: [{ value: "b@s.com", primary: true }] }),
    makeScimUser({ externalId: "ext-003", userName: "charlie", displayName: "Charlie", emails: [{ value: "c@s.com", primary: true }], active: false }),
  ]);
  assert.equal(result.usersCreated, 3);
  assert.equal(result.usersDisabled, 0); // disabled on create doesn't count as "disabled" event
  assert.equal(rbs.listUsers().length, 3);
});
