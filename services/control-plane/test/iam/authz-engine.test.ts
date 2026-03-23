import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAuthz, evaluateRouteAuthz } from "../../src/iam/authz-engine.js";
import { createAuthzLogger } from "../../src/iam/authz-logger.js";
import { getEffectivePermissionsForRoles } from "../../src/iam/permissions.js";
import { PERMISSIONS, type RequestContext, type Role } from "../../src/iam/types.js";
import type { IamFeatureFlags } from "../../src/iam/feature-flags.js";

const P = PERMISSIONS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(roles: Role[], overrides?: Partial<RequestContext>): RequestContext {
  return {
    userId: "user-1",
    displayName: "Test User",
    email: "test@example.com",
    authStrategy: "jwt",
    scope: { tenantId: "tenant-1", projectId: "project-1", source: "token" },
    roles,
    permissions: getEffectivePermissionsForRoles(roles),
    externalId: null,
    groups: [],
    tokenClaims: null,
    ...overrides,
  };
}

function shadowFlags(overrides?: Partial<IamFeatureFlags>): IamFeatureFlags {
  return {
    iamEnabled: true,
    shadowMode: true,
    enforceReadScope: false,
    enforceWriteScope: false,
    enforceApprovalSod: false,
    enableLockState: false,
    enableBreakGlass: false,
    enableScimSync: false,
    rolloutRing: "internal",
    allowlistedTenants: [],
    ...overrides,
  };
}

function enforcementFlags(overrides?: Partial<IamFeatureFlags>): IamFeatureFlags {
  return {
    iamEnabled: true,
    shadowMode: false,
    enforceReadScope: true,
    enforceWriteScope: true,
    enforceApprovalSod: false,
    enableLockState: false,
    enableBreakGlass: false,
    enableScimSync: false,
    rolloutRing: "general",
    allowlistedTenants: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shadow mode
// ---------------------------------------------------------------------------

test("shadow mode: allows request but records deny decision", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateAuthz(ctx, P.APPROVAL_APPROVE, shadowFlags());

  // Shadow mode always allows
  assert.equal(result.decision, "allow");
  assert.equal(result.shadow, true);
  assert.ok(result.reason.startsWith("shadow-deny:"));
  assert.ok(result.reason.includes(P.APPROVAL_APPROVE));
  assert.equal(result.actor, "user-1");
  assert.equal(result.tenantId, "tenant-1");
  assert.equal(result.projectId, "project-1");
});

test("shadow mode: records allow for authorized action", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateAuthz(ctx, P.BROWSE_ASSETS, shadowFlags());

  assert.equal(result.decision, "allow");
  assert.equal(result.shadow, true);
  assert.ok(!result.reason.startsWith("shadow-deny:"));
});

// ---------------------------------------------------------------------------
// Enforcement mode
// ---------------------------------------------------------------------------

test("enforcement mode: returns actual deny for unauthorized action", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateAuthz(ctx, P.APPROVAL_APPROVE, enforcementFlags());

  assert.equal(result.decision, "deny");
  assert.equal(result.shadow, false);
  assert.ok(result.reason.includes("lack"));
  assert.ok(result.reason.includes(P.APPROVAL_APPROVE));
});

test("enforcement mode: returns allow for authorized action", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateAuthz(ctx, P.BROWSE_ASSETS, enforcementFlags());

  assert.equal(result.decision, "allow");
  assert.equal(result.shadow, false);
});

// ---------------------------------------------------------------------------
// Role-specific authorization
// ---------------------------------------------------------------------------

test("admin role is always allowed", () => {
  const ctx = makeContext(["administrator"]);

  const browse = evaluateAuthz(ctx, P.BROWSE_ASSETS, enforcementFlags());
  assert.equal(browse.decision, "allow");

  const write = evaluateAuthz(ctx, P.METADATA_WRITE_OTHERS, enforcementFlags());
  assert.equal(write.decision, "allow");

  const approve = evaluateAuthz(ctx, P.APPROVAL_APPROVE, enforcementFlags());
  assert.equal(approve.decision, "allow");

  const system = evaluateAuthz(ctx, P.ADMIN_SYSTEM_CONFIG, enforcementFlags());
  assert.equal(system.decision, "allow");
});

