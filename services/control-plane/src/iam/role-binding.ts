// ---------------------------------------------------------------------------
// Phase 8 Slice 5: Tenant/Project-Scoped Role Binding Service
// SERGIO-102
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  GlobalRole,
  GlobalRoleAssignment,
  ProjectMembership,
  ProjectRole,
  Role,
  User,
  UserStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Audit entry for role changes
// ---------------------------------------------------------------------------

export interface RoleChangeAudit {
  id: string;
  action: "grant" | "revoke";
  userId: string;
  role: Role;
  tenantId: string;
  projectId: string | null;
  performedBy: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Role Binding Service
// ---------------------------------------------------------------------------

export class RoleBindingService {
  private users = new Map<string, User>();
  private usersByEmail = new Map<string, string>(); // email → userId
  private usersByExternalId = new Map<string, string>(); // externalId → userId
  private memberships = new Map<string, ProjectMembership[]>(); // userId → memberships
  private globalRoles = new Map<string, GlobalRoleAssignment>(); // userId → global role
  private auditLog: RoleChangeAudit[] = [];

  // -------------------------------------------------------------------------
  // User registry
  // -------------------------------------------------------------------------

  createUser(input: {
    email: string;
    displayName: string;
    externalId?: string;
    avatarUrl?: string;
    status?: UserStatus;
  }): User {
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      externalId: input.externalId ?? null,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    if (user.externalId) {
      this.usersByExternalId.set(user.externalId, user.id);
    }
    return user;
  }

