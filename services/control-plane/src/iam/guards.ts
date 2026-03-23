// ---------------------------------------------------------------------------
// Phase 8 Slices 6-7: Route-Level Entitlement Guards
// SERGIO-103 (read enforcement) + SERGIO-104 (write enforcement)
// ---------------------------------------------------------------------------

import type { FastifyReply, FastifyRequest } from "fastify";
import type { IamFeatureFlags } from "./feature-flags.js";
import { isEnforcementActive } from "./feature-flags.js";
import { hasPermission, resolveActionPermission } from "./permissions.js";
import type { Permission, RequestContext, Role } from "./types.js";

// ---------------------------------------------------------------------------
// Guard result
// ---------------------------------------------------------------------------

export interface GuardResult {
  allowed: boolean;
  permission: Permission | null;
  reason: string;
  shadow: boolean;
}

// ---------------------------------------------------------------------------
// Core permission check
// ---------------------------------------------------------------------------

/**
 * Checks whether the given roles satisfy the required permission.
 * Returns a GuardResult indicating allow/deny + whether in shadow mode.
 */
export function checkPermission(
  roles: readonly Role[],
  permission: Permission,
  flags: IamFeatureFlags,
  tenantId: string
): GuardResult {
  const active = isEnforcementActive(flags, tenantId);
  const shadow = !active || flags.shadowMode;
  const allowed = hasPermission(roles, permission);

  return {
    allowed: shadow ? true : allowed,
    permission,
    reason: allowed ? "role_granted" : `missing_permission:${permission}`,
    shadow,
  };
}

// ---------------------------------------------------------------------------
// Route-level guard (Fastify preHandler)
// ---------------------------------------------------------------------------

export interface RouteGuardOptions {
  /** Required permission for this route. */
  permission: Permission;
  /** Feature flags (resolved once at app startup or per-request). */
  flags: IamFeatureFlags;
  /** Callback for authz decision logging (shadow mode). */
  onDecision?: (result: GuardResult, request: FastifyRequest) => void;
}

/**
 * Creates a Fastify preHandler that enforces a specific permission.
 *
 * Usage:
 * ```ts
 * app.get("/assets", {
 *   preHandler: [createRouteGuard({ permission: PERMISSIONS.BROWSE_ASSETS, flags })],
 * }, handler);
 * ```
 */
export function createRouteGuard(options: RouteGuardOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ctx = (request as any).iamContext as RequestContext | undefined;

    if (!ctx) {
      // Fail-closed: no auth context means request was not authenticated
      reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "missing authentication context",
        requestId: request.id,
        details: null,
      });
      return;
    }

    const result = checkPermission(
      ctx.roles,
      options.permission,
      options.flags,
      ctx.scope.tenantId
    );

    if (options.onDecision) {
      options.onDecision(result, request);
    }

    if (!result.allowed) {
      reply.status(403).send({
        code: "FORBIDDEN",
        message: `insufficient permissions: ${options.permission}`,
        requestId: request.id,
        details: {
          permission: options.permission,
          roles: ctx.roles,
          tenantId: ctx.scope.tenantId,
          projectId: ctx.scope.projectId,
        },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Dynamic route guard (resolves permission from method+path)
// ---------------------------------------------------------------------------

export interface DynamicGuardOptions {
  flags: IamFeatureFlags;
  onDecision?: (result: GuardResult, request: FastifyRequest) => void;
}

/**
 * Creates a Fastify onRequest hook that dynamically resolves the required
 * permission from the request method+path and evaluates it.
 *
 * - Unmapped routes (health, docs) are allowed.
 * - Shadow mode logs decisions without blocking.
 * - Enforcement mode blocks unauthorized requests.
 */
export function createDynamicGuard(options: DynamicGuardOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!options.flags.iamEnabled) return;

    const ctx = (request as any).iamContext as RequestContext | undefined;
    if (!ctx) {
      // Fail-closed: no auth context means request was not authenticated
      reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "missing authentication context",
        requestId: request.id,
        details: null,
      });
      return;
    }

    const mapping = resolveActionPermission(request.method, request.url.split("?")[0]);
    if (!mapping) return; // Unmapped route — allow

    // Determine enforcement category
    const isRead = mapping.category === "browse" || mapping.category === "audit";
    const isWrite = !isRead;

    // Check if enforcement is enabled for this category
    const enforceRead = options.flags.enforceReadScope;
    const enforceWrite = options.flags.enforceWriteScope;

    if (isRead && !enforceRead && !options.flags.shadowMode) return;
    if (isWrite && !enforceWrite && !options.flags.shadowMode) return;

    const result = checkPermission(
      ctx.roles,
      mapping.permission,
      options.flags,
      ctx.scope.tenantId
    );

    // Override shadow for specific enforcement categories
    if (isRead && enforceRead && !options.flags.shadowMode) {
      result.shadow = false;
      result.allowed = hasPermission(ctx.roles, mapping.permission);
    }
    if (isWrite && enforceWrite && !options.flags.shadowMode) {
      result.shadow = false;
      result.allowed = hasPermission(ctx.roles, mapping.permission);
    }

    if (options.onDecision) {
      options.onDecision(result, request);
    }

    if (!result.allowed) {
      reply.status(403).send({
        code: "FORBIDDEN",
        message: `insufficient permissions: ${mapping.permission}`,
        requestId: request.id,
        details: {
          permission: mapping.permission,
          category: mapping.category,
          roles: ctx.roles,
          tenantId: ctx.scope.tenantId,
          projectId: ctx.scope.projectId,
          correlationId: reply.getHeader("x-correlation-id"),
        },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Separation of duties check (Slice 8: SERGIO-105)
// ---------------------------------------------------------------------------

/**
 * Checks whether an actor can perform an approval action given that they are
 * not the same person who submitted the item (separation of duties).
 */
export function checkSeparationOfDuties(
  actorId: string,
  submitterId: string,
  flags: IamFeatureFlags
): { allowed: boolean; reason: string } {
  if (!flags.enforceApprovalSod) {
    return { allowed: true, reason: "sod_not_enforced" };
  }
  if (actorId === submitterId) {
    return { allowed: false, reason: "separation_of_duties_violation" };
  }
  return { allowed: true, reason: "different_actors" };
}

/**
 * Checks dual-control requirement: a destructive action needs confirmation
 * from a second authorized user.
 */
export function checkDualControl(
  requesterId: string,
  confirmerId: string | null,
  flags: IamFeatureFlags
): { allowed: boolean; reason: string } {
  if (!flags.enforceApprovalSod) {
    return { allowed: true, reason: "dual_control_not_enforced" };
  }
  if (!confirmerId) {
    return { allowed: false, reason: "dual_control_requires_confirmer" };
  }
  if (requesterId === confirmerId) {
    return { allowed: false, reason: "dual_control_same_actor" };
  }
  return { allowed: true, reason: "dual_control_satisfied" };
}