test("viewer denied write operations", () => {
  const ctx = makeContext(["viewer"]);

  const write = evaluateAuthz(ctx, P.METADATA_WRITE_OWN, enforcementFlags());
  assert.equal(write.decision, "deny");

  const ingest = evaluateAuthz(ctx, P.INGEST_CREATE, enforcementFlags());
  assert.equal(ingest.decision, "deny");

  const approve = evaluateAuthz(ctx, P.APPROVAL_APPROVE, enforcementFlags());
  assert.equal(approve.decision, "deny");
});

test("artist allowed to submit for review", () => {
  const ctx = makeContext(["artist"]);

  const submit = evaluateAuthz(ctx, P.APPROVAL_SUBMIT, enforcementFlags());
  assert.equal(submit.decision, "allow");

  // But cannot approve
  const approve = evaluateAuthz(ctx, P.APPROVAL_APPROVE, enforcementFlags());
  assert.equal(approve.decision, "deny");
});

test("supervisor allowed to approve", () => {
  const ctx = makeContext(["supervisor"]);

  const approve = evaluateAuthz(ctx, P.APPROVAL_APPROVE, enforcementFlags());
  assert.equal(approve.decision, "allow");

  const reject = evaluateAuthz(ctx, P.APPROVAL_REJECT, enforcementFlags());
  assert.equal(reject.decision, "allow");
});

// ---------------------------------------------------------------------------
// Route-level evaluation
// ---------------------------------------------------------------------------

test("evaluateRouteAuthz returns null for unmapped routes", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateRouteAuthz(ctx, "GET", "/health", shadowFlags());
  assert.equal(result, null);
});

test("evaluateRouteAuthz maps known routes and evaluates", () => {
  const ctx = makeContext(["viewer"]);

  const assets = evaluateRouteAuthz(ctx, "GET", "/assets", enforcementFlags());
  assert.ok(assets);
  assert.equal(assets.decision, "allow");
  assert.equal(assets.permission, P.BROWSE_ASSETS);

  const ingest = evaluateRouteAuthz(ctx, "POST", "/assets/ingest", enforcementFlags());
  assert.ok(ingest);
  assert.equal(ingest.decision, "deny");
  assert.equal(ingest.permission, P.INGEST_CREATE);
});

test("evaluateRouteAuthz handles parameterized routes", () => {
  const ctx = makeContext(["viewer"]);
  const result = evaluateRouteAuthz(ctx, "GET", "/jobs/abc-123", enforcementFlags());
  assert.ok(result);
  assert.equal(result.decision, "allow");
  assert.equal(result.permission, P.BROWSE_JOBS);
});

// ---------------------------------------------------------------------------
// Selective enforcement (read vs write flags)
// ---------------------------------------------------------------------------

test("enforceReadScope only enforces read permissions", () => {
  const flags = shadowFlags({ shadowMode: false, enforceReadScope: true, enforceWriteScope: false });
  // Viewer has all browse/audit permissions, so read is allowed
  const ctx = makeContext(["viewer"]);

  // Read allowed for viewer that has BROWSE_JOBS
  const read = evaluateAuthz(ctx, P.BROWSE_JOBS, flags);
  assert.equal(read.decision, "allow");
  assert.equal(read.shadow, false);

  // Write stays shadowed (enforceWriteScope is false)
  const write = evaluateAuthz(ctx, P.INGEST_CREATE, flags);
  assert.equal(write.decision, "allow");
  assert.equal(write.shadow, true);

  // Artist lacks ADMIN_METRICS — but admin:metrics starts with "admin:" which
  // is classified as write, not read. Test a scenario where a read perm is
  // truly denied: use artist which has all browse via viewer inheritance.
  // All current roles inherit viewer which has all browse: perms, so read
  // denials only happen if we test a role that hasn't inherited viewer.
  // In the new model, all project roles inherit viewer, so read enforcement
  // always allows for browse:* perms. This is correct by design.
});

test("enforceWriteScope only enforces write permissions", () => {
  const flags = shadowFlags({ shadowMode: false, enforceReadScope: false, enforceWriteScope: true });
  const ctx = makeContext(["viewer"]);

  // Read stays shadowed
  const read = evaluateAuthz(ctx, P.BROWSE_JOBS, flags);
  assert.equal(read.decision, "allow");
  assert.equal(read.shadow, true);

  // Write denied
  const write = evaluateAuthz(ctx, P.INGEST_CREATE, flags);
  assert.equal(write.decision, "deny");
  assert.equal(write.shadow, false);
});

