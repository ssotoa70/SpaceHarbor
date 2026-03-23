// ---------------------------------------------------------------------------
// Phase 2.5: SCIM Inbound Endpoint Tests
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCIM_TOKEN = "scim-test-token-xyz";

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

function scimHeaders() {
  return {
    authorization: `Bearer ${SCIM_TOKEN}`,
    "content-type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// SCIM auth: requires bearer token
// ---------------------------------------------------------------------------

test("SCIM: rejects request without bearer token", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
    });

    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.match(body.detail, /SCIM bearer token required/);

    await app.close();
  });
});

test("SCIM: rejects request with wrong bearer token", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
      headers: { authorization: "Bearer wrong-token" },
    });

    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /scim/v2/Users — List users
// ---------------------------------------------------------------------------

test("SCIM: GET /scim/v2/Users returns user list", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.Resources));
    assert.equal(body.schemas[0], "urn:ietf:params:scim:api:messages:2.0:ListResponse");

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /scim/v2/Users — Create user
// ---------------------------------------------------------------------------

test("SCIM: POST /scim/v2/Users creates a user", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        externalId: "scim-ext-001",
        userName: "scimuser@studio.com",
        displayName: "SCIM User",
        emails: [{ value: "scimuser@studio.com", primary: true }],
        active: true,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.userName, "scimuser@studio.com");
    assert.equal(body.displayName, "SCIM User");
    assert.equal(body.active, true);
    assert.ok(body.id);

    await app.close();
  });
});

test("SCIM: POST /scim/v2/Users rejects duplicate externalId", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create first user
    await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        externalId: "scim-dup-001",
        userName: "dup@studio.com",
        displayName: "Dup User",
        emails: [{ value: "dup@studio.com", primary: true }],
        active: true,
      },
    });

    // Try to create duplicate
    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        externalId: "scim-dup-001",
        userName: "dup2@studio.com",
        displayName: "Dup User 2",
        emails: [{ value: "dup2@studio.com", primary: true }],
        active: true,
      },
    });

    assert.equal(res.statusCode, 409);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PUT /scim/v2/Users/:id — Full update
// ---------------------------------------------------------------------------

test("SCIM: PUT /scim/v2/Users/:id updates user status", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create a user first
    const createRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        externalId: "scim-put-001",
        userName: "putuser@studio.com",
        displayName: "Put User",
        emails: [{ value: "putuser@studio.com", primary: true }],
        active: true,
      },
    });

    const created = JSON.parse(createRes.body);

    // Disable the user
    const res = await app.inject({
      method: "PUT",
      url: `/scim/v2/Users/${created.id}`,
      headers: scimHeaders(),
      payload: {
        active: false,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.active, false);

    await app.close();
  });
});

test("SCIM: PUT /scim/v2/Users/:id returns 404 for unknown user", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "PUT",
      url: "/scim/v2/Users/nonexistent-id",
      headers: scimHeaders(),
      payload: { active: false },
    });

    assert.equal(res.statusCode, 404);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PATCH /scim/v2/Users/:id — Partial update (enable/disable)
// ---------------------------------------------------------------------------

test("SCIM: PATCH /scim/v2/Users/:id disables user via Operations", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create a user first
    const createRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        externalId: "scim-patch-001",
        userName: "patchuser@studio.com",
        displayName: "Patch User",
        emails: [{ value: "patchuser@studio.com", primary: true }],
        active: true,
      },
    });

    const created = JSON.parse(createRes.body);

    // Disable via PATCH
    const res = await app.inject({
      method: "PATCH",
      url: `/scim/v2/Users/${created.id}`,
      headers: scimHeaders(),
      payload: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "replace", path: "active", value: false },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.active, false);

    await app.close();
  });
});

test("SCIM: PATCH /scim/v2/Users/:id returns 404 for unknown user", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "PATCH",
      url: "/scim/v2/Users/nonexistent-id",
      headers: scimHeaders(),
      payload: {
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });

    assert.equal(res.statusCode, 404);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// SCIM auth: rejects when no SCIM token configured
// ---------------------------------------------------------------------------

test("SCIM: rejects when SPACEHARBOR_SCIM_TOKEN is not configured", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: undefined }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
      headers: { authorization: "Bearer any-token" },
    });

    assert.equal(res.statusCode, 401);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /scim/v2/Groups — List groups (auth checks)
// ---------------------------------------------------------------------------

test("SCIM Groups: GET /scim/v2/Groups requires auth", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Groups",
    });

    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("SCIM Groups: GET /scim/v2/Groups rejects wrong token", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Groups",
      headers: { authorization: "Bearer wrong-token" },
    });

    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

test("SCIM Groups: GET /scim/v2/Groups returns SCIM ListResponse with global roles", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.schemas[0], "urn:ietf:params:scim:api:messages:2.0:ListResponse");
    assert.ok(typeof body.totalResults === "number");
    assert.ok(Array.isArray(body.Resources));

    // Every resource must be a SCIM Group
    for (const group of body.Resources) {
      assert.equal(group.schemas[0], "urn:ietf:params:scim:schemas:core:2.0:Group");
      assert.ok(typeof group.id === "string");
      assert.ok(typeof group.displayName === "string");
      assert.ok(Array.isArray(group.members));
      assert.equal(group.meta.resourceType, "Group");
    }

    // All three global roles must be present
    const ids = body.Resources.map((g: any) => g.id);
    assert.ok(ids.includes("platform_operator"));
    assert.ok(ids.includes("administrator"));
    assert.ok(ids.includes("super_admin"));

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /scim/v2/Groups/:id — Get single group
// ---------------------------------------------------------------------------

