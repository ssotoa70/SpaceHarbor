/**
 * Plugin bundle — portable JSON envelope of automation resources.
 *
 * A "plugin" is a self-contained snapshot of {namingTemplates, customFields,
 * triggers, workflows, webhooks} that admins can export from one SpaceHarbor
 * deployment and import into another. Round-trip is name-keyed: each
 * resource's identity is its (scope, name) tuple, not its id, so importing
 * onto a system that already has a same-named resource triggers conflict
 * resolution (skip or rename).
 *
 * What's NOT included:
 *   - System fields (id, createdAt, updatedAt, createdBy, deletedAt) — these
 *     are reset on import.
 *   - Webhook secrets — `secretHash`/`secretPrefix` are deployment-local; the
 *     import path generates a fresh secret and returns it once.
 *   - Workflow versions — the importer creates v1 of each named workflow on
 *     the target system (use the workflow update endpoint to bump versions).
 *
 * Cross-resource references (e.g. a trigger that points at a workflow by
 * name) are not validated at import time; downstream runtime validation
 * surfaces them when the trigger fires.
 *
 * This module is pure (no I/O). The route layer composes these helpers
 * with the persistence adapter.
 */

export const PLUGIN_BUNDLE_SCHEMA_VERSION = 1;

export type ResourceType =
  | "namingTemplates"
  | "customFields"
  | "triggers"
  | "workflows"
  | "webhooks";

export const RESOURCE_TYPES: readonly ResourceType[] = [
  "namingTemplates",
  "customFields",
  "triggers",
  "workflows",
  "webhooks",
];

export interface ExportedNamingTemplate {
  name: string;
  scope: string;
  template: string;
  description: string | null;
  sampleContext: Record<string, unknown> | null;
  enabled: boolean;
}

export interface ExportedCustomField {
  entityType: string;
  name: string;
  displayLabel: string;
  dataType: string;
  required: boolean;
  validation: Record<string, unknown> | null;
  displayConfig: Record<string, unknown> | null;
  description: string | null;
}

export interface ExportedTrigger {
  name: string;
  description: string | null;
  eventSelector: string;
  condition: Record<string, unknown> | null;
  actionKind: string;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
}

export interface ExportedWorkflow {
  name: string;
  description: string | null;
  dsl: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
}

export interface ExportedWebhook {
  name: string;
  direction: "inbound" | "outbound";
  url: string | null;
  signingAlgorithm: string;
  allowedEventTypes: string[] | null;
  description: string | null;
}

export interface PluginBundleResources {
  namingTemplates?: ExportedNamingTemplate[];
  customFields?: ExportedCustomField[];
  triggers?: ExportedTrigger[];
  workflows?: ExportedWorkflow[];
  webhooks?: ExportedWebhook[];
}

export interface PluginBundle {
  schemaVersion: typeof PLUGIN_BUNDLE_SCHEMA_VERSION;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  exportedAt: string;
  exportedFrom?: { system: string; version?: string };
  resources: PluginBundleResources;
}

export type ConflictStrategy = "skip" | "rename";

export const CONFLICT_STRATEGIES: readonly ConflictStrategy[] = ["skip", "rename"];

export type ImportOutcome = "created" | "skipped" | "renamed" | "failed";

export interface ImportRecord {
  resourceType: ResourceType;
  // Stable identifier from the bundle, e.g. "asset_filename:studio_default"
  // for naming templates; "asset.show_code" for custom fields.
  key: string;
  outcome: ImportOutcome;
  // For created/renamed: the final name written to the system.
  finalName?: string;
  // For renamed: the original name (before suffix).
  originalName?: string;
  // For failed/skipped: explanation.
  message?: string;
  // Optional secret material (webhooks only) — surfaced once at import time.
  generatedSecret?: { name: string; secret: string; prefix: string };
}

