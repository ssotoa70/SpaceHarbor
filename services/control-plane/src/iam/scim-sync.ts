// ---------------------------------------------------------------------------
// Phase 8 Slice 10: SCIM-Based User/Group Lifecycle Sync
// SERGIO-107
// ---------------------------------------------------------------------------

import type { RoleBindingService } from "./role-binding.js";
import type { ProjectRole, UserStatus } from "./types.js";

// ---------------------------------------------------------------------------
// SCIM types (simplified RFC 7643 subset)
// ---------------------------------------------------------------------------

export interface ScimUser {
  id: string;
  externalId: string;
  userName: string;
  displayName: string;
  emails: Array<{ value: string; primary?: boolean }>;
  active: boolean;
  groups: Array<{ value: string; display?: string }>;
}

export interface ScimGroup {
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
}

export interface ScimSyncResult {
  usersCreated: number;
  usersUpdated: number;
  usersDisabled: number;
  membershipsGranted: number;
  membershipsRevoked: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Group-to-role mapping
// ---------------------------------------------------------------------------

export interface GroupRoleMapping {
  groupName: string;
  projectId: string;
  tenantId: string;
  role: ProjectRole;
}

// ---------------------------------------------------------------------------
// SCIM Sync Service
// ---------------------------------------------------------------------------

export class ScimSyncService {
  private groupRoleMappings: GroupRoleMapping[] = [];

  constructor(private roleBindingService: RoleBindingService) {}

  /**
   * Configures how IdP groups map to project roles.
   */
  setGroupRoleMappings(mappings: GroupRoleMapping[]): void {
    this.groupRoleMappings = [...mappings];
  }

  getGroupRoleMappings(): readonly GroupRoleMapping[] {
    return this.groupRoleMappings;
  }

  /**
   * Syncs a batch of SCIM users from the IdP.
   * Creates/updates user records and project memberships based on group mappings.
   */
  syncUsers(scimUsers: ScimUser[]): ScimSyncResult {
    const result: ScimSyncResult = {
      usersCreated: 0,
      usersUpdated: 0,
      usersDisabled: 0,
      membershipsGranted: 0,
      membershipsRevoked: 0,
      errors: [],
    };

    for (const scimUser of scimUsers) {
      try {
        this.syncSingleUser(scimUser, result);
      } catch (err) {
        result.errors.push(
          `Failed to sync user ${scimUser.externalId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return result;
  }

  private syncSingleUser(scimUser: ScimUser, result: ScimSyncResult): void {
    const rbs = this.roleBindingService;
    const primaryEmail = scimUser.emails.find((e) => e.primary)?.value ?? scimUser.emails[0]?.value;

    if (!primaryEmail) {
      result.errors.push(`User ${scimUser.externalId} has no email`);
      return;
    }

    // Find or create user
    let user = rbs.getUserByExternalId(scimUser.externalId);

    if (!user) {
      user = rbs.createUser({
        email: primaryEmail,
        displayName: scimUser.displayName,
        externalId: scimUser.externalId,
        status: scimUser.active ? "active" : "disabled",
      });
      result.usersCreated++;
    } else {
      // Update status if changed
      const targetStatus: UserStatus = scimUser.active ? "active" : "disabled";
      if (user.status !== targetStatus) {
        rbs.updateUserStatus(user.id, targetStatus);
        if (targetStatus === "disabled") {
          result.usersDisabled++;
        }
        result.usersUpdated++;
      }
    }

    // Sync group memberships
    const scimGroupNames = new Set(scimUser.groups.map((g) => g.display ?? g.value));
    const mappedRoles = this.groupRoleMappings.filter((m) =>
      scimGroupNames.has(m.groupName)
    );

    // Grant roles for mapped groups
    const grantedProjects = new Set<string>();
    for (const mapping of mappedRoles) {
      const existing = rbs.getProjectMembership(user.id, mapping.projectId);
      if (!existing || existing.role !== mapping.role) {
        rbs.grantProjectRole({
          userId: user.id,
          projectId: mapping.projectId,
          tenantId: mapping.tenantId,
          role: mapping.role,
          grantedBy: "scim-sync",
        });
        result.membershipsGranted++;
      }
      grantedProjects.add(mapping.projectId);
    }

    // Revoke memberships for projects no longer in mapped groups
    const currentMemberships = rbs.listUserMemberships(user.id);
    for (const membership of currentMemberships) {
      if (!grantedProjects.has(membership.projectId)) {
        rbs.revokeProjectRole(user.id, membership.projectId, "scim-sync");
        result.membershipsRevoked++;
      }
    }
  }
}
