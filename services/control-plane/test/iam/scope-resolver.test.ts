import test from "node:test";
import assert from "node:assert/strict";

import { resolveScope, type ScopeResolverInput } from "../../src/iam/scope-resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ScopeResolverInput> = {}): ScopeResolverInput {
  return {
    tokenClaims: null,
    requestHeaders: {},
    requestParams: {},
    requestBody: null,
    membershipTenantIds: [],
    membershipProjectIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Token claim resolution
// ---------------------------------------------------------------------------

test("resolves scope from token claims", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-1", project_id: "p-1" },
    })
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-1");
  assert.equal(result.scope.projectId, "p-1");
  assert.equal(result.scope.source, "token");
});

test("resolves tenant from token without project claim", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-1" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-1");
  assert.equal(result.scope.projectId, null);
  assert.equal(result.scope.source, "token");
});

test("token tenant merges projectId from request when token has no project", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-1" },
      requestHeaders: { "x-project-id": "p-from-header" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-1");
  assert.equal(result.scope.projectId, "p-from-header");
  assert.equal(result.scope.source, "token");
});

// ---------------------------------------------------------------------------
// Request header resolution
// ---------------------------------------------------------------------------

test("resolves scope from x-tenant-id header", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": "t-header" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-header");
  assert.equal(result.scope.projectId, null);
  assert.equal(result.scope.source, "request");
});

test("resolves scope from request headers with both tenant and project", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": "t-header", "x-project-id": "p-header" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-header");
  assert.equal(result.scope.projectId, "p-header");
  assert.equal(result.scope.source, "request");
});

// ---------------------------------------------------------------------------
// Request body resolution
// ---------------------------------------------------------------------------

test("resolves scope from request body projectId", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": "t-1" },
      requestBody: { projectId: "p-body" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-1");
  assert.equal(result.scope.projectId, "p-body");
  assert.equal(result.scope.source, "request");
});

test("resolves tenantId from request body when no header", () => {
  const result = resolveScope(
    makeInput({
      requestBody: { tenantId: "t-body", projectId: "p-body" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-body");
  assert.equal(result.scope.projectId, "p-body");
  assert.equal(result.scope.source, "request");
});

// ---------------------------------------------------------------------------
// Request params resolution
// ---------------------------------------------------------------------------

test("resolves tenantId from request params", () => {
  const result = resolveScope(
    makeInput({
      requestParams: { tenantId: "t-param" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-param");
  assert.equal(result.scope.source, "request");
});

// ---------------------------------------------------------------------------
// Membership resolution
// ---------------------------------------------------------------------------

test("resolves scope from single tenant membership", () => {
  const result = resolveScope(
    makeInput({
      membershipTenantIds: ["t-member"],
      membershipProjectIds: ["p-member"],
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-member");
  assert.equal(result.scope.projectId, "p-member");
  assert.equal(result.scope.source, "membership");
});

test("membership resolves tenant without project when multiple projects exist", () => {
  const result = resolveScope(
    makeInput({
      membershipTenantIds: ["t-member"],
      membershipProjectIds: ["p-1", "p-2"],
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-member");
  assert.equal(result.scope.projectId, null);
  assert.equal(result.scope.source, "membership");
});

// ---------------------------------------------------------------------------
// Missing scope
// ---------------------------------------------------------------------------

test("denies when no scope can be determined", () => {
  const result = resolveScope(makeInput());

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "SCOPE_MISSING");
  assert.ok(result.message.includes("Unable to determine tenant scope"));
});

// ---------------------------------------------------------------------------
// Ambiguous scope
// ---------------------------------------------------------------------------

test("denies on ambiguous scope with multiple tenant memberships", () => {
  const result = resolveScope(
    makeInput({
      membershipTenantIds: ["t-1", "t-2"],
    })
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "SCOPE_AMBIGUOUS");
  assert.ok(result.message.includes("Multiple tenant memberships"));
});

test("ambiguous memberships resolved when explicit header provided", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": "t-1" },
      membershipTenantIds: ["t-1", "t-2"],
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-1");
  assert.equal(result.scope.source, "request");
});

// ---------------------------------------------------------------------------
// Scope source diagnostic
// ---------------------------------------------------------------------------

test("returns correct scope source for each resolution path", () => {
  const tokenResult = resolveScope(
    makeInput({ tokenClaims: { tenant_id: "t-1" } })
  );
  assert.ok(tokenResult.ok);
  assert.equal(tokenResult.scope.source, "token");

  const requestResult = resolveScope(
    makeInput({ requestHeaders: { "x-tenant-id": "t-1" } })
  );
  assert.ok(requestResult.ok);
  assert.equal(requestResult.scope.source, "request");

  const membershipResult = resolveScope(
    makeInput({ membershipTenantIds: ["t-1"] })
  );
  assert.ok(membershipResult.ok);
  assert.equal(membershipResult.scope.source, "membership");
});

// ---------------------------------------------------------------------------
// Tenant boundary invariant
// ---------------------------------------------------------------------------

test("rejects when token tenant does not match request tenant", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-token" },
      requestHeaders: { "x-tenant-id": "t-different" },
    })
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "SCOPE_TENANT_MISMATCH");
  assert.ok(result.message.includes("t-token"));
  assert.ok(result.message.includes("t-different"));
});

test("allows when token tenant matches request tenant", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-same" },
      requestHeaders: { "x-tenant-id": "t-same" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-same");
  assert.equal(result.scope.source, "token");
});

test("rejects when token tenant differs from body tenant", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-token" },
      requestBody: { tenantId: "t-body" },
    })
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "SCOPE_TENANT_MISMATCH");
});

// ---------------------------------------------------------------------------
// Priority order
// ---------------------------------------------------------------------------

test("token takes priority over request headers and memberships", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "t-token", project_id: "p-token" },
      requestHeaders: { "x-tenant-id": "t-token", "x-project-id": "p-header" },
      membershipTenantIds: ["t-token"],
      membershipProjectIds: ["p-member"],
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-token");
  assert.equal(result.scope.projectId, "p-token");
  assert.equal(result.scope.source, "token");
});

test("request headers take priority over memberships", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": "t-header" },
      membershipTenantIds: ["t-member"],
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-header");
  assert.equal(result.scope.source, "request");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("ignores empty string token claims", () => {
  const result = resolveScope(
    makeInput({
      tokenClaims: { tenant_id: "", project_id: "" },
      requestHeaders: { "x-tenant-id": "t-fallback" },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-fallback");
  assert.equal(result.scope.source, "request");
});

test("handles array header values by taking first element", () => {
  const result = resolveScope(
    makeInput({
      requestHeaders: { "x-tenant-id": ["t-first", "t-second"] },
    })
  );

  assert.ok(result.ok);
  assert.equal(result.scope.tenantId, "t-first");
});