// ---------------------------------------------------------------------------
// AuthzLogger — metrics
// ---------------------------------------------------------------------------

test("metrics track shadow denies correctly", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);
  const flags = shadowFlags();

  // This will be a shadow deny (viewer lacks APPROVAL_APPROVE)
  const deny1 = evaluateAuthz(ctx, P.APPROVAL_APPROVE, flags);
  logger.logDecision(deny1);

  // This will be a regular allow (viewer has BROWSE_ASSETS)
  const allow1 = evaluateAuthz(ctx, P.BROWSE_ASSETS, flags);
  logger.logDecision(allow1);

  // Another shadow deny
  const deny2 = evaluateAuthz(ctx, P.INGEST_CREATE, flags);
  logger.logDecision(deny2);

  const metrics = logger.getMetrics();
  assert.equal(metrics.total, 3);
  assert.equal(metrics.allow, 3); // All "allow" because shadow mode
  assert.equal(metrics.deny, 0);
  assert.equal(metrics.shadowDeny, 2);
});

test("metrics track enforcement denies correctly", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);
  const flags = enforcementFlags();

  const deny = evaluateAuthz(ctx, P.APPROVAL_APPROVE, flags);
  logger.logDecision(deny);

  const allow = evaluateAuthz(ctx, P.BROWSE_ASSETS, flags);
  logger.logDecision(allow);

  const metrics = logger.getMetrics();
  assert.equal(metrics.total, 2);
  assert.equal(metrics.allow, 1);
  assert.equal(metrics.deny, 1);
  assert.equal(metrics.shadowDeny, 0);
});

// ---------------------------------------------------------------------------
// AuthzLogger — decision query
// ---------------------------------------------------------------------------

test("decision log is queryable by actor", () => {
  const logger = createAuthzLogger();

  const ctx1 = makeContext(["viewer"], { userId: "alice" });
  const ctx2 = makeContext(["administrator"], { userId: "bob" });

  logger.logDecision(evaluateAuthz(ctx1, P.BROWSE_ASSETS, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx2, P.BROWSE_ASSETS, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx1, P.APPROVAL_APPROVE, shadowFlags()));

  const aliceDecisions = logger.getDecisions({ actor: "alice" });
  assert.equal(aliceDecisions.length, 2);

  const bobDecisions = logger.getDecisions({ actor: "bob" });
  assert.equal(bobDecisions.length, 1);
});

test("decision log is queryable by permission", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);

  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_ASSETS, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx, P.APPROVAL_APPROVE, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_JOBS, shadowFlags()));

  const browse = logger.getDecisions({ permission: P.BROWSE_ASSETS });
  assert.equal(browse.length, 1);

  const approve = logger.getDecisions({ permission: P.APPROVAL_APPROVE });
  assert.equal(approve.length, 1);
});

test("decision log is queryable by decision type", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);
  const flags = enforcementFlags();

  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_ASSETS, flags));
  logger.logDecision(evaluateAuthz(ctx, P.APPROVAL_APPROVE, flags));
  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_JOBS, flags));

  const allows = logger.getDecisions({ decision: "allow" });
  assert.equal(allows.length, 2);

  const denies = logger.getDecisions({ decision: "deny" });
  assert.equal(denies.length, 1);
});

test("decision log returns all decisions without filter", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);

  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_ASSETS, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx, P.APPROVAL_APPROVE, shadowFlags()));

  assert.equal(logger.getDecisions().length, 2);
});

test("logger clear resets decisions and metrics", () => {
  const logger = createAuthzLogger();
  const ctx = makeContext(["viewer"]);

  logger.logDecision(evaluateAuthz(ctx, P.BROWSE_ASSETS, shadowFlags()));
  logger.logDecision(evaluateAuthz(ctx, P.APPROVAL_APPROVE, shadowFlags()));

  logger.clear();

  assert.equal(logger.getDecisions().length, 0);
  const metrics = logger.getMetrics();
  assert.equal(metrics.total, 0);
  assert.equal(metrics.allow, 0);
  assert.equal(metrics.deny, 0);
  assert.equal(metrics.shadowDeny, 0);
});
