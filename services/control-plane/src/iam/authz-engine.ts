// ---------------------------------------------------------------------------
// Phase 8: Authorization Decision Engine — Shadow & Enforcement Mode
// SERGIO-100 (Slice 3)
// ---------------------------------------------------------------------------

import type {
  AuthzDecision,
  AuthzResult,
  Permission,
  RequestContext,
} from "./types.js";
import { hasPermission, resolveActionPermission } from "./permissions.js";
import type { IamFeatureFlags } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Permission category classification
// ---------------------------------------------------------------------------

/** Returns true when the permission belongs to a read/browse category. */
function isReadPermission(permission: Permission): boolean {
  return permission.startsWith("browse:") || permission.startsWith("audit:");
}

/** Returns true when the permission belongs to a write/mutate category. */
function isWritePermission(permission: Permission): boolean {
  return (
    permission.startsWith("ingest:") ||
    permission.startsWith("metadata_write:") ||
    permission.startsWith("approval:") ||
    permission.startsWith("destructive:") ||
    permission.startsWith("admin:") ||
    permission.startsWith("iam:") ||
    permission.startsWith("dcc:") ||
    permission.startsWith("events:") ||
    permission.startsWith("outbox:")
  );
}

/**
 * Determines whether the decision should be enforced or shadowed based on
 * the feature flags and the permission category.
 */
function shouldEnforce(flags: IamFeatureFlags, permission: Permission): boolean {
  if (flags.shadowMode) return false;
  if (isReadPermission(permission) && flags.enforceReadScope) return true;
  if (isWritePermission(permission) && flags.enforceWriteScope) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates an authorization decision for a request context + permission.
 *
 * In shadow mode the decision is always "allow" at the caller level, but the
 * result records the *would-be* decision so it can be logged/audited.
 *
 * In enforcement mode the actual decision is returned for the caller to act on.
 */
export function evaluateAuthz(
  context: RequestContext,
  permission: Permission,
  flags: IamFeatureFlags,
): AuthzResult {
  const allowed = hasPermission(context.roles, permission);
  const enforce = shouldEnforce(flags, permission);
  const shadow = !enforce;

  const decision: AuthzDecision = allowed ? "allow" : "deny";
  const reason = allowed
    ? `roles [${context.roles.join(", ")}] include ${permission}`
    : `roles [${context.roles.join(", ")}] lack ${permission}`;

  return {
    decision: shadow && decision === "deny" ? "allow" : decision,
    permission,
    actor: context.userId,
    tenantId: context.scope.tenantId,
    projectId: context.scope.projectId,
    reason: shadow && !allowed
      ? `shadow-deny: ${reason}`
      : reason,
    evaluatedAt: new Date().toISOString(),
    shadow,
  };
}

// ---------------------------------------------------------------------------
// Route-level evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates authz for an HTTP method + path combination.
 * Returns null when the route is unmapped (health, readiness, etc.).
 */
export function evaluateRouteAuthz(
  context: RequestContext,
  method: string,
  path: string,
  flags: IamFeatureFlags,
): AuthzResult | null {
  const mapping = resolveActionPermission(method, path);
  if (!mapping) return null;
  return evaluateAuthz(context, mapping.permission, flags);
}
