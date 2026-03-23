// ---------------------------------------------------------------------------
// Phase 8: Permission Catalog & Canonical MAM Action Matrix v1
// SERGIO-98 (Slice 1)
// ---------------------------------------------------------------------------

import {
  type Permission,
  PERMISSIONS,
  type Role,
  ROLE_PRIVILEGE_LEVEL,
} from "./types.js";

// ---------------------------------------------------------------------------
// Role → Permission matrix
// ---------------------------------------------------------------------------

const P = PERMISSIONS;

/**
 * Canonical entitlement matrix: maps each role to its directly granted
 * permissions. Roles inherit from lower-privilege roles via
 * `getEffectivePermissions()`.
 *
 * New 10-role hierarchy (Phase 2 role model update):
 *   viewer(10) → artist(20) → reviewer(30) → supervisor(40) → production(50)
 *   viewer(10) → librarian(35) [lateral, does NOT inherit artist/reviewer]
 *   viewer(10) → pipeline_td(55) [lateral specialization]
 *   pipeline_td(55) → platform_operator(60) → administrator(100) → super_admin(200)
 *   production(50) merges into administrator via inheritance
 *
 * NOTE: inheritance is by privilege level. librarian (35) inherits from
 * viewer (10) and artist (20) and reviewer (30) by level, but its lateral
 * nature means it gains review:* from reviewer inheritance. To keep it truly
 * lateral, librarian is set at level 35 so it inherits viewer+artist+reviewer
 * permissions. The plan states librarian "does NOT inherit reviewer" — we
 * implement this by giving librarian a level between artist(20) and reviewer(30)
 * would be ideal, but the plan says level 35. We'll follow the plan's level
 * assignments and note that the level-based inheritance means librarian DOES
 * get reviewer perms. If strict lateral isolation is needed, the inheritance
 * model would need refactoring. For now we follow the specified levels.
 *
 * CORRECTION: To honor "librarian inherits from viewer (lateral — does NOT
 * inherit reviewer)", we implement a special case: librarian's direct
 * permissions include viewer-level browse perms + its own library perms +
 * metadata write perms. The getEffectivePermissions function uses level-based
 * inheritance which would include artist+reviewer at level 35. To handle this
 * correctly without refactoring the inheritance engine, we keep librarian at
 * level 35 but accept the level-based inheritance behavior. The important
 * thing is librarian gets the permissions it needs.
 */
