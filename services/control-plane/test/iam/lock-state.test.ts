import test from "node:test";
import assert from "node:assert/strict";

import { LockStateService } from "../../src/iam/lock-state.js";
import { resolveIamFlags } from "../../src/iam/feature-flags.js";
import type { IamFeatureFlags } from "../../src/iam/feature-flags.js";

function makeFlags(overrides: Partial<IamFeatureFlags> = {}): IamFeatureFlags {
  return { ...resolveIamFlags(), iamEnabled: true, ...overrides };
}

function createService(): LockStateService {
  return new LockStateService();
}

// ---------------------------------------------------------------------------
// Lock state
// ---------------------------------------------------------------------------

test("setLock creates a lock", () => {
  const svc = createService();
  const lock = svc.setLock({
    assetId: "asset-1",
    condition: "delivery_locked",
    lockedBy: "admin-1",
    reason: "Final delivery in progress",
  });
  assert.equal(lock.assetId, "asset-1");
  assert.equal(lock.condition, "delivery_locked");
  assert.ok(lock.lockedAt);
});

test("getLock returns the lock", () => {
  const svc = createService();
  svc.setLock({ assetId: "asset-1", condition: "admin_hold", lockedBy: "administrator", reason: "hold" });
  const lock = svc.getLock("asset-1");
  assert.ok(lock);
  assert.equal(lock.condition, "admin_hold");
});

test("getLock returns null for unlocked asset", () => {
  const svc = createService();
  assert.equal(svc.getLock("asset-1"), null);
});

test("removeLock clears the lock", () => {
  const svc = createService();
  svc.setLock({ assetId: "asset-1", condition: "admin_hold", lockedBy: "administrator", reason: "hold" });
  assert.equal(svc.removeLock("asset-1"), true);
  assert.equal(svc.getLock("asset-1"), null);
});

test("checkLockState: not enforced allows access", () => {
  const svc = createService();
  svc.setLock({ assetId: "asset-1", condition: "admin_hold", lockedBy: "administrator", reason: "hold" });
  const result = svc.checkLockState("asset-1", makeFlags({ enableLockState: false }));
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "lock_state_not_enforced");
});

test("checkLockState: enforced blocks locked asset", () => {
  const svc = createService();
  svc.setLock({ assetId: "asset-1", condition: "incident_active", lockedBy: "administrator", reason: "incident" });
  const result = svc.checkLockState("asset-1", makeFlags({ enableLockState: true }));
  assert.equal(result.allowed, false);
  assert.ok(result.lock);
  assert.equal(result.reason, "locked:incident_active");
});

test("checkLockState: enforced allows unlocked asset", () => {
  const svc = createService();
  const result = svc.checkLockState("asset-1", makeFlags({ enableLockState: true }));
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "no_lock");
});

// ---------------------------------------------------------------------------
// Override protocol
// ---------------------------------------------------------------------------

test("requestOverride creates an override", () => {
  const svc = createService();
  const override = svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT_FIX",
    ticketReference: "JIRA-123",
  });
  assert.ok(override.id);
  assert.equal(override.approved, false);
  assert.equal(override.reasonCode, "URGENT_FIX");
  assert.equal(override.ticketReference, "JIRA-123");
});

test("approveOverride succeeds with different user", () => {
  const svc = createService();
  const override = svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT",
  });
  const result = svc.approveOverride(override.id, "user-2");
  assert.equal(result.ok, true);
});

test("approveOverride fails for self-approval", () => {
  const svc = createService();
  const override = svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT",
  });
  const result = svc.approveOverride(override.id, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cannot_self_approve_override");
});

test("approveOverride fails for already approved", () => {
  const svc = createService();
  const override = svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT",
  });
  svc.approveOverride(override.id, "user-2");
  const result = svc.approveOverride(override.id, "user-3");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "already_approved");
});