export interface ImportReport {
  dryRun: boolean;
  strategy: ConflictStrategy;
  schemaVersion: number;
  bundleName: string;
  bundleVersion: string;
  totals: {
    created: number;
    skipped: number;
    renamed: number;
    failed: number;
  };
  records: ImportRecord[];
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

export function validatePluginBundle(
  raw: unknown,
): { ok: true; bundle: PluginBundle } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["bundle must be a JSON object"] };
  }
  const b = raw as Record<string, unknown>;

  if (b.schemaVersion !== PLUGIN_BUNDLE_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${String(b.schemaVersion)} (expected ${PLUGIN_BUNDLE_SCHEMA_VERSION})`);
  }
  if (typeof b.name !== "string" || !b.name.trim()) errors.push("name must be a non-empty string");
  if (typeof b.version !== "string" || !b.version.trim()) errors.push("version must be a non-empty string");
  if (b.exportedAt !== undefined && typeof b.exportedAt !== "string") errors.push("exportedAt must be a string if present");
  if (!b.resources || typeof b.resources !== "object" || Array.isArray(b.resources)) {
    errors.push("resources must be an object");
  } else {
    const r = b.resources as Record<string, unknown>;
    for (const key of Object.keys(r)) {
      if (!RESOURCE_TYPES.includes(key as ResourceType)) {
        errors.push(`resources.${key}: unknown resource type (allowed: ${RESOURCE_TYPES.join(", ")})`);
        continue;
      }
      if (!Array.isArray(r[key])) {
        errors.push(`resources.${key} must be an array`);
        continue;
      }
      const arr = r[key] as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const itemErrors = validateResource(key as ResourceType, arr[i]);
        for (const e of itemErrors) errors.push(`resources.${key}[${i}]: ${e}`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  // Cast is safe — every check above narrows shape per ResourceType.
  return { ok: true, bundle: raw as PluginBundle };
}

function validateResource(type: ResourceType, item: unknown): string[] {
  const errors: string[] = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return ["must be an object"];
  }
  const r = item as Record<string, unknown>;
  switch (type) {
    case "namingTemplates":
      if (typeof r.name !== "string" || !r.name) errors.push("name required");
      if (typeof r.scope !== "string" || !r.scope) errors.push("scope required");
      if (typeof r.template !== "string" || !r.template) errors.push("template required");
      break;
    case "customFields":
      if (typeof r.entityType !== "string") errors.push("entityType required");
      if (typeof r.name !== "string") errors.push("name required");
      if (typeof r.displayLabel !== "string") errors.push("displayLabel required");
      if (typeof r.dataType !== "string") errors.push("dataType required");
      break;
    case "triggers":
      if (typeof r.name !== "string") errors.push("name required");
      if (typeof r.eventSelector !== "string") errors.push("eventSelector required");
      if (typeof r.actionKind !== "string") errors.push("actionKind required");
      if (!r.actionConfig || typeof r.actionConfig !== "object") errors.push("actionConfig must be an object");
      break;
    case "workflows":
      if (typeof r.name !== "string") errors.push("name required");
      if (!r.dsl || typeof r.dsl !== "object") errors.push("dsl must be an object");
      break;
    case "webhooks":
      if (typeof r.name !== "string") errors.push("name required");
      if (r.direction !== "inbound" && r.direction !== "outbound") {
        errors.push(`direction must be "inbound" or "outbound"`);
      }
      break;
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────
// Strip helpers — Record → Exported (drops system fields)
// ─────────────────────────────────────────────────────────────────────────

export function stripNamingTemplate(r: {
  name: string; scope: string; template: string;
  description: string | null; sampleContextJson: string | null; enabled: boolean;
}): ExportedNamingTemplate {
  return {
    name: r.name,
    scope: r.scope,
    template: r.template,
    description: r.description,
    sampleContext: parseJsonOrNull(r.sampleContextJson),
    enabled: r.enabled,
  };
}

export function stripCustomField(r: {
  entityType: string; name: string; displayLabel: string; dataType: string;
  required: boolean; validationJson: string | null; displayConfigJson: string | null;
  description: string | null;
}): ExportedCustomField {
  return {
    entityType: r.entityType,
    name: r.name,
    displayLabel: r.displayLabel,
    dataType: r.dataType,
    required: r.required,
    validation: parseJsonOrNull(r.validationJson),
    displayConfig: parseJsonOrNull(r.displayConfigJson),
    description: r.description,
  };
}

export function stripTrigger(r: {
  name: string; description: string | null;
  eventSelector: string; conditionJson: string | null;
  actionKind: string; actionConfigJson: string; enabled: boolean;
}): ExportedTrigger {
  return {
    name: r.name,
    description: r.description,
    eventSelector: r.eventSelector,
    condition: parseJsonOrNull(r.conditionJson),
    actionKind: r.actionKind,
    actionConfig: (parseJsonOrNull(r.actionConfigJson) as Record<string, unknown> | null) ?? {},
    enabled: r.enabled,
  };
}

export function stripWorkflow(r: {
  name: string; description: string | null; dslJson: string; enabled: boolean;
}): ExportedWorkflow {
  let dsl: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(r.dslJson);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      dsl = parsed;
    }
  } catch { /* leave default */ }
  return {
    name: r.name,
    description: r.description,
    dsl,
    enabled: r.enabled,
  };
}

export function stripWebhook(r: {
  name: string; direction: "inbound" | "outbound"; url: string | null;
  signingAlgorithm: string; allowedEventTypes: string[] | null; description: string | null;
}): ExportedWebhook {
  return {
    name: r.name,
    direction: r.direction,
    url: r.url,
    signingAlgorithm: r.signingAlgorithm,
    allowedEventTypes: r.allowedEventTypes,
    description: r.description,
  };
}

function parseJsonOrNull(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Conflict resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pick a non-colliding name for a renamed import. The rename suffix is
 * deterministic per (originalName, exportedAt) so the same bundle imported
 * twice produces the same suffix — useful when comparing two imports.
 */
export function renameForImport(originalName: string, bundleExportedAt: string): string {
  const stamp = bundleExportedAt.replace(/[^0-9]/g, "").slice(0, 12) || "import";
  return `${originalName}__imported_${stamp}`;
}

export function emptyReport(strategy: ConflictStrategy, dryRun: boolean, bundle: PluginBundle): ImportReport {
  return {
    dryRun,
    strategy,
    schemaVersion: bundle.schemaVersion,
    bundleName: bundle.name,
    bundleVersion: bundle.version,
    totals: { created: 0, skipped: 0, renamed: 0, failed: 0 },
    records: [],
  };
}

export function appendRecord(report: ImportReport, record: ImportRecord): void {
  report.records.push(record);
  switch (record.outcome) {
    case "created": report.totals.created++; break;
    case "skipped": report.totals.skipped++; break;
    case "renamed": report.totals.renamed++; break;
    case "failed":  report.totals.failed++;  break;
  }
}