  getUserById(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  getUserByEmail(email: string): User | null {
    const id = this.usersByEmail.get(email);
    return id ? this.users.get(id) ?? null : null;
  }

  getUserByExternalId(externalId: string): User | null {
    const id = this.usersByExternalId.get(externalId);
    return id ? this.users.get(id) ?? null : null;
  }

  listUsers(): readonly User[] {
    return [...this.users.values()];
  }

  updateUserStatus(userId: string, status: UserStatus): User | null {
    const user = this.users.get(userId);
    if (!user) return null;
    const updated = { ...user, status, updatedAt: new Date().toISOString() };
    this.users.set(userId, updated);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Project membership / role binding
  // -------------------------------------------------------------------------

  grantProjectRole(input: {
    userId: string;
    projectId: string;
    tenantId: string;
    role: ProjectRole;
    grantedBy: string;
  }): ProjectMembership {
    const existing = this.getProjectMembership(input.userId, input.projectId);
    if (existing) {
      // Update existing membership role
      const updated: ProjectMembership = {
        ...existing,
        role: input.role,
        grantedBy: input.grantedBy,
        grantedAt: new Date().toISOString(),
      };
      const memberships = this.memberships.get(input.userId) ?? [];
      const idx = memberships.findIndex((m) => m.projectId === input.projectId);
      if (idx >= 0) memberships[idx] = updated;
      this.memberships.set(input.userId, memberships);
      this.logAudit("grant", input.userId, input.role, input.tenantId, input.projectId, input.grantedBy);
      return updated;
    }

    const membership: ProjectMembership = {
      id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      tenantId: input.tenantId,
      role: input.role,
      grantedBy: input.grantedBy,
      grantedAt: new Date().toISOString(),
    };

    const memberships = this.memberships.get(input.userId) ?? [];
    memberships.push(membership);
    this.memberships.set(input.userId, memberships);
    this.logAudit("grant", input.userId, input.role, input.tenantId, input.projectId, input.grantedBy);
    return membership;
  }

  revokeProjectRole(userId: string, projectId: string, performedBy: string): boolean {
    const memberships = this.memberships.get(userId);
    if (!memberships) return false;

    const idx = memberships.findIndex((m) => m.projectId === projectId);
    if (idx < 0) return false;

    const removed = memberships[idx];
    memberships.splice(idx, 1);
    this.memberships.set(userId, memberships);
    this.logAudit("revoke", userId, removed.role, removed.tenantId, projectId, performedBy);
    return true;
  }

  getProjectMembership(userId: string, projectId: string): ProjectMembership | null {
    const memberships = this.memberships.get(userId) ?? [];
    return memberships.find((m) => m.projectId === projectId) ?? null;
  }

  listUserMemberships(userId: string): readonly ProjectMembership[] {
    return this.memberships.get(userId) ?? [];
  }

  listProjectMembers(projectId: string): readonly ProjectMembership[] {
    const result: ProjectMembership[] = [];
    for (const memberships of this.memberships.values()) {
      for (const m of memberships) {
        if (m.projectId === projectId) result.push(m);
      }
    }
    return result;
  }

  listTenantMemberships(tenantId: string): readonly ProjectMembership[] {
    const result: ProjectMembership[] = [];
    for (const memberships of this.memberships.values()) {
      for (const m of memberships) {
        if (m.tenantId === tenantId) result.push(m);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Global roles
  // -------------------------------------------------------------------------

  grantGlobalRole(userId: string, role: GlobalRole, grantedBy: string): GlobalRoleAssignment {
    const assignment: GlobalRoleAssignment = {
      userId,
      role,
      grantedBy,
      grantedAt: new Date().toISOString(),
    };
    this.globalRoles.set(userId, assignment);
    this.logAudit("grant", userId, role, "*", null, grantedBy);
    return assignment;
  }

  revokeGlobalRole(userId: string, performedBy: string): boolean {
    const existing = this.globalRoles.get(userId);
    if (!existing) return false;
    this.globalRoles.delete(userId);
    this.logAudit("revoke", userId, existing.role, "*", null, performedBy);
    return true;
  }

  getGlobalRole(userId: string): GlobalRoleAssignment | null {
    return this.globalRoles.get(userId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Entitlement evaluation (read model)
  // -------------------------------------------------------------------------

  /**
   * Returns all effective roles for a user in a given scope.
   * Includes project role + global role (if any).
   */
  getEffectiveRoles(userId: string, projectId: string | null): Role[] {
    const roles: Role[] = [];

    // Global role always applies
    const globalRole = this.globalRoles.get(userId);
    if (globalRole) {
      roles.push(globalRole.role);
    }

    // Project-scoped role
    if (projectId) {
      const membership = this.getProjectMembership(userId, projectId);
      if (membership) {
        roles.push(membership.role);
      }
    }

    return roles;
  }

  /**
   * Returns all tenant IDs where the user has any membership.
   */
  getUserTenantIds(userId: string): string[] {
    const memberships = this.memberships.get(userId) ?? [];
    const tenantIds = new Set<string>();
    for (const m of memberships) {
      tenantIds.add(m.tenantId);
    }
    return [...tenantIds];
  }

  /**
   * Returns all project IDs where the user has membership within a tenant.
   */
  getUserProjectIds(userId: string, tenantId: string): string[] {
    const memberships = this.memberships.get(userId) ?? [];
    return memberships
      .filter((m) => m.tenantId === tenantId)
      .map((m) => m.projectId);
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  getAuditLog(): readonly RoleChangeAudit[] {
    return this.auditLog;
  }

  getAuditLogByUser(userId: string): readonly RoleChangeAudit[] {
    return this.auditLog.filter((e) => e.userId === userId);
  }

  private logAudit(
    action: "grant" | "revoke",
    userId: string,
    role: Role,
    tenantId: string,
    projectId: string | null,
    performedBy: string
  ): void {
    this.auditLog.push({
      id: randomUUID(),
      action,
      userId,
      role,
      tenantId,
      projectId,
      performedBy,
      at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Reset (for testing)
  // -------------------------------------------------------------------------

  reset(): void {
    this.users.clear();
    this.usersByEmail.clear();
    this.usersByExternalId.clear();
    this.memberships.clear();
    this.globalRoles.clear();
    this.auditLog = [];
  }
}