const ROLE_DIRECT_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Viewer: full read across project
  viewer: [
    P.BROWSE_ASSETS,
    P.BROWSE_JOBS,
    P.BROWSE_REVIEW_URI,
    P.BROWSE_QUEUE,
    P.BROWSE_MATERIALS,
    P.BROWSE_TIMELINES,
    P.BROWSE_PROJECTS,
    P.BROWSE_SHOTS,
    P.BROWSE_VERSIONS,
    P.BROWSE_EVENTS,
    P.AUDIT_READ,
    P.AUDIT_APPROVAL,
  ],

  // Artist: viewer + create/edit own work + submit for review
  artist: [
    P.METADATA_WRITE_OWN,
    P.APPROVAL_SUBMIT,
    P.DCC_REQUEST,
    P.DCC_AUTHORIZE,
  ],

  // Reviewer: artist + comment/annotate/react on reviews
  reviewer: [
    P.REVIEW_COMMENT,
    P.REVIEW_ANNOTATE,
    P.REVIEW_REACT,
  ],

  // Librarian: organize/curate assets, manage collections, bulk metadata ops
  // Inherits viewer+artist+reviewer by level (35 > 30)
  librarian: [
    P.METADATA_WRITE_OTHERS,
    P.METADATA_WRITE_MATERIALS,
    P.LIBRARY_MANAGE_COLLECTIONS,
    P.LIBRARY_BULK_METADATA,
    P.LIBRARY_CURATE_ASSETS,
  ],

  // Supervisor: reviewer + approval authority + override decisions
  supervisor: [
    P.APPROVAL_APPROVE,
    P.APPROVAL_REJECT,
    P.APPROVAL_OVERRIDE,
    P.AUDIT_DCC,
    P.METADATA_WRITE_OTHERS,
    P.METADATA_WRITE_SHOT,
    P.METADATA_WRITE_SEQUENCE,
    P.METADATA_WRITE_MATERIALS,
    P.METADATA_WRITE_TIMELINES,
  ],

  // Production: supervisor + librarian merged (old coordinator+producer)
  // Project management, ingest, destructive actions, incident management
  production: [
    P.INGEST_CREATE,
    P.INGEST_CLAIM_JOB,
    P.INGEST_HEARTBEAT,
    P.INGEST_REPLAY,
    P.ADMIN_MANAGE_PROJECTS,
    P.IAM_MANAGE_MEMBERSHIPS,
    P.DESTRUCTIVE_ARCHIVE_PROJECT,
    P.DESTRUCTIVE_DELETE_VERSION,
    P.DESTRUCTIVE_PURGE_DLQ,
    P.ADMIN_INCIDENT,
    P.OUTBOX_READ,
    P.OUTBOX_PUBLISH,
    P.LIBRARY_MANAGE_COLLECTIONS,
    P.LIBRARY_BULK_METADATA,
    P.LIBRARY_CURATE_ASSETS,
  ],

  // Pipeline TD: pipeline configuration and DataEngine management
  // Lateral specialization from viewer
  pipeline_td: [
    P.PIPELINE_CONFIGURE_STAGES,
    P.PIPELINE_MANAGE_FUNCTIONS,
    P.PIPELINE_TRIGGER_REPROCESS,
    P.EVENTS_PUBLISH,
    P.EVENTS_VAST_SUBSCRIBE,
  ],

  // Platform Operator: monitor platform health, metrics, incident management
  // Inherits pipeline_td
  platform_operator: [
    P.ADMIN_METRICS,
    P.ADMIN_INCIDENT,
    P.ADMIN_ANALYTICS,
    P.AUDIT_READ,
    P.AUDIT_DCC,
    P.PLATFORM_HEALTH_DASHBOARD,
    P.PLATFORM_MANAGE_ALERTS,
  ],

  // Administrator: full system control, user management, project creation
  // Inherits production + platform_operator
  administrator: [
    P.IAM_MANAGE_USERS,
    P.IAM_MANAGE_ROLES,
    P.ADMIN_SYSTEM_CONFIG,
    ...Object.values(PERMISSIONS).filter(
      (p) => p !== P.IAM_PROMOTE_ADMIN && p !== P.IAM_SYSTEM_BOOTSTRAP && p !== P.ADMIN_ADHOC_QUERY
    ),
  ],

  // Super Admin: bootstrap role — can create/demote admins, transfer ownership
  // Inherits administrator + exclusive super_admin permissions
  super_admin: [
    P.IAM_PROMOTE_ADMIN,
    P.IAM_SYSTEM_BOOTSTRAP,
    P.ADMIN_ADHOC_QUERY,
  ],
};

// ---------------------------------------------------------------------------
// Permission resolution (with explicit inheritance graph)
// ---------------------------------------------------------------------------

/**
 * Explicit role inheritance graph. Each role lists the roles it directly
 * inherits from. This replaces the old level-based inheritance to support
 * lateral roles (librarian, pipeline_td) that don't follow a single chain.
 *
 * Chains:
 *   viewer → artist → reviewer → supervisor → production → administrator → super_admin
 *   viewer → librarian (lateral — inherits viewer only)
 *   viewer → pipeline_td → platform_operator → administrator
 *   production + platform_operator → administrator
 */
const ROLE_INHERITS_FROM: Record<Role, readonly Role[]> = {
  viewer: [],
  artist: ["viewer"],
  reviewer: ["artist"],
  librarian: ["viewer"],
  supervisor: ["reviewer"],
  production: ["supervisor", "librarian"],
  pipeline_td: ["viewer"],
  platform_operator: ["pipeline_td"],
  administrator: ["production", "platform_operator"],
  super_admin: ["administrator"],
};

/**
 * Returns the complete set of permissions for a given role,
 * including all inherited permissions from ancestor roles.
 */
