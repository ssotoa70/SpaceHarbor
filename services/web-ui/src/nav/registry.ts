import type { NavItemDef, SectionDef } from "./types";

/**
 * 6 navigation sections, ordered as they appear in the sidebar.
 * Permission gates control visibility per role.
 */
export const NAV_SECTIONS: readonly SectionDef[] = [
  { id: "LIBRARY", label: "Library" },
  { id: "WORK", label: "Work", permission: "metadata_write:own" },
  { id: "REVIEW", label: "Review", permission: "approval:submit" },
  { id: "PRODUCTION", label: "Production", permission: "approval:approve" },
  { id: "PIPELINE", label: "Pipeline", permission: "pipeline:configure_stages" },
  { id: "AUTOMATION", label: "Automation", permission: "admin:system_config", collapsedByDefault: true },
  { id: "ADMIN", label: "Admin", permission: "admin:system_config", collapsedByDefault: true },
];

/**
 * All navigation items. Each references a section by id.
 * Icon paths are 16x16 SVG path data (reusing existing NavIcon patterns).
 */
export const NAV_ITEMS: readonly NavItemDef[] = [
  // ── LIBRARY ──
  {
    id: "assets",
    to: "/library/assets",
    label: "Assets",
    section: "LIBRARY",
    icon: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z",
    exact: true,
  },
  {
    id: "hierarchy",
    to: "/library/hierarchy",
    label: "Hierarchy",
    section: "LIBRARY",
    icon: "M3 2h10M5 5h8M7 8h6M5 11h8M3 14h10",
  },
  {
    id: "materials",
    to: "/library/materials",
    label: "Materials",
    section: "LIBRARY",
    icon: "M4 2l8 2v8l-8 2V2zM4 6l8 2",
  },
  {
    id: "storage",
    to: "/library/storage",
    label: "Storage",
    section: "LIBRARY",
    icon: "M2 4h12v2H2zM2 8h12v2H2zM2 12h12v2H2z",
  },
  {
    id: "checkin",
    to: "/library/checkin",
    label: "Check In",
    section: "LIBRARY",
    icon: "M8 2v8m0 0l3-3m-3 3L5 7M2 12h12v2H2z",
  },

  // ── WORK ──
  {
    id: "queue",
    to: "/work/queue",
    label: "My Queue",
    section: "WORK",
    permission: "metadata_write:own",
    badgeKey: "queue",
    icon: "M3 3h10v2H3zM3 7h7v2H3zM3 11h10v2H3z",
  },
  {
    id: "assignments",
    to: "/work/assignments",
    label: "My Assignments",
    section: "WORK",
    permission: "metadata_write:own",
    badgeKey: "assignments",
    icon: "M4 3h8v2H4zM3 7h10v2H3zM5 11h6v2H5z",
  },
  {
    id: "dailies",
    to: "/work/dailies",
    label: "Dailies",
    section: "WORK",
    permission: "metadata_write:own",
    icon: "M2 4h12v8H2zM6 4v8M10 4v8",
  },

  // ── REVIEW ──
  {
    id: "approvals",
    to: "/review/approvals",
    label: "Approvals",
    section: "REVIEW",
    permission: "approval:submit",
    badgeKey: "approvals",
    icon: "M8 3a5 5 0 100 10 5 5 0 000-10zM6 8l2 2 4-4",
  },
  {
    id: "feedback",
    to: "/review/feedback",
    label: "Feedback",
    section: "REVIEW",
    permission: "approval:submit",
    badgeKey: "feedback",
    icon: "M3 3h10v8H7l-3 3v-3H3V3z",
  },
  {
    id: "sessions",
    to: "/review/sessions",
    label: "Sessions",
    section: "REVIEW",
    permission: "approval:submit",
    icon: "M2 4h12v8H2zM5 4v8M11 4v8M2 8h12",
  },
  {
    id: "compare",
    to: "/review/compare",
    label: "Compare",
    section: "REVIEW",
    permission: "approval:approve",
    icon: "M2 3h5v10H2zM9 3h5v10H9zM7 8h2",
  },

  // ── PRODUCTION ──
  {
    id: "shots",
    to: "/production/shots",
    label: "Shot Board",
    section: "PRODUCTION",
    permission: "approval:approve",
    icon: "M2 3h12v10H2zM2 6h12M5 3v10M9 3v10",
  },
  {
    id: "timeline",
    to: "/production/timeline",
    label: "Timeline",
    section: "PRODUCTION",
    permission: "approval:approve",
    icon: "M2 4h12v8H2zM5 4v8M11 4v8M2 8h12",
  },
  {
    id: "dependencies",
    to: "/production/dependencies",
    label: "Dependencies",
    section: "PRODUCTION",
    permission: "approval:approve",
    icon: "M4 4h3v3H4zM9 4h3v3H9zM4 9h3v3H4zM9 9h3v3H9zM7 5.5h2M5.5 7v2M10.5 7v2",
  },
  {
    id: "delivery",
    to: "/production/delivery",
    label: "Delivery",
    section: "PRODUCTION",
    permission: "approval:approve",
    icon: "M2 12V6l3-2v8M7 12V4l3-2v10M12 12V8l2-1v5",
  },

  // ── PIPELINE ──
  {
    id: "pipeline-monitor",
    to: "/pipeline/monitor",
    label: "Monitor",
    section: "PIPELINE",
    permission: "pipeline:configure_stages",
    badgeKey: "dlq",
    icon: "M2 8h3l2-4 2 8 2-4h3",
  },
  {
    id: "transcoding",
    to: "/pipeline/transcoding",
    label: "Transcoding",
    section: "PIPELINE",
    permission: "pipeline:configure_stages",
    icon: "M3 4h10v8H3zM6 7l4 2-4 2V7z",
  },
  {
    id: "functions",
    to: "/pipeline/functions",
    label: "DataEngine",
    section: "PIPELINE",
    permission: "admin:system_config",
    icon: "M4 2l8 6-8 6V2z",
  },
  {
    id: "conform",
    to: "/pipeline/conform",
    label: "Conformance",
    section: "PIPELINE",
    permission: "pipeline:configure_stages",
    icon: "M3 3h10v2H3zM3 7h7v2H3zM3 11h10v2H3zM12 7l2 2-2 2",
  },

  // ── AUTOMATION ──
  {
    id: "custom-fields",
    to: "/automation/custom-fields",
    label: "Custom Fields",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M2 3h12v2H2zM2 7h8v2H2zM2 11h12v2H2z",
  },
  {
    id: "triggers",
    to: "/automation/triggers",
    label: "Triggers",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M8 2l-1 5h3l-2 7 1-5H6l2-7z",
  },
  {
    id: "webhooks",
    to: "/automation/webhooks",
    label: "Webhooks",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M5 10a3 3 0 01-2-5l3-1M11 6a3 3 0 012 5l-3 1M5 10l2 3 2-3M11 6L9 3 7 6",
  },
  {
    id: "workflows",
    to: "/automation/workflows",
    label: "Workflows",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M3 3h3v3H3zM10 3h3v3h-3zM3 10h3v3H3zM10 10h3v3h-3zM6 4.5h4M4.5 6v4M11.5 6v4M6 11.5h4",
  },
  {
    id: "metadata-pipelines",
    to: "/automation/pipelines",
    label: "Metadata Pipelines",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M2 4h4v2H2zM10 4h4v2h-4zM6 5h4M2 9h4v2H2zM10 9h4v2h-4zM6 10h4M2 14h4v-2H2zM10 14h4v-2h-4zM6 13h4",
  },
  {
    id: "naming-templates",
    to: "/automation/naming-templates",
    label: "Naming Templates",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M3 3h10v2H3zM3 7h7v2H3zM3 11h6v2H3zM12 9l2 2-3 3v-2h1z",
  },
  {
    id: "plugins",
    to: "/automation/plugins",
    label: "Plugins",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M5 3h2v3H5zM9 3h2v3H9zM3 6h10v3H3zM6 9v4M10 9v4M5 13h6v1H5z",
  },
  {
    id: "dispatches",
    to: "/automation/dispatches",
    label: "Dispatches",
    section: "AUTOMATION",
    permission: "admin:system_config",
    icon: "M2 8h3l2-4 2 8 2-4h3",
  },

  // ── ADMIN ──
  {
    id: "analytics",
    to: "/admin/analytics",
    label: "Analytics",
    section: "ADMIN",
    permission: "admin:analytics",
    icon: "M2 14V8l2-1v7M6 14V5l2-1v10M10 14V3l2-1v12M14 14V6l2-1v9",
  },
  {
    id: "breakers",
    to: "/admin/breakers",
    label: "Circuit Breakers",
    section: "ADMIN",
    permission: "admin:system_config",
    icon: "M3 8h2l1-3 2 6 1-3h2M14 8a6 6 0 11-12 0 6 6 0 0112 0z",
  },
  {
    id: "sql-console",
    to: "/admin/query",
    label: "SQL Console",
    section: "ADMIN",
    permission: "admin:adhoc_query",
    icon: "M3 3h10v2H3zM3 7h7v2H3zM3 11h10v2H3zM12 7l2 2-2 2",
  },
  // Capacity removed — requires VAST cluster connection (Phase 4 scope)
  {
    id: "users",
    to: "/admin/users",
    label: "Users & Roles",
    section: "ADMIN",
    permission: "iam:manage_users",
    icon: "M8 4a2 2 0 100 4 2 2 0 000-4zM4 13c0-2.2 1.8-4 4-4s4 1.8 4 4",
  },
  {
    id: "audit",
    to: "/admin/audit",
    label: "Audit Trail",
    section: "ADMIN",
    permission: "audit:read",
    icon: "M4 2h8l2 2v10H2V2h2zM4 6h8M4 9h6M4 12h8",
  },
  {
    id: "rbac",
    to: "/admin/rbac",
    label: "RBAC Matrix",
    section: "ADMIN",
    permission: "admin:system_config",
    icon: "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z",
  },
  {
    id: "settings",
    to: "/admin/settings",
    label: "Settings",
    section: "ADMIN",
    permission: "admin:system_config",
    icon: "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 8a5 5 0 1110 0A5 5 0 013 8z",
  },
  {
    id: "integrity",
    to: "/admin/integrity",
    label: "Integrity",
    section: "ADMIN",
    permission: "admin:system_config",
    icon: "M8 2l6 3v5c0 3-3 5-6 6-3-1-6-3-6-6V5l6-3z",
  },
];