test("SCIM Groups: GET /scim/v2/Groups/:id returns group resource", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Groups/administrator",
      headers: scimHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.schemas[0], "urn:ietf:params:scim:schemas:core:2.0:Group");
    assert.equal(body.id, "administrator");
    assert.equal(body.displayName, "administrator");
    assert.ok(Array.isArray(body.members));
    assert.equal(body.meta.resourceType, "Group");

    await app.close();
  });
});

test("SCIM Groups: GET /scim/v2/Groups/:id returns 404 for unknown group", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/scim/v2/Groups/does-not-exist",
      headers: scimHeaders(),
    });

    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /scim/v2/Groups — Create group / assign members
// ---------------------------------------------------------------------------

test("SCIM Groups: POST /scim/v2/Groups creates group with members", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create a user first
    const userRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: {
        userName: "groupmember@studio.com",
        displayName: "Group Member",
        emails: [{ value: "groupmember@studio.com", primary: true }],
        active: true,
      },
    });
    const user = JSON.parse(userRes.body);

    // Create the group with that member
    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
      payload: {
        displayName: "administrator",
        members: [{ value: user.id }],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.schemas[0], "urn:ietf:params:scim:schemas:core:2.0:Group");
    assert.equal(body.id, "administrator");
    assert.equal(body.displayName, "administrator");
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].value, user.id);

    await app.close();
  });
});

test("SCIM Groups: POST /scim/v2/Groups returns 400 for unknown displayName", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
      payload: {
        displayName: "not-a-real-role",
      },
    });

    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

test("SCIM Groups: POST /scim/v2/Groups returns 400 when member user does not exist", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
      payload: {
        displayName: "administrator",
        members: [{ value: "nonexistent-user-id" }],
      },
    });

    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PUT /scim/v2/Groups/:id — Replace group membership
// ---------------------------------------------------------------------------

test("SCIM Groups: PUT /scim/v2/Groups/:id replaces membership", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create two users
    const u1Res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: { userName: "put-u1@studio.com", displayName: "Put U1", emails: [{ value: "put-u1@studio.com", primary: true }], active: true },
    });
    const u2Res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: { userName: "put-u2@studio.com", displayName: "Put U2", emails: [{ value: "put-u2@studio.com", primary: true }], active: true },
    });
    const u1 = JSON.parse(u1Res.body);
    const u2 = JSON.parse(u2Res.body);

    // Assign u1 to the group
    await app.inject({
      method: "POST",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
      payload: { displayName: "platform_operator", members: [{ value: u1.id }] },
    });

    // PUT with only u2 — u1 should be removed
    const putRes = await app.inject({
      method: "PUT",
      url: "/scim/v2/Groups/platform_operator",
      headers: scimHeaders(),
      payload: { members: [{ value: u2.id }] },
    });

    assert.equal(putRes.statusCode, 200);
    const body = JSON.parse(putRes.body);
    const memberIds = body.members.map((m: any) => m.value);
    assert.ok(memberIds.includes(u2.id), "u2 should be a member");
    assert.ok(!memberIds.includes(u1.id), "u1 should have been removed");

    await app.close();
  });
});

test("SCIM Groups: PUT /scim/v2/Groups/:id returns 404 for unknown group", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "PUT",
      url: "/scim/v2/Groups/not-a-role",
      headers: scimHeaders(),
      payload: { members: [] },
    });

    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PATCH /scim/v2/Groups/:id — Add / remove members
// ---------------------------------------------------------------------------

test("SCIM Groups: PATCH add member to group", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create user
    const userRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: { userName: "patch-add@studio.com", displayName: "Patch Add", emails: [{ value: "patch-add@studio.com", primary: true }], active: true },
    });
    const user = JSON.parse(userRes.body);

    const res = await app.inject({
      method: "PATCH",
      url: "/scim/v2/Groups/super_admin",
      headers: scimHeaders(),
      payload: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "add", path: "members", value: [{ value: user.id }] },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const memberIds = body.members.map((m: any) => m.value);
    assert.ok(memberIds.includes(user.id), "user should be added to group");

    await app.close();
  });
});

test("SCIM Groups: PATCH remove member from group", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    // Create user and add to group
    const userRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: scimHeaders(),
      payload: { userName: "patch-rem@studio.com", displayName: "Patch Remove", emails: [{ value: "patch-rem@studio.com", primary: true }], active: true },
    });
    const user = JSON.parse(userRes.body);

    await app.inject({
      method: "POST",
      url: "/scim/v2/Groups",
      headers: scimHeaders(),
      payload: { displayName: "super_admin", members: [{ value: user.id }] },
    });

    // Remove user
    const res = await app.inject({
      method: "PATCH",
      url: "/scim/v2/Groups/super_admin",
      headers: scimHeaders(),
      payload: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "remove", path: "members", value: [{ value: user.id }] },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const memberIds = body.members.map((m: any) => m.value);
    assert.ok(!memberIds.includes(user.id), "user should be removed from group");

    await app.close();
  });
});

test("SCIM Groups: PATCH returns 404 for unknown group", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "PATCH",
      url: "/scim/v2/Groups/not-a-role",
      headers: scimHeaders(),
      payload: {
        Operations: [{ op: "add", path: "members", value: [] }],
      },
    });

    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

test("SCIM Groups: PATCH add returns 400 when member user does not exist", async () => {
  await withEnv({ SPACEHARBOR_SCIM_TOKEN: SCIM_TOKEN }, async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "PATCH",
      url: "/scim/v2/Groups/administrator",
      headers: scimHeaders(),
      payload: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "add", path: "members", value: [{ value: "ghost-user-id" }] },
        ],
      },
    });

    assert.equal(res.statusCode, 400);
    await app.close();
  });
});