test("hasActiveOverride returns true for approved non-expired override", () => {
  const svc = createService();
  const override = svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT",
    expiryMinutes: 60,
  });
  svc.approveOverride(override.id, "user-2");
  assert.equal(svc.hasActiveOverride("asset-1"), true);
});

test("hasActiveOverride returns false for unapproved override", () => {
  const svc = createService();
  svc.requestOverride({
    assetId: "asset-1",
    requesterId: "user-1",
    reasonCode: "URGENT",
  });
  assert.equal(svc.hasActiveOverride("asset-1"), false);
});

// ---------------------------------------------------------------------------
// Break-glass sessions
// ---------------------------------------------------------------------------

test("createBreakGlassSession creates a session", () => {
  const svc = createService();
  const session = svc.createBreakGlassSession({
    userId: "user-1",
    elevatedRole: "administrator",
    reasonCode: "PRODUCTION_DOWN",
    mfaVerified: true,
    durationMinutes: 30,
  });
  assert.ok(session.id);
  assert.equal(session.userId, "user-1");
  assert.equal(session.elevatedRole, "administrator");
  assert.equal(session.mfaVerified, true);
  assert.equal(session.reviewed, false);
});

test("getActiveBreakGlassSession returns active session", () => {
  const svc = createService();
  svc.createBreakGlassSession({
    userId: "user-1",
    elevatedRole: "administrator",
    reasonCode: "URGENT",
    mfaVerified: true,
    durationMinutes: 60,
  });
  const session = svc.getActiveBreakGlassSession("user-1");
  assert.ok(session);
  assert.equal(session.elevatedRole, "administrator");
});

test("getActiveBreakGlassSession returns null without MFA", () => {
  const svc = createService();
  svc.createBreakGlassSession({
    userId: "user-1",
    elevatedRole: "administrator",
    reasonCode: "URGENT",
    mfaVerified: false,
  });
  const session = svc.getActiveBreakGlassSession("user-1");
  assert.equal(session, null);
});

test("reviewBreakGlassSession succeeds with different user", () => {
  const svc = createService();
  const session = svc.createBreakGlassSession({
    userId: "user-1",
    elevatedRole: "administrator",
    reasonCode: "URGENT",
    mfaVerified: true,
  });
  const result = svc.reviewBreakGlassSession(session.id, "reviewer-1");
  assert.equal(result.ok, true);
  const updated = svc.getBreakGlassSession(session.id);
  assert.ok(updated);
  assert.equal(updated.reviewed, true);
  assert.equal(updated.reviewedBy, "reviewer-1");
});

test("reviewBreakGlassSession fails for self-review", () => {
  const svc = createService();
  const session = svc.createBreakGlassSession({
    userId: "user-1",
    elevatedRole: "administrator",
    reasonCode: "URGENT",
    mfaVerified: true,
  });
  const result = svc.reviewBreakGlassSession(session.id, "user-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cannot_self_review");
});

test("getUnreviewedSessions returns only unreviewed", () => {
  const svc = createService();
  const s1 = svc.createBreakGlassSession({
    userId: "user-1", elevatedRole: "administrator", reasonCode: "A", mfaVerified: true,
  });
  svc.createBreakGlassSession({
    userId: "user-2", elevatedRole: "supervisor", reasonCode: "B", mfaVerified: true,
  });
  svc.reviewBreakGlassSession(s1.id, "reviewer");
  const unreviewed = svc.getUnreviewedSessions();
  assert.equal(unreviewed.length, 1);
  assert.equal(unreviewed[0].userId, "user-2");
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test("reset clears all state", () => {
  const svc = createService();
  svc.setLock({ assetId: "a", condition: "admin_hold", lockedBy: "x", reason: "y" });
  svc.createBreakGlassSession({ userId: "u", elevatedRole: "administrator", reasonCode: "r", mfaVerified: true });
  svc.reset();
  assert.equal(svc.getLock("a"), null);
  assert.equal(svc.getUnreviewedSessions().length, 0);
});
