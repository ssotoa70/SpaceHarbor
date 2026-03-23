// ---------------------------------------------------------------------------
// Phase 8: Tenant/Project Scope Resolver
// SERGIO-99 (Slice 2) — resolves canonical scope context for API requests
// ---------------------------------------------------------------------------

import type { ScopeContext, ScopeSource } from "./types.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface ScopeResolverInput {
  tokenClaims: Record<string, unknown> | null;
  requestHeaders: Record<string, string | string[] | undefined>;
  requestParams: Record<string, unknown>;
  requestBody: Record<string, unknown> | null;
  membershipTenantIds: string[];
  membershipProjectIds: string[];
}

export type ScopeResolverResult =
  | { ok: true; scope: ScopeContext }
  | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------
// Header / claim keys
// ---------------------------------------------------------------------------

const TENANT_HEADER = "x-tenant-id";
const PROJECT_HEADER = "x-project-id";
const TOKEN_TENANT_CLAIM = "tenant_id";
const TOKEN_PROJECT_CLAIM = "project_id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstString(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value || null;
}

function extractString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  if (typeof val === "string" && val.length > 0) return val;
  return null;
}

// ---------------------------------------------------------------------------
// Token-based resolution
// ---------------------------------------------------------------------------

function resolveFromToken(claims: Record<string, unknown> | null): {
  tenantId: string | null;
  projectId: string | null;
} {
  if (!claims) return { tenantId: null, projectId: null };
  return {
    tenantId: extractString(claims, TOKEN_TENANT_CLAIM),
    projectId: extractString(claims, TOKEN_PROJECT_CLAIM),
  };
}

// ---------------------------------------------------------------------------
// Request-based resolution (headers + params + body)
// ---------------------------------------------------------------------------

function resolveFromRequest(input: ScopeResolverInput): {
  tenantId: string | null;
  projectId: string | null;
} {
  const tenantId =
    firstString(input.requestHeaders[TENANT_HEADER]) ??
    extractString(input.requestParams, "tenantId") ??
    (input.requestBody ? extractString(input.requestBody, "tenantId") : null);

  const projectId =
    firstString(input.requestHeaders[PROJECT_HEADER]) ??
    extractString(input.requestParams, "projectId") ??
    (input.requestBody ? extractString(input.requestBody, "projectId") : null);

  return { tenantId, projectId };
}

// ---------------------------------------------------------------------------
// Membership-based resolution
// ---------------------------------------------------------------------------

function resolveFromMembership(input: ScopeResolverInput): {
  tenantId: string | null;
  projectId: string | null;
  ambiguous: boolean;
} {
  const { membershipTenantIds, membershipProjectIds } = input;

  if (membershipTenantIds.length === 0) {
    return { tenantId: null, projectId: null, ambiguous: false };
  }

  if (membershipTenantIds.length > 1) {
    return { tenantId: null, projectId: null, ambiguous: true };
  }

  // Exactly one tenant
  const tenantId = membershipTenantIds[0]!;
  const projectId = membershipProjectIds.length === 1 ? membershipProjectIds[0]! : null;
  return { tenantId, projectId, ambiguous: false };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the canonical tenant/project scope for a request.
 *
 * Resolution priority:
 *   1. JWT token claims (most trusted)
 *   2. Explicit request params (headers, query, body)
 *   3. User's project memberships (implicit)
 *
 * Returns an error result when scope cannot be determined or when
 * a tenant boundary violation is detected.
 */
export function resolveScope(input: ScopeResolverInput): ScopeResolverResult {
  // 1. Token claims
  const token = resolveFromToken(input.tokenClaims);
  if (token.tenantId) {
    // Cross-check: if request also specifies a tenant, it must match
    const req = resolveFromRequest(input);
    if (req.tenantId && req.tenantId !== token.tenantId) {
      return {
        ok: false,
        code: "SCOPE_TENANT_MISMATCH",
        message: `Token tenant "${token.tenantId}" does not match request tenant "${req.tenantId}"`,
      };
    }

    return {
      ok: true,
      scope: {
        tenantId: token.tenantId,
        projectId: token.projectId ?? req.projectId ?? null,
        source: "token",
      },
    };
  }

  // 2. Explicit request params
  const request = resolveFromRequest(input);
  if (request.tenantId) {
    // Validate the requested tenant against the user's membership list.
    // Skip when membershipTenantIds is empty — that signals single-tenant mode
    // or anonymous resolution where no membership data is available.
    if (input.membershipTenantIds.length > 0 && !input.membershipTenantIds.includes(request.tenantId)) {
      return {
        ok: false,
        code: "SCOPE_TENANT_FORBIDDEN",
        message: `User is not a member of tenant "${request.tenantId}"`,
      };
    }

    return {
      ok: true,
      scope: {
        tenantId: request.tenantId,
        projectId: request.projectId,
        source: "request",
      },
    };
  }

  // 3. Membership-based
  const membership = resolveFromMembership(input);
  if (membership.ambiguous) {
    return {
      ok: false,
      code: "SCOPE_AMBIGUOUS",
      message:
        "Multiple tenant memberships found; provide an explicit tenant via x-tenant-id header or token claim",
    };
  }

  if (membership.tenantId) {
    return {
      ok: true,
      scope: {
        tenantId: membership.tenantId,
        projectId: membership.projectId,
        source: "membership",
      },
    };
  }

  // No scope resolved from any source
  return {
    ok: false,
    code: "SCOPE_MISSING",
    message: "Unable to determine tenant scope from token, request, or memberships",
  };
}
