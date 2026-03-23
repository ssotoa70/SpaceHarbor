// ---------------------------------------------------------------------------
// Phase 8 Slice 9: Lock-State Enforcement, Override Protocol & Break-Glass
// SERGIO-106
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  BreakGlassSession,
  LockState,
  LockStateCondition,
  Role,
} from "./types.js";
import type { IamFeatureFlags } from "./feature-flags.js";

// ---------------------------------------------------------------------------
// Override request
// ---------------------------------------------------------------------------

export interface OverrideRequest {
  id: string;
  assetId: string;
  requesterId: string;
  reasonCode: string;
  ticketReference: string | null;
  requestedAt: string;
  expiresAt: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Lock-State Service
// ---------------------------------------------------------------------------

export class LockStateService {
  private locks = new Map<string, LockState>(); // assetId → lock
  private overrides: OverrideRequest[] = [];
  private breakGlassSessions = new Map<string, BreakGlassSession>(); // sessionId → session

  // -----------------------------------------------------------------------
  // Lock state
  // -----------------------------------------------------------------------

  /**
   * Sets a lock on an asset. Returns the lock state.
   */
  setLock(input: {
    assetId: string;
    condition: LockStateCondition;
    lockedBy: string;
    reason: string;
  }): LockState {
    const lock: LockState = {
      assetId: input.assetId,
      condition: input.condition,
      lockedBy: input.lockedBy,
      lockedAt: new Date().toISOString(),
      reason: input.reason,
    };
    this.locks.set(input.assetId, lock);
    return lock;
  }

  /**
   * Removes a lock from an asset.
   */
  removeLock(assetId: string): boolean {
    return this.locks.delete(assetId);
  }

  /**
   * Gets the current lock on an asset, or null if unlocked.
   */
  getLock(assetId: string): LockState | null {
    return this.locks.get(assetId) ?? null;
  }

  /**
   * Checks whether an action is allowed given the lock state.
   * Locked assets block write/destructive operations unless overridden.
   */
  checkLockState(
    assetId: string,
    flags: IamFeatureFlags
  ): { allowed: boolean; lock: LockState | null; reason: string } {
    if (!flags.enableLockState) {
      return { allowed: true, lock: null, reason: "lock_state_not_enforced" };
    }

    const lock = this.locks.get(assetId);
    if (!lock) {
      return { allowed: true, lock: null, reason: "no_lock" };
    }

    return {
      allowed: false,
      lock,
      reason: `locked:${lock.condition}`,
    };
  }

  // -----------------------------------------------------------------------
  // Override protocol
  // -----------------------------------------------------------------------

  /**
   * Creates an override request for a locked asset.
   */
  requestOverride(input: {
    assetId: string;
    requesterId: string;
    reasonCode: string;
    ticketReference?: string;
    expiryMinutes?: number;
  }): OverrideRequest {
    const now = new Date();
    const expiryMs = (input.expiryMinutes ?? 60) * 60 * 1000;
    const override: OverrideRequest = {
      id: randomUUID(),
      assetId: input.assetId,
      requesterId: input.requesterId,
      reasonCode: input.reasonCode,
      ticketReference: input.ticketReference ?? null,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiryMs).toISOString(),
      approved: false,
      approvedBy: null,
      approvedAt: null,
    };
    this.overrides.push(override);
    return override;
  }

  /**
   * Approves an override request. Must be a different user than the requester.
   */
  approveOverride(
    overrideId: string,
    approverId: string
  ): { ok: boolean; reason: string } {
    const override = this.overrides.find((o) => o.id === overrideId);
    if (!override) return { ok: false, reason: "override_not_found" };
    if (override.approved) return { ok: false, reason: "already_approved" };
    if (override.requesterId === approverId) {
      return { ok: false, reason: "cannot_self_approve_override" };
    }
    if (new Date(override.expiresAt) < new Date()) {
      return { ok: false, reason: "override_expired" };
    }

    override.approved = true;
    override.approvedBy = approverId;
    override.approvedAt = new Date().toISOString();
    return { ok: true, reason: "approved" };
  }

  /**
   * Checks if an asset has an active, approved override.
   */
  hasActiveOverride(assetId: string): boolean {
    return this.overrides.some(
      (o) =>
        o.assetId === assetId &&
        o.approved &&
        new Date(o.expiresAt) > new Date()
    );
  }

  getOverrides(assetId: string): readonly OverrideRequest[] {
    return this.overrides.filter((o) => o.assetId === assetId);
  }

  // -----------------------------------------------------------------------
  // Break-glass temporary elevation
  // -----------------------------------------------------------------------

  /**
   * Creates a break-glass session granting temporary elevated access.
   */
  createBreakGlassSession(input: {
    userId: string;
    elevatedRole: Role;
    reasonCode: string;
    ticketReference?: string;
    durationMinutes?: number;
    mfaVerified: boolean;
  }): BreakGlassSession {
    const now = new Date();
    const durationMs = (input.durationMinutes ?? 30) * 60 * 1000;
    const session: BreakGlassSession = {
      id: randomUUID(),
      userId: input.userId,
      elevatedRole: input.elevatedRole,
      reasonCode: input.reasonCode,
      ticketReference: input.ticketReference ?? null,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
      mfaVerified: input.mfaVerified,
      reviewed: false,
      reviewedBy: null,
      reviewedAt: null,
    };
    this.breakGlassSessions.set(session.id, session);
    return session;
  }

  /**
   * Gets the active break-glass session for a user, or null.
   */
  getActiveBreakGlassSession(userId: string): BreakGlassSession | null {
    for (const session of this.breakGlassSessions.values()) {
      if (
        session.userId === userId &&
        new Date(session.expiresAt) > new Date() &&
        session.mfaVerified
      ) {
        return session;
      }
    }
    return null;
  }

  /**
   * Marks a break-glass session as reviewed (post-event review requirement).
   */
  reviewBreakGlassSession(
    sessionId: string,
    reviewedBy: string
  ): { ok: boolean; reason: string } {
    const session = this.breakGlassSessions.get(sessionId);
    if (!session) return { ok: false, reason: "session_not_found" };
    if (session.reviewed) return { ok: false, reason: "already_reviewed" };
    if (session.userId === reviewedBy) {
      return { ok: false, reason: "cannot_self_review" };
    }

    session.reviewed = true;
    session.reviewedBy = reviewedBy;
    session.reviewedAt = new Date().toISOString();
    return { ok: true, reason: "reviewed" };
  }

  /**
   * Returns all break-glass sessions that haven't been reviewed yet.
   */
  getUnreviewedSessions(): readonly BreakGlassSession[] {
    return [...this.breakGlassSessions.values()].filter((s) => !s.reviewed);
  }

  getBreakGlassSession(sessionId: string): BreakGlassSession | null {
    return this.breakGlassSessions.get(sessionId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Reset (for testing)
  // -----------------------------------------------------------------------

  reset(): void {
    this.locks.clear();
    this.overrides = [];
    this.breakGlassSessions.clear();
  }
}
