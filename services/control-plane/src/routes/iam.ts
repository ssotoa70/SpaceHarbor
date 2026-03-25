// ---------------------------------------------------------------------------
// Phase 2.1: User & Role Management API
// Phase 2.3: Local User Authentication Endpoints
// ---------------------------------------------------------------------------

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import type { RoleBindingService } from "../iam/role-binding.js";
import type { PersistentRoleBindingService } from "../iam/persistent-role-binding.js";
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  LoginThrottler,
} from "../iam/local-auth.js";
import { hashApiKey, calculateApiKeyExpiration, verifyApiKey, isApiKeyExpired } from "../iam/api-key-hashing.js";
import { getEffectivePermissions, getEffectivePermissionsForRoles } from "../iam/permissions.js";
import {
  type RequestContext,
  type Role,
  type ProjectRole,
  type GlobalRole,
  type UserStatus,
  PROJECT_ROLES,
  GLOBAL_ROLES,
  ROLE_PRIVILEGE_LEVEL,
  PERMISSIONS,
} from "../iam/types.js";
import { generateCsrfToken, storeCsrfToken, removeCsrfToken } from "../iam/csrf.js";
import { createTokenFingerprint, bindToken } from "../iam/token-binding.js";

type RoleService = RoleBindingService | PersistentRoleBindingService;

// Resolve result from sync or async role binding service
async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

// Helper: extract IAM context from request
function getIamContext(request: any): RequestContext | null {
  return (request as any).iamContext ?? null;
}

// Helper: check if caller has at least a given privilege level
function callerHasAtLeast(ctx: RequestContext, requiredRole: Role): boolean {
  const requiredLevel = ROLE_PRIVILEGE_LEVEL[requiredRole];
  return ctx.roles.some((r) => ROLE_PRIVILEGE_LEVEL[r] >= requiredLevel);
}

// Helper: check if a role name is a valid project role
function isProjectRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

