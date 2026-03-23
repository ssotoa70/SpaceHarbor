// ---------------------------------------------------------------------------
// Phase 1.2: Persistent Role Binding Service (Trino-backed)
// ---------------------------------------------------------------------------
//
// Drop-in replacement for the in-memory RoleBindingService that persists
// users, memberships, and global roles to VAST Database via Trino.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { TrinoClient } from "../db/trino-client.js";
import type {
  GlobalRole,
  GlobalRoleAssignment,
  ProjectMembership,
  ProjectRole,
  Role,
  User,
  UserStatus,
} from "./types.js";
import type { RoleChangeAudit } from "./role-binding.js";
import {
  insertIamUser,
  queryIamUserById,
  queryIamUserByEmail,
  queryIamUserByExternalId,
  queryIamUsers,
  updateIamUserStatus,
  insertIamMembership,
  queryIamMembershipsByUser,
  queryIamMembershipsByProject,
  deleteIamMembership,
  insertIamGlobalRole,
  queryIamGlobalRoleByUser,
  queryIamGlobalRoles as queryAllGlobalRoles,
  deleteIamGlobalRole,
} from "../persistence/adapters/vast-trino-queries.js";

export class PersistentRoleBindingService {
  private auditLog: RoleChangeAudit[] = [];

  constructor(private readonly trino: TrinoClient) {}

  // -------------------------------------------------------------------------
  // User registry
  // -------------------------------------------------------------------------

  async createUser(input: {
    email: string;
    displayName: string;
    externalId?: string;
    avatarUrl?: string;
    status?: UserStatus;
  }): Promise<User> {
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
    await insertIamUser(this.trino, user);
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return queryIamUserById(this.trino, id);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return queryIamUserByEmail(this.trino, email);
  }

  async getUserByExternalId(externalId: string): Promise<User | null> {
    return queryIamUserByExternalId(this.trino, externalId);
  }

  async listUsers(): Promise<readonly User[]> {
    return queryIamUsers(this.trino);
  }

  async updateUserStatus(userId: string, status: UserStatus): Promise<User | null> {
    const existing = await this.getUserById(userId);
    if (!existing) return null;
    await updateIamUserStatus(this.trino, userId, status);
    return { ...existing, status, updatedAt: new Date().toISOString() };
  }

  // -------------------------------------------------------------------------
  // Project membership / role binding
  // -------------------------------------------------------------------------

  async grantProjectRole(input: {
    userId: string;
    projectId: string;
    tenantId: string;
    role: ProjectRole;
    grantedBy: string;
  }): Promise<ProjectMembership> {
    // Delete any existing membership first (upsert)
    await deleteIamMembership(this.trino, input.userId, input.projectId);

    const membership: ProjectMembership = {
      id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      tenantId: input.tenantId,
      role: input.role,
      grantedBy: input.grantedBy,
      grantedAt: new Date().toISOString(),
    };

    await insertIamMembership(this.trino, membership);
    this.logAudit("grant", input.userId, input.role, input.tenantId, input.projectId, input.grantedBy);
    return membership;
  }

  async revokeProjectRole(userId: string, projectId: string, performedBy: string): Promise<boolean> {
    const memberships = await queryIamMembershipsByUser(this.trino, userId);
    const existing = memberships.find((m) => m.projectId === projectId);
    if (!existing) return false;

    await deleteIamMembership(this.trino, userId, projectId);
    this.logAudit("revoke", userId, existing.role, existing.tenantId, projectId, performedBy);
    return true;
  }

  async getProjectMembership(userId: string, projectId: string): Promise<ProjectMembership | null> {
    const memberships = await queryIamMembershipsByUser(this.trino, userId);
    return memberships.find((m) => m.projectId === projectId) ?? null;
  }

  async listUserMemberships(userId: string): Promise<readonly ProjectMembership[]> {
    return queryIamMembershipsByUser(this.trino, userId);
  }

  async listProjectMembers(projectId: string): Promise<readonly ProjectMembership[]> {
    return queryIamMembershipsByProject(this.trino, projectId);
  }

  // -------------------------------------------------------------------------
  // Global roles
  // -------------------------------------------------------------------------

  async grantGlobalRole(userId: string, role: GlobalRole, grantedBy: string): Promise<GlobalRoleAssignment> {
    await deleteIamGlobalRole(this.trino, userId);

    const assignment: GlobalRoleAssignment = {
      userId,
      role,
      grantedBy,
      grantedAt: new Date().toISOString(),
    };
    await insertIamGlobalRole(this.trino, assignment);
    this.logAudit("grant", userId, role, "*", null, grantedBy);
    return assignment;
  }

  async revokeGlobalRole(userId: string, performedBy: string): Promise<boolean> {
    const existing = await queryIamGlobalRoleByUser(this.trino, userId);
    if (!existing) return false;
    await deleteIamGlobalRole(this.trino, userId);
    this.logAudit("revoke", userId, existing.role, "*", null, performedBy);
    return true;
  }

  async getGlobalRole(userId: string): Promise<GlobalRoleAssignment | null> {
    return queryIamGlobalRoleByUser(this.trino, userId);
  }

  // -------------------------------------------------------------------------
  // Entitlement evaluation (read model)
  // -------------------------------------------------------------------------

  async getEffectiveRoles(userId: string, projectId: string | null): Promise<Role[]> {
    const roles: Role[] = [];

    const globalRole = await queryIamGlobalRoleByUser(this.trino, userId);
    if (globalRole) {
      roles.push(globalRole.role);
    }

    if (projectId) {
      const membership = await this.getProjectMembership(userId, projectId);
      if (membership) {
        roles.push(membership.role);
      }
    }

    return roles;
  }

  async getUserTenantIds(userId: string): Promise<string[]> {
    const memberships = await queryIamMembershipsByUser(this.trino, userId);
    const tenantIds = new Set<string>();
    for (const m of memberships) {
      tenantIds.add(m.tenantId);
    }
    return [...tenantIds];
  }

  async getUserProjectIds(userId: string, tenantId: string): Promise<string[]> {
    const memberships = await queryIamMembershipsByUser(this.trino, userId);
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
    performedBy: string,
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
}