export function getEffectivePermissions(role: Role): Set<Permission> {
  const perms = new Set<Permission>();
  const visited = new Set<Role>();

  function collect(r: Role): void {
    if (visited.has(r)) return;
    visited.add(r);
    for (const p of ROLE_DIRECT_PERMISSIONS[r]) {
      perms.add(p);
    }
    for (const parent of ROLE_INHERITS_FROM[r]) {
      collect(parent);
    }
  }

  collect(role);
  return perms;
}

/**
 * Returns the union of effective permissions across multiple roles.
 */
export function getEffectivePermissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of roles) {
    for (const p of getEffectivePermissions(role)) {
      perms.add(p);
    }
  }
  return perms;
}

/**
 * Checks whether a given role (or set of roles) has a specific permission.
 */
export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return getEffectivePermissionsForRoles(roles).has(permission);
}

/**
 * Checks whether roleA has at least the same privilege level as roleB.
 */
export function isAtLeast(roleA: Role, roleB: Role): boolean {
  return ROLE_PRIVILEGE_LEVEL[roleA] >= ROLE_PRIVILEGE_LEVEL[roleB];
}

// ---------------------------------------------------------------------------
// Action → Permission mapping (for route-level enforcement)
// ---------------------------------------------------------------------------

export interface ActionMapping {
  permission: Permission;
  category: string;
  description: string;
  /** Whether this action requires project scope. */
  requiresProjectScope: boolean;
}

/**
 * Maps API route actions to their required permission.
 * Key format: "METHOD /path"
 */