// Helper: check if a role name is a valid global role
function isGlobalRole(role: string): role is GlobalRole {
  return (GLOBAL_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Local auth state (in-memory, co-located with routes for simplicity)
// ---------------------------------------------------------------------------

// Password hashes stored alongside users: userId → passwordHash
const passwordStore = new Map<string, { hash: string; mustChangePassword: boolean; authMethod: string }>();

// Refresh tokens: tokenHash → { userId, expiresAt, revokedAt }
const refreshTokenStore = new Map<string, { userId: string; expiresAt: number; revokedAt: number | null }>();

// API key store: keyId → { hash, salt, ownerId, label, expiresAt, createdAt, lastUsedAt, revokedAt }
interface StoredApiKey {
  id: string;
  hash: string;
  salt: string;
  ownerId: string;
  label: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
const apiKeyStore = new Map<string, StoredApiKey>();

// Login throttler
const loginThrottler = new LoginThrottler();

// Account lockout counter: email → consecutive failures
const lockoutCounter = new Map<string, number>();
const LOCKOUT_THRESHOLD = 10;

// Bootstrap state
let bootstrapComplete = false;

// ---------------------------------------------------------------------------
// Phase 3.2: Session revocation & concurrent session tracking
// ---------------------------------------------------------------------------

// Revoked session/token IDs
const revokedSessions = new Set<string>();

/** Check if a session/token ID has been revoked. */
function isSessionRevoked(tokenId: string): boolean {
  return revokedSessions.has(tokenId);
}

// Active sessions per user: userId -> sessionId[]
const activeSessions = new Map<string, string[]>();
const MAX_SESSIONS_PER_USER = 5;

// ---------------------------------------------------------------------------
// JWT token generation (HS256 using built-in crypto)
// ---------------------------------------------------------------------------

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function createHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number = 3600,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  const signature = hmac.digest("base64url");

  return `${data}.${signature}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerIamRoutes(
  app: FastifyInstance,
  getRoleService: () => RoleService,
  prefixes: string[] = ["", "/api/v1"],
): void {
  for (const prefix of prefixes) {
    // -----------------------------------------------------------------------
    // GET /auth/me — Current user context
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/auth/me"), {
      schema: {
        tags: ["iam"],
        operationId: "getAuthMe",
        summary: "Return the authenticated caller's identity and permissions",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              userId: { type: "string" },
              email: { type: "string" },
              displayName: { type: "string" },
              authStrategy: { type: "string" },
              roles: { type: "array", items: { type: "string" } },
              permissions: { type: "array", items: { type: "string" } },
              scope: { type: "string", nullable: true },
              externalId: { type: "string", nullable: true },
              groups: { type: "array", items: { type: "string" } },
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      return reply.send({
        userId: ctx.userId,
        email: ctx.email,
        displayName: ctx.displayName,
        authStrategy: ctx.authStrategy,
        roles: ctx.roles,
        permissions: [...ctx.permissions],
        scope: ctx.scope,
        externalId: ctx.externalId,
        groups: ctx.groups,
      });
    });

    // -----------------------------------------------------------------------
    // POST /users — Create user (administrator only)
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/users"), {
      schema: {
        tags: ["iam"],
        operationId: "createUser",
        summary: "Create a new user — administrator only",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["email", "displayName"],
          properties: {
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
            password: { type: "string" },
            role: { type: "string" },
            projectId: { type: "string" },
            tenantId: { type: "string" },
          },
        },
        response: {
          201: { type: "object" },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          409: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as {
        email?: string;
        displayName?: string;
        password?: string;
        role?: string;
        projectId?: string;
        tenantId?: string;
      } | null;

      if (!body?.email || !body.displayName) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "email and displayName are required",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();

      // Check for duplicate email
      const existing = await resolve(svc.getUserByEmail(body.email));
      if (existing) {
        return reply.status(409).send({
          code: "CONFLICT",
          message: "user with this email already exists",
          requestId: request.id,
          details: null,
        });
      }

      const user = await resolve(svc.createUser({
        email: body.email,
        displayName: body.displayName,
      }));

      // If password provided, store it (local auth)
      if (body.password) {
        const validation = validatePasswordPolicy(body.password);
        if (!validation.valid) {
          return reply.status(400).send({
            code: "BAD_REQUEST",
            message: validation.errors.join("; "),
            requestId: request.id,
            details: null,
          });
        }
        const hash = await hashPassword(body.password);
        passwordStore.set(user.id, { hash, mustChangePassword: true, authMethod: "local" });
      }

      // If role + project specified, grant project membership
      if (body.role && body.projectId && isProjectRole(body.role)) {
        // Privilege escalation check
        const callerMaxLevel = Math.max(...ctx.roles.map((r) => ROLE_PRIVILEGE_LEVEL[r]));
        const targetLevel = ROLE_PRIVILEGE_LEVEL[body.role as Role];
        if (targetLevel >= callerMaxLevel && !callerHasAtLeast(ctx, "super_admin")) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "cannot assign role at or above your own privilege level",
            requestId: request.id,
            details: null,
          });
        }

        await resolve(svc.grantProjectRole({
          userId: user.id,
          projectId: body.projectId,
          tenantId: body.tenantId ?? "default",
          role: body.role as ProjectRole,
          grantedBy: ctx.userId,
        }));
      }

      return reply.status(201).send(user);
    });

    // -----------------------------------------------------------------------
    // GET /users — List users (administrator only)
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/users"), {
      schema: {
        tags: ["iam"],
        operationId: "listUsers",
        summary: "List all users — administrator only",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              users: { type: "array", items: { type: "object" } },
              total: { type: "number" },
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const users = await resolve(svc.listUsers());
      return reply.send({ users, total: users.length });
    });

    // -----------------------------------------------------------------------
    // GET /users/:id — Get user by ID (administrator or self)
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/users/:id"), {
      schema: {
        tags: ["iam"],
        operationId: "getUserById",
        summary: "Get user by ID — administrator or self",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object" },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      const { id } = request.params as { id: string };

      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      // Allow self-lookup or administrator
      if (ctx.userId !== id && !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const user = await resolve(svc.getUserById(id));
      if (!user) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "user not found",
          requestId: request.id,
          details: null,
        });
      }

      return reply.send(user);
    });

    // -----------------------------------------------------------------------
    // PUT /users/:id/status — Enable/disable user (administrator only)
    // -----------------------------------------------------------------------
    app.put(withPrefix(prefix, "/users/:id/status"), {
      schema: {
        tags: ["iam"],
        operationId: "updateUserStatus",
        summary: "Enable, disable, or lock a user account — administrator only",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "disabled", "locked"] },
          },
        },
        response: {
          200: { type: "object" },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const { id } = request.params as { id: string };
      const body = request.body as { status?: string } | null;

      if (!body?.status || !["active", "disabled", "locked"].includes(body.status)) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "status must be 'active', 'disabled', or 'locked'",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const updated = await resolve(svc.updateUserStatus(id, body.status as UserStatus));
      if (!updated) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "user not found",
          requestId: request.id,
          details: null,
        });
      }

      // Reset lockout counter if unlocking
      if (body.status === "active") {
        const user = await resolve(svc.getUserById(id));
        if (user) lockoutCounter.delete(user.email);
      }

      return reply.send(updated);
    });

    // -----------------------------------------------------------------------
    // PUT /users/:id/roles — Set global role for user (administrator only)
    // -----------------------------------------------------------------------
    app.put(withPrefix(prefix, "/users/:id/roles"), {
      schema: {
        tags: ["iam"],
        operationId: "updateUserRoles",
        summary: "Set global role for a user — administrator only",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["roles"],
          properties: {
            roles: {
              type: "array",
              items: { type: "string" },
              description: "Array of role names to assign. Send empty array to revoke all global roles.",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              userId: { type: "string" },
              roles: { type: "array", items: { type: "string" } },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          403: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const { id } = request.params as { id: string };
      const body = request.body as { roles?: string[] } | null;

      if (!body || !Array.isArray(body.roles)) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "roles array is required",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const user = await resolve(svc.getUserById(id));
      if (!user) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "user not found",
          requestId: request.id,
          details: null,
        });
      }

      if (body.roles.length === 0) {
        await resolve(svc.revokeGlobalRole(id, ctx.userId));
      } else {
        const role = body.roles[0];
        if (!isGlobalRole(role)) {
          return reply.status(400).send({
            code: "BAD_REQUEST",
            message: `invalid global role: ${role}`,
            requestId: request.id,
            details: null,
          });
        }
        await resolve(svc.grantGlobalRole(id, role, ctx.userId));
      }

      return reply.send({ userId: id, roles: body.roles });
    });

    // -----------------------------------------------------------------------
    // POST /projects/:projectId/members — Grant project role
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/projects/:projectId/members"), {
      schema: {
        tags: ["iam"],
        operationId: "addProjectMember",
        summary: "Add a user to a project with a specific role",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["userId", "role"],
          properties: {
            userId: { type: "string" },
            role: { type: "string", enum: ["viewer", "artist", "lead", "production", "supervisor"] },
            tenantId: { type: "string" },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "production")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "production role or higher required",
          requestId: request.id,
          details: null,
        });
      }

      const { projectId } = request.params as { projectId: string };
      const body = request.body as { userId?: string; role?: string; tenantId?: string } | null;

      if (!body?.userId || !body.role || !isProjectRole(body.role)) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "userId and valid role are required",
          requestId: request.id,
          details: null,
        });
      }

      // Privilege escalation check
      const callerMaxLevel = Math.max(...ctx.roles.map((r) => ROLE_PRIVILEGE_LEVEL[r]));
      const targetLevel = ROLE_PRIVILEGE_LEVEL[body.role as Role];
      if (targetLevel >= callerMaxLevel && !callerHasAtLeast(ctx, "super_admin")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "cannot assign role at or above your own privilege level",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const membership = await resolve(svc.grantProjectRole({
        userId: body.userId,
        projectId,
        tenantId: body.tenantId ?? "default",
        role: body.role as ProjectRole,
        grantedBy: ctx.userId,
      }));

      return reply.status(201).send(membership);
    });

    // -----------------------------------------------------------------------
    // GET /projects/:projectId/members — List project members
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/projects/:projectId/members"), {
      schema: {
        tags: ["iam"],
        operationId: "listProjectMembers",
        summary: "List all members of a project",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              members: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "number" },
            },
          },
          401: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      const { projectId } = request.params as { projectId: string };
      const svc = getRoleService();
      const members = await resolve(svc.listProjectMembers(projectId));
      return reply.send({ members, total: members.length });
    });

    // -----------------------------------------------------------------------
    // DELETE /projects/:projectId/members/:userId — Revoke membership
    // -----------------------------------------------------------------------
    app.delete(withPrefix(prefix, "/projects/:projectId/members/:userId"), {
      schema: {
        tags: ["iam"],
        operationId: "revokeProjectMember",
        summary: "Remove a user from a project",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["projectId", "userId"],
          properties: { projectId: { type: "string" }, userId: { type: "string" } },
        },
        response: {
          204: { type: "null", description: "Membership revoked" },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          404: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "production")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "production role or higher required",
          requestId: request.id,
          details: null,
        });
      }

      const { projectId, userId } = request.params as { projectId: string; userId: string };
      const svc = getRoleService();
      const revoked = await resolve(svc.revokeProjectRole(userId, projectId, ctx.userId));

      if (!revoked) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "membership not found",
          requestId: request.id,
          details: null,
        });
      }

      return reply.status(204).send();
    });

    // -----------------------------------------------------------------------
    // PUT /projects/:projectId/members/:userId/role — Change member role
    // -----------------------------------------------------------------------
    app.put(withPrefix(prefix, "/projects/:projectId/members/:userId/role"), {
      schema: {
        tags: ["iam"],
        operationId: "changeProjectMemberRole",
        summary: "Change the role of an existing project member",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["projectId", "userId"],
          properties: { projectId: { type: "string" }, userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["role"],
          properties: {
            role: { type: "string", enum: ["viewer", "artist", "lead", "production", "supervisor"] },
            tenantId: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "production")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "production role or higher required",
          requestId: request.id,
          details: null,
        });
      }

      const { projectId, userId } = request.params as { projectId: string; userId: string };
      const body = request.body as { role?: string; tenantId?: string } | null;

      if (!body?.role || !isProjectRole(body.role)) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "valid role is required",
          requestId: request.id,
          details: null,
        });
      }

      // Privilege escalation check
      const callerMaxLevel = Math.max(...ctx.roles.map((r) => ROLE_PRIVILEGE_LEVEL[r]));
      const targetLevel = ROLE_PRIVILEGE_LEVEL[body.role as Role];
      if (targetLevel >= callerMaxLevel && !callerHasAtLeast(ctx, "super_admin")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "cannot assign role at or above your own privilege level",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const membership = await resolve(svc.grantProjectRole({
        userId,
        projectId,
        tenantId: body.tenantId ?? "default",
        role: body.role as ProjectRole,
        grantedBy: ctx.userId,
      }));

      return reply.send(membership);
    });

    // -----------------------------------------------------------------------
    // POST /api-keys — Create API key
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/api-keys"), {
      schema: {
        tags: ["iam"],
        operationId: "createApiKey",
        summary: "Generate a new API key for the authenticated user",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            label: { type: "string", description: "Human-readable label for this key" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              key: { type: "string", description: "Plaintext key — shown once only" },
              label: { type: "string" },
              expiresAt: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { label?: string } | null;
      const label = body?.label ?? "default";

      // Generate a random API key
      const plaintext = `ahk_${randomBytes(32).toString("hex")}`;
      const { hash, salt } = await hashApiKey(plaintext);
      const expiresAt = calculateApiKeyExpiration();
      const keyId = randomUUID();

      apiKeyStore.set(keyId, {
        id: keyId,
        hash,
        salt,
        ownerId: ctx.userId,
        label,
        expiresAt,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      });

      // Return plaintext only once
      return reply.status(201).send({
        id: keyId,
        key: plaintext,
        label,
        expiresAt,
        createdAt: new Date().toISOString(),
      });
    });

    // -----------------------------------------------------------------------
    // GET /api-keys — List own API keys (masked)
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/api-keys"), {
      schema: {
        tags: ["iam"],
        operationId: "listApiKeys",
        summary: "List the authenticated user's active API keys (key values masked)",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              keys: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    expiresAt: { type: "string" },
                    createdAt: { type: "string" },
                    lastUsedAt: { type: "string", nullable: true },
                    expired: { type: "boolean" },
                  },
                },
              },
              total: { type: "number" },
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      const keys = [...apiKeyStore.values()]
        .filter((k) => k.ownerId === ctx.userId && !k.revokedAt)
        .map((k) => ({
          id: k.id,
          label: k.label,
          expiresAt: k.expiresAt,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          expired: isApiKeyExpired(k.expiresAt),
        }));

      return reply.send({ keys, total: keys.length });
    });

    // -----------------------------------------------------------------------
    // DELETE /api-keys/:id — Revoke API key
    // -----------------------------------------------------------------------
    app.delete(withPrefix(prefix, "/api-keys/:id"), {
      schema: {
        tags: ["iam"],
        operationId: "revokeApiKey",
        summary: "Revoke an API key owned by the authenticated user",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          204: { type: "null" },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      const { id } = request.params as { id: string };
      const key = apiKeyStore.get(id);

      if (!key || key.ownerId !== ctx.userId) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "API key not found",
          requestId: request.id,
          details: null,
        });
      }

      key.revokedAt = new Date().toISOString();
      return reply.status(204).send();
    });

    // -----------------------------------------------------------------------
    // POST /auth/bootstrap — First-run super_admin creation
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/bootstrap"), {
      schema: {
        tags: ["iam"],
        operationId: "authBootstrap",
        summary: "Create the initial super_admin user (one-time, fails if users exist)",
        security: [],
        body: {
          type: "object",
          required: ["email", "displayName", "password"],
          properties: {
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
            password: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              user: { type: "object", additionalProperties: true },
              role: { type: "string" },
              message: { type: "string" },
            },
          },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          410: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      if (bootstrapComplete) {
        return reply.status(410).send({
          code: "GONE",
          message: "bootstrap already completed",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const existingUsers = await resolve(svc.listUsers());
      if (existingUsers.length > 0) {
        bootstrapComplete = true;
        return reply.status(410).send({
          code: "GONE",
          message: "bootstrap already completed — users exist",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { email?: string; displayName?: string; password?: string } | null;
      if (!body?.email || !body.displayName || !body.password) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "email, displayName, and password are required",
          requestId: request.id,
          details: null,
        });
      }

      const validation = validatePasswordPolicy(body.password);
      if (!validation.valid) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: validation.errors.join("; "),
          requestId: request.id,
          details: null,
        });
      }

      const user = await resolve(svc.createUser({
        email: body.email,
        displayName: body.displayName,
      }));

      // Store password
      const hash = await hashPassword(body.password);
      passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });

      // Grant super_admin global role
      await resolve(svc.grantGlobalRole(user.id, "super_admin", "bootstrap"));
      bootstrapComplete = true;

      return reply.status(201).send({
        user,
        role: "super_admin",
        message: "super_admin created successfully",
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/login — Local authentication
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/login"), {
      schema: {
        tags: ["iam"],
        operationId: "authLogin",
        summary: "Authenticate with email and password — returns JWT access and refresh tokens",
        security: [],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "number" },
              csrfToken: { type: "string" },
              mustChangePassword: { type: "boolean" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  displayName: { type: "string" },
                  roles: { type: "array", items: { type: "string" } },
                  permissions: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          429: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          500: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const body = request.body as { email?: string; password?: string } | null;
      if (!body?.email || !body.password) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "email and password are required",
          requestId: request.id,
          details: null,
        });
      }

      // Check login throttling
      if (!loginThrottler.isAllowed(body.email)) {
        return reply.status(429).send({
          code: "RATE_LIMITED",
          message: "too many failed login attempts — try again later",
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const user = await resolve(svc.getUserByEmail(body.email));

      // Constant-time: always hash even if user not found (prevent timing leak)
      if (!user) {
        await hashPassword("dummy-constant-time-pad");
        loginThrottler.recordFailure(body.email);
        console.error(`[login] FAIL user-not-found email=${body.email}`);
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      // Check account status
      if (user.status === "locked") {
        console.error(`[login] FAIL account-locked email=${body.email}`);
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      if (user.status !== "active") {
        console.error(`[login] FAIL account-status=${user.status} email=${body.email}`);
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      // Check password
      const creds = passwordStore.get(user.id);
      if (!creds || creds.authMethod !== "local") {
        await hashPassword("dummy-constant-time-pad");
        loginThrottler.recordFailure(body.email);
        console.error(`[login] FAIL no-creds email=${body.email}`);
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      const passwordValid = await verifyPassword(body.password, creds.hash);
      if (!passwordValid) {
        const attempts = loginThrottler.recordFailure(body.email);

        // Account lockout after LOCKOUT_THRESHOLD consecutive failures
        const count = (lockoutCounter.get(body.email) ?? 0) + 1;
        lockoutCounter.set(body.email, count);

        // Check if this is a super_admin — they can never be locked
        const globalRole = await resolve(svc.getGlobalRole(user.id));
        const isSuperAdmin = globalRole?.role === "super_admin";

        if (count >= LOCKOUT_THRESHOLD && !isSuperAdmin) {
          await resolve(svc.updateUserStatus(user.id, "locked"));
        }

        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      // Success — reset throttle and lockout counters
      loginThrottler.reset(body.email);
      lockoutCounter.delete(body.email);

      // Get roles for JWT
      const roles = await resolve(svc.getEffectiveRoles(user.id, null));
      const permissions = getEffectivePermissionsForRoles(roles);

      // Generate JWT — fail-closed if secret is not configured
      const jwtSecret = process.env.SPACEHARBOR_JWT_SECRET?.trim();
      if (!jwtSecret) {
        return reply.status(500).send({
          code: "INTERNAL_ERROR",
          message: "JWT secret is not configured — cannot issue tokens",
          requestId: request.id,
          details: null,
        });
      }
      const accessToken = createHs256Jwt(
        {
          sub: user.id,
          email: user.email,
          display_name: user.displayName,
          roles,
          mcp: creds.mustChangePassword ? true : undefined,
        },
        jwtSecret,
        3600,
      );

      // Generate refresh token
      const refreshToken = randomBytes(32).toString("hex");
      const refreshHash = randomBytes(16).toString("hex"); // Simple hash for lookup
      refreshTokenStore.set(refreshHash, {
        userId: user.id,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        revokedAt: null,
      });

      // Phase 3.2: Concurrent session limit — enforce max sessions per user
      const userSessions = activeSessions.get(user.id) ?? [];
      userSessions.push(refreshHash);
      if (userSessions.length > MAX_SESSIONS_PER_USER) {
        // Revoke the oldest session
        const oldest = userSessions.shift()!;
        revokedSessions.add(oldest);
        const oldEntry = refreshTokenStore.get(oldest);
        if (oldEntry) oldEntry.revokedAt = Date.now();
        removeCsrfToken(oldest);
      }
      activeSessions.set(user.id, userSessions);

      // Phase 3.2: Generate CSRF token for this session
      const csrfToken = generateCsrfToken();
      storeCsrfToken(refreshHash, csrfToken);

      // Phase 3.2: Token binding — bind to client fingerprint
      const userAgent = (request.headers["user-agent"] as string) ?? "";
      const clientIp = request.ip ?? "127.0.0.1";
      const fingerprint = createTokenFingerprint(userAgent, clientIp);
      bindToken(refreshHash, fingerprint);

      return reply.send({
        accessToken,
        refreshToken: refreshHash,
        expiresIn: 3600,
        csrfToken,
        mustChangePassword: creds.mustChangePassword,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roles,
          permissions: [...permissions],
        },
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/refresh — Token refresh
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/refresh"), {
      schema: {
        tags: ["iam"],
        operationId: "authRefresh",
        summary: "Exchange a refresh token for a new access token (rotation)",
        security: [],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "number" },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          500: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const body = request.body as { refreshToken?: string } | null;
      if (!body?.refreshToken) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "refreshToken is required",
          requestId: request.id,
          details: null,
        });
      }

      const entry = refreshTokenStore.get(body.refreshToken);
      if (!entry || entry.revokedAt || entry.expiresAt < Date.now()) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "invalid or expired refresh token",
          requestId: request.id,
          details: null,
        });
      }

      // Rotate: revoke old token
      entry.revokedAt = Date.now();

      const svc = getRoleService();
      const user = await resolve(svc.getUserById(entry.userId));
      if (!user || user.status !== "active") {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      const roles = await resolve(svc.getEffectiveRoles(user.id, null));
      const creds = passwordStore.get(user.id);

      // Fail-closed: refuse to issue tokens without a configured secret
      const jwtSecret = process.env.SPACEHARBOR_JWT_SECRET?.trim();
      if (!jwtSecret) {
        return reply.status(500).send({
          code: "INTERNAL_ERROR",
          message: "JWT secret is not configured — cannot issue tokens",
          requestId: request.id,
          details: null,
        });
      }
      const accessToken = createHs256Jwt(
        {
          sub: user.id,
          email: user.email,
          display_name: user.displayName,
          roles,
          mcp: creds?.mustChangePassword ? true : undefined,
        },
        jwtSecret,
        3600,
      );

      // New refresh token
      const newRefreshToken = randomBytes(16).toString("hex");
      refreshTokenStore.set(newRefreshToken, {
        userId: user.id,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        revokedAt: null,
      });

      return reply.send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600,
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/revoke — Session revocation (Phase 3.2)
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/revoke"), {
      schema: {
        tags: ["iam"],
        operationId: "authRevoke",
        summary: "Revoke a refresh token (logout / session invalidation)",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      const body = request.body as { refreshToken?: string } | null;
      if (!body?.refreshToken) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "refreshToken is required",
          requestId: request.id,
          details: null,
        });
      }

      const entry = refreshTokenStore.get(body.refreshToken);
      if (!entry) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "session not found",
          requestId: request.id,
          details: null,
        });
      }

      // Revoke the session
      entry.revokedAt = Date.now();
      revokedSessions.add(body.refreshToken);
      removeCsrfToken(body.refreshToken);

      // Remove from active sessions
      const userSessions = activeSessions.get(entry.userId);
      if (userSessions) {
        const idx = userSessions.indexOf(body.refreshToken);
        if (idx !== -1) userSessions.splice(idx, 1);
        if (userSessions.length === 0) activeSessions.delete(entry.userId);
      }

      return reply.send({ message: "session revoked" });
    });

    // -----------------------------------------------------------------------
    // PUT /auth/password — Change own password
    // -----------------------------------------------------------------------
    app.put(withPrefix(prefix, "/auth/password"), {
      schema: {
        tags: ["iam"],
        operationId: "changePassword",
        summary: "Change the authenticated user's password",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" } } },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          401: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { currentPassword?: string; newPassword?: string } | null;
      if (!body?.currentPassword || !body.newPassword) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "currentPassword and newPassword are required",
          requestId: request.id,
          details: null,
        });
      }

      const creds = passwordStore.get(ctx.userId);
      if (!creds || creds.authMethod !== "local") {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "password change not available for this auth method",
          requestId: request.id,
          details: null,
        });
      }

      const currentValid = await verifyPassword(body.currentPassword, creds.hash);
      if (!currentValid) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "current password is incorrect",
          requestId: request.id,
          details: null,
        });
      }

      const validation = validatePasswordPolicy(body.newPassword);
      if (!validation.valid) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: validation.errors.join("; "),
          requestId: request.id,
          details: null,
        });
      }

      const newHash = await hashPassword(body.newPassword);
      passwordStore.set(ctx.userId, {
        hash: newHash,
        mustChangePassword: false,
        authMethod: "local",
      });

      return reply.send({ message: "password changed successfully" });
    });

    // -----------------------------------------------------------------------
    // POST /auth/reset-password — Admin password reset
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/reset-password"), {
      schema: {
        tags: ["iam"],
        operationId: "adminResetPassword",
        summary: "Admin reset a user's password (requires administrator role)",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["userId", "temporaryPassword"],
          properties: {
            userId: { type: "string" },
            temporaryPassword: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" } } },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "administrator")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "administrator role required",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { userId?: string; temporaryPassword?: string } | null;
      if (!body?.userId || !body.temporaryPassword) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "userId and temporaryPassword are required",
          requestId: request.id,
          details: null,
        });
      }

      // Check privilege: admin can reset non-admin users; super_admin can reset anyone
      const svc = getRoleService();
      const targetGlobalRole = await resolve(svc.getGlobalRole(body.userId));
      if (targetGlobalRole) {
        const targetLevel = ROLE_PRIVILEGE_LEVEL[targetGlobalRole.role];
        const callerMaxLevel = Math.max(...ctx.roles.map((r) => ROLE_PRIVILEGE_LEVEL[r]));
        if (targetLevel >= callerMaxLevel && !callerHasAtLeast(ctx, "super_admin")) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "cannot reset password for user with equal or higher privilege",
            requestId: request.id,
            details: null,
          });
        }
      }

      const hash = await hashPassword(body.temporaryPassword);
      passwordStore.set(body.userId, {
        hash,
        mustChangePassword: true,
        authMethod: "local",
      });

      return reply.send({ message: "password reset successfully — user must change on next login" });
    });

    // -----------------------------------------------------------------------
    // GET /auth/token — Backend proxy for token refresh
    // -----------------------------------------------------------------------
    app.get(withPrefix(prefix, "/auth/token"), {
      schema: {
        tags: ["iam"],
        operationId: "getTokenViaRefresh",
        summary: "Get new access token using a refresh token (query param or x-refresh-token header)",
        security: [],
        querystring: {
          type: "object",
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["accessToken", "refreshToken", "expiresIn"],
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "number" },
            },
          },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          401: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      // In local mode, delegates to the refresh logic
      const refreshToken =
        (request.query as Record<string, string | undefined>)?.refreshToken ??
        (request.headers["x-refresh-token"] as string | undefined);

      if (!refreshToken) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "refreshToken is required (query param or x-refresh-token header)",
          requestId: request.id,
          details: null,
        });
      }

      const entry = refreshTokenStore.get(refreshToken);
      if (!entry || entry.revokedAt || entry.expiresAt < Date.now()) {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "invalid or expired refresh token",
          requestId: request.id,
          details: null,
        });
      }

      // Rotate: revoke old token
      entry.revokedAt = Date.now();

      const svc = getRoleService();
      const user = await resolve(svc.getUserById(entry.userId));
      if (!user || user.status !== "active") {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication failed",
          requestId: request.id,
          details: null,
        });
      }

      const roles = await resolve(svc.getEffectiveRoles(user.id, null));
      const creds = passwordStore.get(user.id);

      // Fail-closed: refuse to issue tokens without a configured secret
      const jwtSecret = process.env.SPACEHARBOR_JWT_SECRET?.trim();
      if (!jwtSecret) {
        return reply.status(500).send({
          code: "INTERNAL_ERROR",
          message: "JWT secret is not configured — cannot issue tokens",
          requestId: request.id,
          details: null,
        });
      }
      const accessToken = createHs256Jwt(
        {
          sub: user.id,
          email: user.email,
          display_name: user.displayName,
          roles,
          mcp: creds?.mustChangePassword ? true : undefined,
        },
        jwtSecret,
        3600,
      );

      // New refresh token
      const newRefreshToken = randomBytes(16).toString("hex");
      refreshTokenStore.set(newRefreshToken, {
        userId: user.id,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        revokedAt: null,
      });

      return reply.send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600,
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/register — Self-registration (when enabled)
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/register"), {
      schema: {
        tags: ["iam"],
        operationId: "authRegister",
        summary: "Self-registration (requires SPACEHARBOR_ALLOW_REGISTRATION=true)",
        security: [],
        body: {
          type: "object",
          required: ["email", "displayName", "password"],
          properties: {
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
            password: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              user: { type: "object", additionalProperties: true },
              message: { type: "string" },
            },
          },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          409: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const registrationEnabled = process.env.SPACEHARBOR_ALLOW_REGISTRATION === "true";
      if (!registrationEnabled) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "registration is disabled",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { email?: string; displayName?: string; password?: string } | null;
      if (!body?.email || !body.displayName || !body.password) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "email, displayName, and password are required",
          requestId: request.id,
          details: null,
        });
      }

      const validation = validatePasswordPolicy(body.password);
      if (!validation.valid) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: validation.errors.join("; "),
          requestId: request.id,
          details: null,
        });
      }

      const svc = getRoleService();
      const existing = await resolve(svc.getUserByEmail(body.email));
      if (existing) {
        return reply.status(409).send({
          code: "CONFLICT",
          message: "email already registered",
          requestId: request.id,
          details: null,
        });
      }

      const user = await resolve(svc.createUser({
        email: body.email,
        displayName: body.displayName,
      }));

      const hash = await hashPassword(body.password);
      passwordStore.set(user.id, { hash, mustChangePassword: false, authMethod: "local" });

      // Grant default viewer role on default project
      await resolve(svc.grantProjectRole({
        userId: user.id,
        projectId: process.env.SPACEHARBOR_DEFAULT_PROJECT ?? "default",
        tenantId: "default",
        role: "viewer",
        grantedBy: "self-registration",
      }));

      return reply.status(201).send({
        user,
        message: "registration successful",
      });
    });

    // -----------------------------------------------------------------------
    // POST /iam/transfer-super-admin — Transfer super_admin role
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/iam/transfer-super-admin"), {
      schema: {
        tags: ["admin"],
        operationId: "transferSuperAdmin",
        summary: "Transfer super_admin role to another user (requires super_admin + password confirmation)",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["targetUserId", "confirmPassword"],
          properties: {
            targetUserId: { type: "string" },
            confirmPassword: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" }, transferredTo: { type: "string" } } },
          400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          401: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          403: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
          404: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        },
      },
    }, async (request, reply) => {
      const ctx = getIamContext(request);
      if (!ctx || !callerHasAtLeast(ctx, "super_admin")) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "super_admin role required",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { targetUserId?: string; confirmPassword?: string } | null;
      if (!body?.targetUserId || !body.confirmPassword) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "targetUserId and confirmPassword are required",
          requestId: request.id,
          details: null,
        });
      }

      // Verify caller's password for safety
      const callerCreds = passwordStore.get(ctx.userId);
      if (callerCreds) {
        const valid = await verifyPassword(body.confirmPassword, callerCreds.hash);
        if (!valid) {
          return reply.status(401).send({
            code: "UNAUTHORIZED",
            message: "password verification failed",
            requestId: request.id,
            details: null,
          });
        }
      }

      const svc = getRoleService();
      const target = await resolve(svc.getUserById(body.targetUserId));
      if (!target) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "target user not found",
          requestId: request.id,
          details: null,
        });
      }

      // Transfer: grant super_admin to target, demote caller to administrator
      await resolve(svc.grantGlobalRole(body.targetUserId, "super_admin", ctx.userId));
      await resolve(svc.grantGlobalRole(ctx.userId, "administrator", ctx.userId));

      return reply.send({
        message: "super_admin transferred successfully",
        newSuperAdmin: body.targetUserId,
        previousSuperAdmin: ctx.userId,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  passwordStore,
  refreshTokenStore,
  apiKeyStore,
  loginThrottler,
  lockoutCounter,
  revokedSessions,
  activeSessions,
  isSessionRevoked,
  MAX_SESSIONS_PER_USER,
};

export function isBootstrapComplete(): boolean {
  return bootstrapComplete;
}

/** Reset all in-memory state (for tests). */
export function resetIamRouteState(): void {
  passwordStore.clear();
  refreshTokenStore.clear();
  apiKeyStore.clear();
  lockoutCounter.clear();
  revokedSessions.clear();
  activeSessions.clear();
  bootstrapComplete = false;
}
