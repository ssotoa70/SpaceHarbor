// ---------------------------------------------------------------------------
// Phase 8: Identity, Roles & Tool Entitlements — Core IAM Types
// SERGIO-98 (Slice 1)
// ---------------------------------------------------------------------------

/** Authentication strategy that resolved the current request identity. */
export type AuthStrategy = "jwt" | "api_key" | "service_token" | "anonymous";

/** Scope source used to resolve tenant/project context. */
export type ScopeSource = "token" | "membership" | "request" | "default";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Project-scoped roles (ordered by privilege, ascending). */
export const PROJECT_ROLES = [
  "viewer",
  "artist",
  "reviewer",
  "librarian",
  "supervisor",
  "production",
  "pipeline_td",
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Global roles. */
export const GLOBAL_ROLES = ["platform_operator", "administrator", "super_admin"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

/** Any assignable role. */
export type Role = ProjectRole | GlobalRole;

/**
 * Hierarchical privilege level per role.
 * Higher number = more privilege. Used for "at least" checks.
 */
export const ROLE_PRIVILEGE_LEVEL: Record<Role, number> = {
  viewer: 10,
  artist: 20,
  reviewer: 30,
  librarian: 35,
  supervisor: 40,
  production: 50,
  pipeline_td: 55,
  platform_operator: 60,
  administrator: 100,
  super_admin: 200,
};

// ---------------------------------------------------------------------------
// Permission categories
// ---------------------------------------------------------------------------

export const PERMISSION_CATEGORIES = [
  "browse",
  "ingest",
  "metadata_write",
  "approval",
  "destructive",
  "admin",
  "iam",
  "audit",
  "review",
  "library",
  "pipeline",
  "platform",
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Canonical permission keys
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  // Browse / read
  BROWSE_ASSETS: "browse:assets",
  BROWSE_JOBS: "browse:jobs",
  BROWSE_REVIEW_URI: "browse:review_uri",
  BROWSE_QUEUE: "browse:queue",
  BROWSE_MATERIALS: "browse:materials",
  BROWSE_TIMELINES: "browse:timelines",
  BROWSE_PROJECTS: "browse:projects",
  BROWSE_SHOTS: "browse:shots",
  BROWSE_VERSIONS: "browse:versions",
  BROWSE_EVENTS: "browse:events",

  // Ingest
  INGEST_CREATE: "ingest:create",
  INGEST_CLAIM_JOB: "ingest:claim_job",
  INGEST_HEARTBEAT: "ingest:heartbeat",
  INGEST_REPLAY: "ingest:replay",

  // Metadata write
  METADATA_WRITE_OWN: "metadata_write:own",
  METADATA_WRITE_OTHERS: "metadata_write:others",
  METADATA_WRITE_SHOT: "metadata_write:shot",
  METADATA_WRITE_SEQUENCE: "metadata_write:sequence",
  METADATA_WRITE_MATERIALS: "metadata_write:materials",
  METADATA_WRITE_TIMELINES: "metadata_write:timelines",

  // Approval workflow
  APPROVAL_SUBMIT: "approval:submit",
  APPROVAL_APPROVE: "approval:approve",
  APPROVAL_REJECT: "approval:reject",
  APPROVAL_OVERRIDE: "approval:override",

  // Destructive
  DESTRUCTIVE_ARCHIVE_PROJECT: "destructive:archive_project",
  DESTRUCTIVE_DELETE_VERSION: "destructive:delete_version",
  DESTRUCTIVE_PURGE_DLQ: "destructive:purge_dlq",

  // Admin / system
  ADMIN_METRICS: "admin:metrics",
  ADMIN_SYSTEM_CONFIG: "admin:system_config",
  ADMIN_MANAGE_PROJECTS: "admin:manage_projects",
  ADMIN_INCIDENT: "admin:incident",
  ADMIN_ANALYTICS: "admin:analytics",
  ADMIN_ADHOC_QUERY: "admin:adhoc_query",

  // IAM
  IAM_MANAGE_USERS: "iam:manage_users",
  IAM_MANAGE_ROLES: "iam:manage_roles",
  IAM_MANAGE_MEMBERSHIPS: "iam:manage_memberships",

  // Audit
  AUDIT_READ: "audit:read",
  AUDIT_DCC: "audit:dcc",
  AUDIT_APPROVAL: "audit:approval",

  // DCC
  DCC_REQUEST: "dcc:request",
  DCC_AUTHORIZE: "dcc:authorize",

  // Events
  EVENTS_PUBLISH: "events:publish",
  EVENTS_VAST_SUBSCRIBE: "events:vast_subscribe",

  // Outbox
  OUTBOX_READ: "outbox:read",
  OUTBOX_PUBLISH: "outbox:publish",

  // Review (reviewer role)
  REVIEW_COMMENT: "review:comment",
  REVIEW_ANNOTATE: "review:annotate",
  REVIEW_REACT: "review:react",

  // Library (librarian role)
  LIBRARY_MANAGE_COLLECTIONS: "library:manage_collections",
  LIBRARY_BULK_METADATA: "library:bulk_metadata",
  LIBRARY_CURATE_ASSETS: "library:curate_assets",

  // Pipeline (pipeline_td role)
  PIPELINE_CONFIGURE_STAGES: "pipeline:configure_stages",
  PIPELINE_MANAGE_FUNCTIONS: "pipeline:manage_functions",
  PIPELINE_TRIGGER_REPROCESS: "pipeline:trigger_reprocess",

  // Platform (platform_operator role)
  PLATFORM_HEALTH_DASHBOARD: "platform:health_dashboard",
  PLATFORM_MANAGE_ALERTS: "platform:manage_alerts",

  // IAM (super_admin)
  IAM_PROMOTE_ADMIN: "iam:promote_admin",
  IAM_SYSTEM_BOOTSTRAP: "iam:system_bootstrap",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ---------------------------------------------------------------------------
// Scope context
// ---------------------------------------------------------------------------

/** Resolved tenant/project scope for a request. */
export interface ScopeContext {
  tenantId: string;
  projectId: string | null;
  source: ScopeSource;
}

// ---------------------------------------------------------------------------
// Request context (unified identity)
// ---------------------------------------------------------------------------

/** Identity + entitlement context resolved for every request. */
export interface RequestContext {
  /** Unique user/service account ID. */
  userId: string;
  /** Human-readable display name. */
  displayName: string;
  /** Email (may be null for service accounts). */
  email: string | null;
  /** How this identity was authenticated. */
  authStrategy: AuthStrategy;
  /** Resolved tenant/project scope. */
  scope: ScopeContext;
  /** Effective roles within scope. */
  roles: Role[];
  /** Effective permissions (derived from roles). */
  permissions: Set<Permission>;
  /** IdP external subject claim (for OIDC/SAML users). */
  externalId: string | null;
  /** Groups from IdP claims. */
  groups: string[];
  /** Raw JWT claims (if auth via JWT). */
  tokenClaims: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// User and membership models (persistence)
// ---------------------------------------------------------------------------

export type UserStatus = "active" | "disabled" | "pending" | "locked";

export interface User {
  id: string;
  externalId: string | null;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMembership {
  id: string;
  userId: string;
  projectId: string;
  tenantId: string;
  role: ProjectRole;
  grantedBy: string;
  grantedAt: string;
}

export interface GlobalRoleAssignment {
  userId: string;
  role: GlobalRole;
  grantedBy: string;
  grantedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  ownerId: string;
  label: string | null;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Authorization decision
// ---------------------------------------------------------------------------

export type AuthzDecision = "allow" | "deny";

export interface AuthzResult {
  decision: AuthzDecision;
  permission: Permission;
  actor: string;
  tenantId: string;
  projectId: string | null;
  reason: string;
  evaluatedAt: string;
  shadow: boolean;
}

// ---------------------------------------------------------------------------
// Lock state and break-glass
// ---------------------------------------------------------------------------

export type LockStateCondition = "approval_pending" | "delivery_locked" | "incident_active" | "admin_hold";

export interface LockState {
  assetId: string;
  condition: LockStateCondition;
  lockedBy: string;
  lockedAt: string;
  reason: string;
}

export interface BreakGlassSession {
  id: string;
  userId: string;
  elevatedRole: Role;
  reasonCode: string;
  ticketReference: string | null;
  grantedAt: string;
  expiresAt: string;
  mfaVerified: boolean;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

// ---------------------------------------------------------------------------
// SCIM / rollout
// ---------------------------------------------------------------------------

export type RolloutRing = "internal" | "pilot" | "expand" | "general";

export interface RolloutConfig {
  ring: RolloutRing;
  allowlistedTenants: string[];
  enforcementEnabled: boolean;
  shadowModeEnabled: boolean;
}