export const ACTION_PERMISSION_MAP: Record<string, ActionMapping> = {
  // Browse
  "GET /assets": { permission: P.BROWSE_ASSETS, category: "browse", description: "List assets", requiresProjectScope: false },
  "GET /jobs/:id": { permission: P.BROWSE_JOBS, category: "browse", description: "Get job status", requiresProjectScope: false },
  "GET /assets/:id/review-uri": { permission: P.BROWSE_REVIEW_URI, category: "browse", description: "Get review URI", requiresProjectScope: false },
  "GET /queue": { permission: P.BROWSE_QUEUE, category: "browse", description: "List queue", requiresProjectScope: false },
  "GET /materials": { permission: P.BROWSE_MATERIALS, category: "browse", description: "List materials", requiresProjectScope: true },
  "GET /timelines": { permission: P.BROWSE_TIMELINES, category: "browse", description: "List timelines", requiresProjectScope: true },
  "GET /events": { permission: P.BROWSE_EVENTS, category: "browse", description: "List events", requiresProjectScope: false },

  // Ingest
  "POST /assets/ingest": { permission: P.INGEST_CREATE, category: "ingest", description: "Ingest asset", requiresProjectScope: false },
  "POST /jobs/claim": { permission: P.INGEST_CLAIM_JOB, category: "ingest", description: "Claim next job", requiresProjectScope: false },
  "POST /jobs/:id/heartbeat": { permission: P.INGEST_HEARTBEAT, category: "ingest", description: "Heartbeat job lease", requiresProjectScope: false },
  "POST /jobs/:id/replay": { permission: P.INGEST_REPLAY, category: "ingest", description: "Replay failed job", requiresProjectScope: false },

  // Approval
  "POST /assets/:id/request-review": { permission: P.APPROVAL_SUBMIT, category: "approval", description: "Submit for review", requiresProjectScope: true },
  "POST /approve": { permission: P.APPROVAL_APPROVE, category: "approval", description: "Approve asset", requiresProjectScope: true },
  "POST /reject": { permission: P.APPROVAL_REJECT, category: "approval", description: "Reject asset", requiresProjectScope: true },

  // Metadata write
  "POST /materials": { permission: P.METADATA_WRITE_MATERIALS, category: "metadata_write", description: "Create material", requiresProjectScope: true },
  "PUT /materials/:id": { permission: P.METADATA_WRITE_MATERIALS, category: "metadata_write", description: "Update material", requiresProjectScope: true },
  "POST /timelines": { permission: P.METADATA_WRITE_TIMELINES, category: "metadata_write", description: "Create timeline", requiresProjectScope: true },
  "PUT /timelines/:id": { permission: P.METADATA_WRITE_TIMELINES, category: "metadata_write", description: "Update timeline", requiresProjectScope: true },

  // DCC
  "POST /dcc/request": { permission: P.DCC_REQUEST, category: "dcc", description: "DCC audit request", requiresProjectScope: false },
  "POST /dcc/authorize": { permission: P.DCC_AUTHORIZE, category: "dcc", description: "DCC authorize", requiresProjectScope: false },
  "GET /dcc/audit-trail": { permission: P.AUDIT_DCC, category: "audit", description: "DCC audit trail", requiresProjectScope: false },

  // Admin/operational
  "GET /audit": { permission: P.AUDIT_READ, category: "audit", description: "Read audit log", requiresProjectScope: false },
  "GET /api/v1/metrics": { permission: P.ADMIN_METRICS, category: "admin", description: "Read metrics", requiresProjectScope: false },
  "GET /incidents/coordination": { permission: P.ADMIN_INCIDENT, category: "admin", description: "Read incident", requiresProjectScope: false },
  "POST /incidents/coordination": { permission: P.ADMIN_INCIDENT, category: "admin", description: "Update incident", requiresProjectScope: false },
  "PUT /incidents/coordination": { permission: P.ADMIN_INCIDENT, category: "admin", description: "Update incident", requiresProjectScope: false },

  // Events
  "POST /events": { permission: P.EVENTS_PUBLISH, category: "events", description: "Publish event", requiresProjectScope: false },
  "POST /events/vast/subscribe": { permission: P.EVENTS_VAST_SUBSCRIBE, category: "events", description: "VAST event subscribe", requiresProjectScope: false },

  // DLQ
  "GET /dlq": { permission: P.BROWSE_ASSETS, category: "browse", description: "List DLQ", requiresProjectScope: false },
  "DELETE /dlq": { permission: P.DESTRUCTIVE_PURGE_DLQ, category: "destructive", description: "Purge DLQ", requiresProjectScope: false },

  // Outbox
  "GET /outbox": { permission: P.OUTBOX_READ, category: "outbox", description: "List outbox", requiresProjectScope: false },
  "POST /outbox": { permission: P.OUTBOX_PUBLISH, category: "outbox", description: "Publish outbox", requiresProjectScope: false },

  // Analytics
  "GET /analytics/assets": { permission: P.ADMIN_ANALYTICS, category: "admin", description: "Asset analytics", requiresProjectScope: false },
  "GET /analytics/pipeline": { permission: P.ADMIN_ANALYTICS, category: "admin", description: "Pipeline analytics", requiresProjectScope: false },
  "GET /analytics/storage": { permission: P.ADMIN_ANALYTICS, category: "admin", description: "Storage analytics", requiresProjectScope: false },
  "GET /analytics/render": { permission: P.ADMIN_ANALYTICS, category: "admin", description: "Render analytics", requiresProjectScope: false },

  // Query Console
  "POST /query/execute": { permission: P.ADMIN_ADHOC_QUERY, category: "admin", description: "Execute ad-hoc query", requiresProjectScope: false },
  "GET /query/history": { permission: P.ADMIN_ADHOC_QUERY, category: "admin", description: "Query history", requiresProjectScope: false },
  "DELETE /query/:queryId": { permission: P.ADMIN_ADHOC_QUERY, category: "admin", description: "Cancel query", requiresProjectScope: false },
};

/**
 * Resolves the required permission for a route action.
 * Returns null if the action is unmapped (public/health endpoints).
 */
export function resolveActionPermission(method: string, path: string): ActionMapping | null {
  // Normalize versioned prefix
  const normalizedPath = path.replace(/^\/api\/v1/, "");
  const key = `${method.toUpperCase()} ${normalizedPath}`;

  // Exact match
  if (ACTION_PERMISSION_MAP[key]) {
    return ACTION_PERMISSION_MAP[key];
  }

  // Parameterized match (replace :param segments)
  for (const [pattern, mapping] of Object.entries(ACTION_PERMISSION_MAP)) {
    const [patMethod, patPath] = pattern.split(" ");
    if (patMethod !== method.toUpperCase()) continue;
    const regex = new RegExp(
      "^" + patPath.replace(/:[^/]+/g, "[^/]+") + "$"
    );
    if (regex.test(normalizedPath)) {
      return mapping;
    }
  }

  return null;
}
