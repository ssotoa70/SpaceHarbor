// ---------------------------------------------------------------------------
// Phase 2.5: SCIM 2.0 Inbound Endpoint (RFC 7644 subset)
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";

import type { RoleBindingService } from "../iam/role-binding.js";
import type { PersistentRoleBindingService } from "../iam/persistent-role-binding.js";
import { GLOBAL_ROLES, type GlobalRole } from "../iam/types.js";

type RoleService = RoleBindingService | PersistentRoleBindingService;

// Resolve result from sync or async role binding service
async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

// ---------------------------------------------------------------------------
// SCIM bearer token authentication
// ---------------------------------------------------------------------------

import { timingSafeEqual } from "node:crypto";

function validateScimToken(authHeader: string | undefined): boolean {
  const token = process.env.SPACEHARBOR_SCIM_TOKEN?.trim();
  if (!token) return false;
  if (!authHeader) return false;
  if (!authHeader.startsWith("Bearer ")) return false;
  const provided = authHeader.slice(7).trim();
  // Use constant-time comparison to prevent timing attacks
  if (provided.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}

// ---------------------------------------------------------------------------
// SCIM response builders
// ---------------------------------------------------------------------------

function scimUserResource(user: {
  id: string;
  externalId: string | null;
  email: string;
  displayName: string;
  status: string;
}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.externalId ?? undefined,
    userName: user.email,
    displayName: user.displayName,
    emails: [{ value: user.email, primary: true }],
    active: user.status === "active",
    meta: {
      resourceType: "User",
    },
  };
}

function scimListResponse(users: readonly any[]) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: users.length,
    Resources: users.map(scimUserResource),
  };
}

function scimError(status: number, detail: string) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };
}

// ---------------------------------------------------------------------------
// SCIM Groups helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a displayName value maps to a known GlobalRole.
 * Accepts exact role names only — no free-form input accepted.
 * Returns the role or null if not recognized.
 */
function parseGroupDisplayName(displayName: string | undefined): GlobalRole | null {
  if (!displayName) return null;
  const trimmed = displayName.trim();
  if ((GLOBAL_ROLES as readonly string[]).includes(trimmed)) {
    return trimmed as GlobalRole;
  }
  return null;
}

/**
 * Builds a SCIM Group resource from a role name and its member user IDs.
 * Uses the role name as the stable group id (no UUID — deterministic).
 */
function scimGroupResource(
  role: GlobalRole,
  memberRefs: Array<{ userId: string; displayName: string }>,
  baseUrl: string,
) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: role,
    displayName: role,
    members: memberRefs.map((m) => ({
      value: m.userId,
      display: m.displayName,
      $ref: `${baseUrl}/scim/v2/Users/${m.userId}`,
    })),
    meta: {
      resourceType: "Group",
      location: `${baseUrl}/scim/v2/Groups/${role}`,
    },
  };
}

function scimGroupListResponse(groups: readonly any[]) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: groups.length,
    Resources: groups,
  };
}

/**
 * Collects all users holding a given global role.
 * Works for both RoleBindingService (sync) and PersistentRoleBindingService (async).
 */
async function getUsersForGlobalRole(
  svc: RoleService,
  role: GlobalRole,
): Promise<Array<{ userId: string; displayName: string }>> {
  const users = await resolve(svc.listUsers());
  const members: Array<{ userId: string; displayName: string }> = [];
  for (const user of users) {
    const assignment = await resolve(svc.getGlobalRole(user.id));
    if (assignment?.role === role) {
      members.push({ userId: user.id, displayName: user.displayName });
    }
  }
  return members;
}

/**
 * Derives the base URL for SCIM $ref links from the Fastify request.
 * Falls back to an empty string so links are relative when the host cannot be determined.
 */
function baseUrlFromRequest(request: any): string {
  const proto = (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "http";
  const host = request.headers["host"] as string | undefined;
  if (!host) return "";
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerScimRoutes(
  app: FastifyInstance,
  getRoleService: () => RoleService,
): void {
  // -------------------------------------------------------------------------
  // SCIM auth hook — all /scim/v2/* routes require bearer token
  // -------------------------------------------------------------------------
  function checkScimAuth(request: any, reply: any): boolean {
    if (!validateScimToken(request.headers.authorization)) {
      reply.status(401).send(scimError(401, "SCIM bearer token required"));
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // GET /scim/v2/Users — List users for reconciliation
  // -------------------------------------------------------------------------
  app.get("/scim/v2/Users", {
    schema: {
      tags: ["scim"],
      operationId: "scimListUsers",
      summary: "SCIM 2.0 — List all users for IdP reconciliation",
      security: [{ ScimTokenAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            totalResults: { type: "number" },
            Resources: { type: "array", items: { type: "object" } },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const svc = getRoleService();
    const users = await resolve(svc.listUsers());
    return reply.send(scimListResponse(users));
  });

  // -------------------------------------------------------------------------
  // POST /scim/v2/Users — Create user from IdP push
  // -------------------------------------------------------------------------
  app.post("/scim/v2/Users", {
    schema: {
      tags: ["scim"],
      operationId: "scimCreateUser",
      summary: "SCIM 2.0 — Create a user from an IdP push",
      security: [{ ScimTokenAuth: [] }],
      body: {
        type: "object",
        properties: {
          externalId: { type: "string" },
          userName: { type: "string" },
          displayName: { type: "string" },
          emails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                primary: { type: "boolean" },
              },
            },
          },
          active: { type: "boolean" },
        },
      },
      response: {
        201: { type: "object" },
        400: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        409: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const body = request.body as {
      externalId?: string;
      userName?: string;
      displayName?: string;
      emails?: Array<{ value: string; primary?: boolean }>;
      active?: boolean;
    } | null;

    if (!body?.userName && !body?.emails?.length) {
      return reply.status(400).send(scimError(400, "userName or emails required"));
    }

    const email = body.emails?.find((e) => e.primary)?.value ?? body.emails?.[0]?.value ?? body.userName ?? "";
    const displayName = body.displayName ?? email;
    const externalId = body.externalId ?? undefined;

    const svc = getRoleService();

    // Check for existing user by externalId or email
    if (externalId) {
      const existing = await resolve(svc.getUserByExternalId(externalId));
      if (existing) {
        return reply.status(409).send(scimError(409, "user with this externalId already exists"));
      }
    }

    const existingByEmail = await resolve(svc.getUserByEmail(email));
    if (existingByEmail) {
      return reply.status(409).send(scimError(409, "user with this email already exists"));
    }

    const user = await resolve(svc.createUser({
      email,
      displayName,
      externalId,
      status: body.active === false ? "disabled" : "active",
    }));

    return reply.status(201).send(scimUserResource(user));
  });

  // -------------------------------------------------------------------------
  // PUT /scim/v2/Users/:id — Full update
  // -------------------------------------------------------------------------
  app.put("/scim/v2/Users/:id", {
    schema: {
      tags: ["scim"],
      operationId: "scimReplaceUser",
      summary: "SCIM 2.0 — Full replacement update of a user",
      security: [{ ScimTokenAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          displayName: { type: "string" },
          emails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                primary: { type: "boolean" },
              },
            },
          },
          active: { type: "boolean" },
        },
      },
      response: {
        200: { type: "object" },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      displayName?: string;
      emails?: Array<{ value: string; primary?: boolean }>;
      active?: boolean;
    } | null;

    const svc = getRoleService();
    const user = await resolve(svc.getUserById(id));
    if (!user) {
      return reply.status(404).send(scimError(404, "user not found"));
    }

    // Update status based on active flag
    if (body?.active !== undefined) {
      const newStatus = body.active ? "active" : "disabled";
      if (user.status !== newStatus) {
        await resolve(svc.updateUserStatus(id, newStatus as any));
      }
    }

    // Re-fetch to return updated state
    const updated = await resolve(svc.getUserById(id));
    return reply.send(scimUserResource(updated!));
  });

  // -------------------------------------------------------------------------
  // PATCH /scim/v2/Users/:id — Partial update (enable/disable)
  // -------------------------------------------------------------------------
  app.patch("/scim/v2/Users/:id", {
    schema: {
      tags: ["scim"],
      operationId: "scimPatchUser",
      summary: "SCIM 2.0 — Partial update of a user (RFC 7644 PatchOp)",
      security: [{ ScimTokenAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          schemas: { type: "array", items: { type: "string" } },
          Operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                op: { type: "string" },
                path: { type: "string" },
                value: {},
              },
            },
          },
        },
      },
      response: {
        200: { type: "object" },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      schemas?: string[];
      Operations?: Array<{
        op: string;
        path?: string;
        value?: any;
      }>;
    } | null;

    const svc = getRoleService();
    const user = await resolve(svc.getUserById(id));
    if (!user) {
      return reply.status(404).send(scimError(404, "user not found"));
    }

    // Process SCIM PATCH operations
    if (body?.Operations) {
      for (const op of body.Operations) {
        if (op.path === "active" && op.op === "replace") {
          const active = op.value === true || op.value === "true";
          const newStatus = active ? "active" : "disabled";
          if (user.status !== newStatus) {
            await resolve(svc.updateUserStatus(id, newStatus as any));
          }
        }
      }
    }

    // Re-fetch to return updated state
    const updated = await resolve(svc.getUserById(id));
    return reply.send(scimUserResource(updated!));
  });

  // -------------------------------------------------------------------------
  // GET /scim/v2/Groups — List all virtual role-groups
  // -------------------------------------------------------------------------
  app.get("/scim/v2/Groups", {
    schema: {
      tags: ["scim"],
      operationId: "scimListGroups",
      summary: "SCIM 2.0 — List all role-backed groups",
      security: [{ ScimTokenAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            totalResults: { type: "number" },
            Resources: { type: "array", items: { type: "object" } },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const svc = getRoleService();
    const base = baseUrlFromRequest(request);
    const groups: any[] = [];

    for (const role of GLOBAL_ROLES) {
      const members = await getUsersForGlobalRole(svc, role);
      groups.push(scimGroupResource(role, members, base));
    }

    return reply.send(scimGroupListResponse(groups));
  });

  // -------------------------------------------------------------------------
  // GET /scim/v2/Groups/:id — Get single group by role name
  // -------------------------------------------------------------------------
  app.get("/scim/v2/Groups/:id", {
    schema: {
      tags: ["scim"],
      operationId: "scimGetGroup",
      summary: "SCIM 2.0 — Get a single group by role name",
      security: [{ ScimTokenAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", description: "Role name used as group ID" } },
      },
      response: {
        200: { type: "object" },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const role = parseGroupDisplayName(id);
    if (!role) {
      return reply.status(404).send(scimError(404, "group not found"));
    }

    const svc = getRoleService();
    const base = baseUrlFromRequest(request);
    const members = await getUsersForGlobalRole(svc, role);
    return reply.send(scimGroupResource(role, members, base));
  });

  // -------------------------------------------------------------------------
  // POST /scim/v2/Groups — Create group (idempotent — roles are fixed enum)
  // -------------------------------------------------------------------------
  app.post("/scim/v2/Groups", {
    schema: {
      tags: ["scim"],
      operationId: "scimCreateGroup",
      summary: "SCIM 2.0 — Create / populate a role-backed group",
      security: [{ ScimTokenAuth: [] }],
      body: {
        type: "object",
        properties: {
          displayName: { type: "string", description: "Must be a known global role name" },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: { value: { type: "string" } },
            },
          },
        },
      },
      response: {
        201: { type: "object" },
        400: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const body = request.body as {
      displayName?: string;
      members?: Array<{ value?: string }>;
    } | null;

    const role = parseGroupDisplayName(body?.displayName);
    if (!role) {
      return reply
        .status(400)
        .send(scimError(400, `displayName must be one of: ${GLOBAL_ROLES.join(", ")}`));
    }

    const svc = getRoleService();
    const base = baseUrlFromRequest(request);

    // Assign the global role to each provided member
    const memberValues = (body?.members ?? [])
      .map((m) => m?.value)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

    for (const userId of memberValues) {
      const user = await resolve(svc.getUserById(userId));
      if (!user) {
        return reply.status(400).send(scimError(400, `member value "${userId}" does not reference a known user`));
      }
      await resolve(svc.grantGlobalRole(userId, role, "scim"));
    }

    const members = await getUsersForGlobalRole(svc, role);
    return reply.status(201).send(scimGroupResource(role, members, base));
  });

  // -------------------------------------------------------------------------
  // PUT /scim/v2/Groups/:id — Full replacement of group membership
  // -------------------------------------------------------------------------
  app.put("/scim/v2/Groups/:id", {
    schema: {
      tags: ["scim"],
      operationId: "scimReplaceGroup",
      summary: "SCIM 2.0 — Full replacement of group membership",
      security: [{ ScimTokenAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          members: {
            type: "array",
            items: {
              type: "object",
              properties: { value: { type: "string" } },
            },
          },
        },
      },
      response: {
        200: { type: "object" },
        400: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const role = parseGroupDisplayName(id);
    if (!role) {
      return reply.status(404).send(scimError(404, "group not found"));
    }

    const body = request.body as {
      members?: Array<{ value?: string }>;
    } | null;

    const svc = getRoleService();
    const base = baseUrlFromRequest(request);

    const incomingIds = new Set(
      (body?.members ?? [])
        .map((m) => m?.value)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
    );

    // Validate all incoming members exist before making any changes
    for (const userId of incomingIds) {
      const user = await resolve(svc.getUserById(userId));
      if (!user) {
        return reply.status(400).send(scimError(400, `member value "${userId}" does not reference a known user`));
      }
    }

    // Determine current members of this role
    const currentMembers = await getUsersForGlobalRole(svc, role);
    const currentIds = new Set(currentMembers.map((m) => m.userId));

    // Revoke role from users no longer in the set
    for (const userId of currentIds) {
      if (!incomingIds.has(userId)) {
        await resolve(svc.revokeGlobalRole(userId, "scim"));
      }
    }

    // Grant role to newly added users
    for (const userId of incomingIds) {
      if (!currentIds.has(userId)) {
        await resolve(svc.grantGlobalRole(userId, role, "scim"));
      }
    }

    const members = await getUsersForGlobalRole(svc, role);
    return reply.send(scimGroupResource(role, members, base));
  });

  // -------------------------------------------------------------------------
  // PATCH /scim/v2/Groups/:id — Modify group membership (add / remove)
  //
  // Supports RFC 7644 PatchOp on members:
  //   { op: "add",    path: "members", value: [{ value: "<userId>" }] }
  //   { op: "remove", path: "members", value: [{ value: "<userId>" }] }
  //   { op: "replace", path: "members", value: [{ value: "<userId>" }] }
  // -------------------------------------------------------------------------
  app.patch("/scim/v2/Groups/:id", {
    schema: {
      tags: ["scim"],
      operationId: "scimPatchGroup",
      summary: "SCIM 2.0 — Modify group membership via RFC 7644 PatchOp (add/remove/replace members)",
      security: [{ ScimTokenAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          schemas: { type: "array", items: { type: "string" } },
          Operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                op: { type: "string", description: "add | remove | replace" },
                path: { type: "string" },
                value: {},
              },
            },
          },
        },
      },
      response: {
        200: { type: "object" },
        400: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        401: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            schemas: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkScimAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const role = parseGroupDisplayName(id);
    if (!role) {
      return reply.status(404).send(scimError(404, "group not found"));
    }

    const body = request.body as {
      schemas?: string[];
      Operations?: Array<{
        op?: string;
        path?: string;
        value?: any;
      }>;
    } | null;

    const svc = getRoleService();
    const base = baseUrlFromRequest(request);

    if (body?.Operations) {
      for (const operation of body.Operations) {
        // Normalize op: RFC 7644 allows case-insensitive op names
        const op = operation.op?.toLowerCase();
        const path = operation.path?.toLowerCase();

        // Only operations targeting "members" are supported
        if (path !== "members" && path !== undefined) {
          // Silently skip unknown paths (permissive IdP compatibility)
          continue;
        }

        const memberEntries: Array<{ value?: string }> = Array.isArray(operation.value)
          ? operation.value
          : [];

        const userIds = memberEntries
          .map((m) => m?.value)
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

        if (op === "add") {
          for (const userId of userIds) {
            const user = await resolve(svc.getUserById(userId));
            if (!user) {
              return reply
                .status(400)
                .send(scimError(400, `member value "${userId}" does not reference a known user`));
            }
            await resolve(svc.grantGlobalRole(userId, role, "scim"));
          }
        } else if (op === "remove") {
          for (const userId of userIds) {
            await resolve(svc.revokeGlobalRole(userId, "scim"));
          }
        } else if (op === "replace") {
          // replace on members path = full replacement (same semantics as PUT)
          const incomingIds = new Set(userIds);

          // Validate all incoming members exist
          for (const userId of incomingIds) {
            const user = await resolve(svc.getUserById(userId));
            if (!user) {
              return reply
                .status(400)
                .send(scimError(400, `member value "${userId}" does not reference a known user`));
            }
          }

          const currentMembers = await getUsersForGlobalRole(svc, role);
          const currentIds = new Set(currentMembers.map((m) => m.userId));

          for (const userId of currentIds) {
            if (!incomingIds.has(userId)) {
              await resolve(svc.revokeGlobalRole(userId, "scim"));
            }
          }
          for (const userId of incomingIds) {
            if (!currentIds.has(userId)) {
              await resolve(svc.grantGlobalRole(userId, role, "scim"));
            }
          }
        }
        // Unknown op values are silently ignored (permissive IdP compatibility)
      }
    }

    const members = await getUsersForGlobalRole(svc, role);
    return reply.send(scimGroupResource(role, members, base));
  });
}
