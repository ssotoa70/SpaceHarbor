/**
 * Plugins — export/import portable JSON bundles of automation resources.
 *
 *   GET  /plugins/export      bundle current automation config
 *                             query: include[]=namingTemplates,workflows,…
 *                                    (default: all)
 *                                    name, version, description, author
 *   POST /plugins/preview     dry-run import — returns what would happen
 *   POST /plugins/import      apply the import; returns ImportReport
 *                             body: { bundle, strategy?: "skip" | "rename" }
 *
 * Webhook secrets are NOT exported (deployment-local). On import each webhook
 * gets a freshly generated secret, returned once in the ImportReport's
 * `generatedSecret` field — surface it to the user before navigating away.
 *
 * Domain helpers in src/domain/plugin-bundle.ts.
 */

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { eventBus } from "../events/bus.js";
import type {
  PersistenceAdapter,
  TriggerActionKind,
  WriteContext,
} from "../persistence/types.js";
import {
  CONFLICT_STRATEGIES,
  PLUGIN_BUNDLE_SCHEMA_VERSION,
  RESOURCE_TYPES,
  appendRecord,
  emptyReport,
  renameForImport,
  stripCustomField,
  stripNamingTemplate,
  stripTrigger,
  stripWebhook,
  stripWorkflow,
  validatePluginBundle,
  type ConflictStrategy,
  type ImportReport,
  type PluginBundle,
  type ResourceType,
} from "../domain/plugin-bundle.js";

const SYSTEM_VERSION = process.env.SPACEHARBOR_VERSION ?? "dev";

function generateWebhookSecret(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    hash: createHash("sha256").update(plaintext).digest("hex"),
    prefix: plaintext.slice(0, 8),
  };
}

const importReportSchema = {
  type: "object",
  properties: {
    dryRun: { type: "boolean" },
    strategy: { type: "string" },
    schemaVersion: { type: "integer" },
    bundleName: { type: "string" },
    bundleVersion: { type: "string" },
    totals: {
      type: "object",
      properties: {
        created: { type: "integer" },
        skipped: { type: "integer" },
        renamed: { type: "integer" },
        failed: { type: "integer" },
      },
    },
    records: {
      type: "array",
      items: {
        type: "object",
        properties: {
          resourceType: { type: "string" },
          key: { type: "string" },
          outcome: { type: "string" },
          finalName: { type: "string" },
          originalName: { type: "string" },
          message: { type: "string" },
          generatedSecret: {
            type: "object",
            properties: {
              name: { type: "string" },
              secret: { type: "string" },
              prefix: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export async function registerPluginsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    // ── GET /plugins/export ──
    app.get<{
      Querystring: {
        include?: string | string[];
        name?: string;
        version?: string;
        description?: string;
        author?: string;
      };
    }>(
      withPrefix(prefix, "/plugins/export"),
      {
        schema: {
          tags: ["plugins"],
          operationId: `${op}ExportPlugin`,
          summary: "Export automation resources as a portable plugin bundle",
          querystring: {
            type: "object",
            properties: {
              include: {
                anyOf: [
                  { type: "string" },
                  { type: "array", items: { type: "string" } },
                ],
              },
              name: { type: "string", maxLength: 128 },
              version: { type: "string", maxLength: 64 },
              description: { type: "string", maxLength: 1000 },
              author: { type: "string", maxLength: 128 },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                bundle: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      async (request) => {
        const includeRaw = request.query.include;
        const includeList = Array.isArray(includeRaw)
          ? includeRaw
          : includeRaw
          ? includeRaw.split(",")
          : [];
        const include = new Set<ResourceType>(
          (includeList.length === 0 ? [...RESOURCE_TYPES] : includeList) as ResourceType[],
        );

        const bundle: PluginBundle = {
          schemaVersion: PLUGIN_BUNDLE_SCHEMA_VERSION,
          name: request.query.name ?? "spaceharbor-export",
          version: request.query.version ?? "1.0.0",
          description: request.query.description ?? null,
          author: request.query.author ?? request.identity ?? null,
          exportedAt: new Date().toISOString(),
          exportedFrom: { system: "spaceharbor", version: SYSTEM_VERSION },
          resources: {},
        };

        if (include.has("namingTemplates")) {
          const rows = await persistence.listNamingTemplates();
          bundle.resources.namingTemplates = rows.map(stripNamingTemplate);
        }
        if (include.has("customFields")) {
          const rows = await persistence.listCustomFieldDefinitions();
          bundle.resources.customFields = rows.map(stripCustomField);
        }
        if (include.has("triggers")) {
          const rows = await persistence.listTriggers();
          bundle.resources.triggers = rows.map(stripTrigger);
        }
        if (include.has("workflows")) {
          const rows = await persistence.listWorkflowDefinitions();
          bundle.resources.workflows = rows.map(stripWorkflow);
        }
        if (include.has("webhooks")) {
          const rows = await persistence.listWebhookEndpoints();
          bundle.resources.webhooks = rows.map(stripWebhook);
        }

        return { bundle };
      },
    );

    // ── POST /plugins/preview ──
    app.post<{ Body: { bundle: unknown; strategy?: ConflictStrategy } }>(
      withPrefix(prefix, "/plugins/preview"),
      {
        schema: {
          tags: ["plugins"],
          operationId: `${op}PreviewPluginImport`,
          summary: "Dry-run a plugin import — surfaces conflicts without writing",
          body: {
            type: "object",
            required: ["bundle"],
            properties: {
              bundle: { type: "object", additionalProperties: true },
              strategy: { type: "string", enum: [...CONFLICT_STRATEGIES] },
            },
          },
          response: {
            200: { type: "object", properties: { report: importReportSchema } },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const v = validatePluginBundle(request.body.bundle);
        if (!v.ok) return sendError(request, reply, 400, "INVALID_BUNDLE", v.errors.join("; "), { errors: v.errors });
        const strategy = request.body.strategy ?? "skip";
        const report = await runImport(persistence, v.bundle, strategy, true, {
          correlationId: request.id,
          now: new Date().toISOString(),
        }, request.identity ?? "unknown");
        return { report };
      },
    );

    // ── POST /plugins/import ──
    app.post<{ Body: { bundle: unknown; strategy?: ConflictStrategy } }>(
      withPrefix(prefix, "/plugins/import"),
      {
        schema: {
          tags: ["plugins"],
          operationId: `${op}ImportPlugin`,
          summary: "Apply a plugin import (writes resources to the system)",
          body: {
            type: "object",
            required: ["bundle"],
            properties: {
              bundle: { type: "object", additionalProperties: true },
              strategy: { type: "string", enum: [...CONFLICT_STRATEGIES] },
            },
          },
          response: {
            200: { type: "object", properties: { report: importReportSchema } },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const v = validatePluginBundle(request.body.bundle);
        if (!v.ok) return sendError(request, reply, 400, "INVALID_BUNDLE", v.errors.join("; "), { errors: v.errors });
        const strategy = request.body.strategy ?? "skip";
        const report = await runImport(persistence, v.bundle, strategy, false, {
          correlationId: request.id,
          now: new Date().toISOString(),
        }, request.identity ?? "unknown");
        eventBus.publish({
          type: "plugin.imported",
          subject: `plugin:${v.bundle.name}@${v.bundle.version}`,
          data: {
            name: v.bundle.name,
            version: v.bundle.version,
            totals: report.totals,
          },
          actor: request.identity ?? "unknown",
          correlationId: request.id,
        });
        return { report };
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Import driver — walks the bundle, resolves conflicts, writes through
// persistence. dryRun: true skips persistence calls but still computes
// what would happen.
// ─────────────────────────────────────────────────────────────────────────

async function runImport(
  persistence: PersistenceAdapter,
  bundle: PluginBundle,
  strategy: ConflictStrategy,
  dryRun: boolean,
  ctx: WriteContext,
  createdBy: string,
): Promise<ImportReport> {
  const report = emptyReport(strategy, dryRun, bundle);

  // Naming templates — uniqueness: scope+name
  if (bundle.resources.namingTemplates) {
    const existing = await persistence.listNamingTemplates();
    const seen = new Set(existing.map((r) => `${r.scope}:${r.name}`));
    for (const t of bundle.resources.namingTemplates) {
      const key = `${t.scope}:${t.name}`;
      if (seen.has(key)) {
        if (strategy === "skip") {
          appendRecord(report, { resourceType: "namingTemplates", key, outcome: "skipped", finalName: t.name, message: "name already exists in this scope" });
          continue;
        }
        const newName = renameForImport(t.name, bundle.exportedAt);
        if (!dryRun) {
          try {
            await persistence.createNamingTemplate({
              name: newName, scope: t.scope, template: t.template,
              description: t.description ?? null,
              sampleContextJson: t.sampleContext ? JSON.stringify(t.sampleContext) : null,
              enabled: t.enabled,
              createdBy,
            }, ctx);
          } catch (e) {
            appendRecord(report, { resourceType: "namingTemplates", key, outcome: "failed", originalName: t.name, finalName: newName, message: String(e) });
            continue;
          }
        }
        appendRecord(report, { resourceType: "namingTemplates", key, outcome: "renamed", originalName: t.name, finalName: newName });
        continue;
      }
      if (!dryRun) {
        try {
          await persistence.createNamingTemplate({
            name: t.name, scope: t.scope, template: t.template,
            description: t.description ?? null,
            sampleContextJson: t.sampleContext ? JSON.stringify(t.sampleContext) : null,
            enabled: t.enabled,
            createdBy,
          }, ctx);
        } catch (e) {
          appendRecord(report, { resourceType: "namingTemplates", key, outcome: "failed", finalName: t.name, message: String(e) });
          continue;
        }
      }
      appendRecord(report, { resourceType: "namingTemplates", key, outcome: "created", finalName: t.name });
    }
  }

  // Custom fields — uniqueness: entityType+name (immutable, can't rename)
  if (bundle.resources.customFields) {
    const existing = await persistence.listCustomFieldDefinitions();
    const seen = new Set(existing.map((r) => `${r.entityType}.${r.name}`));
    for (const f of bundle.resources.customFields) {
      const key = `${f.entityType}.${f.name}`;
      if (seen.has(key)) {
        // Rename strategy doesn't apply: custom-field names are part of
        // the API contract for downstream consumers (entity values keyed
        // by name). Always skip on conflict.
        appendRecord(report, { resourceType: "customFields", key, outcome: "skipped", finalName: f.name, message: "definition already exists for this entityType" });
        continue;
      }
      if (!dryRun) {
        try {
          await persistence.createCustomFieldDefinition({
            entityType: f.entityType,
            name: f.name,
            displayLabel: f.displayLabel,
            dataType: f.dataType,
            required: f.required,
            validationJson: f.validation ? JSON.stringify(f.validation) : null,
            displayConfigJson: f.displayConfig ? JSON.stringify(f.displayConfig) : null,
            description: f.description ?? null,
            createdBy,
          }, ctx);
        } catch (e) {
          appendRecord(report, { resourceType: "customFields", key, outcome: "failed", finalName: f.name, message: String(e) });
          continue;
        }
      }
      appendRecord(report, { resourceType: "customFields", key, outcome: "created", finalName: f.name });
    }
  }

  // Triggers — uniqueness: name
  if (bundle.resources.triggers) {
    const existing = await persistence.listTriggers();
    const seen = new Set(existing.map((r) => r.name));
    for (const t of bundle.resources.triggers) {
      const key = t.name;
      if (seen.has(key)) {
        if (strategy === "skip") {
          appendRecord(report, { resourceType: "triggers", key, outcome: "skipped", finalName: t.name, message: "name already exists" });
          continue;
        }
        const newName = renameForImport(t.name, bundle.exportedAt);
        if (!dryRun) {
          try {
            await persistence.createTrigger({
              name: newName,
              description: t.description ?? undefined,
              eventSelector: t.eventSelector,
              conditionJson: t.condition ? JSON.stringify(t.condition) : undefined,
              actionKind: t.actionKind as TriggerActionKind,
              actionConfigJson: JSON.stringify(t.actionConfig),
              enabled: t.enabled,
              createdBy,
            }, ctx);
          } catch (e) {
            appendRecord(report, { resourceType: "triggers", key, outcome: "failed", originalName: t.name, finalName: newName, message: String(e) });
            continue;
          }
        }
        appendRecord(report, { resourceType: "triggers", key, outcome: "renamed", originalName: t.name, finalName: newName });
        continue;
      }
      if (!dryRun) {
        try {
          await persistence.createTrigger({
            name: t.name,
            description: t.description ?? undefined,
            eventSelector: t.eventSelector,
            conditionJson: t.condition ? JSON.stringify(t.condition) : undefined,
            actionKind: t.actionKind as TriggerActionKind,
            actionConfigJson: JSON.stringify(t.actionConfig),
            enabled: t.enabled,
            createdBy,
          }, ctx);
        } catch (e) {
          appendRecord(report, { resourceType: "triggers", key, outcome: "failed", finalName: t.name, message: String(e) });
          continue;
        }
      }
      appendRecord(report, { resourceType: "triggers", key, outcome: "created", finalName: t.name });
    }
  }

  // Workflows — uniqueness: name (always v1 on import)
  if (bundle.resources.workflows) {
    const existing = await persistence.listWorkflowDefinitions();
    const seen = new Set(existing.map((r) => r.name));
    for (const w of bundle.resources.workflows) {
      const key = w.name;
      if (seen.has(key)) {
        if (strategy === "skip") {
          appendRecord(report, { resourceType: "workflows", key, outcome: "skipped", finalName: w.name, message: "name already exists (use the workflow update endpoint to bump version)" });
          continue;
        }
        const newName = renameForImport(w.name, bundle.exportedAt);
        if (!dryRun) {
          try {
            await persistence.createWorkflowDefinition({
              name: newName,
              description: w.description ?? undefined,
              dslJson: JSON.stringify(w.dsl),
              enabled: w.enabled,
              createdBy,
            }, ctx);
          } catch (e) {
            appendRecord(report, { resourceType: "workflows", key, outcome: "failed", originalName: w.name, finalName: newName, message: String(e) });
            continue;
          }
        }
        appendRecord(report, { resourceType: "workflows", key, outcome: "renamed", originalName: w.name, finalName: newName });
        continue;
      }
      if (!dryRun) {
        try {
          await persistence.createWorkflowDefinition({
            name: w.name,
            description: w.description ?? undefined,
            dslJson: JSON.stringify(w.dsl),
            enabled: w.enabled,
            createdBy,
          }, ctx);
        } catch (e) {
          appendRecord(report, { resourceType: "workflows", key, outcome: "failed", finalName: w.name, message: String(e) });
          continue;
        }
      }
      appendRecord(report, { resourceType: "workflows", key, outcome: "created", finalName: w.name });
    }
  }

  // Webhooks — uniqueness: name. Always generates a fresh secret.
  if (bundle.resources.webhooks) {
    const existing = await persistence.listWebhookEndpoints({ includeRevoked: true });
    const seen = new Set(existing.map((r) => r.name));
    for (const w of bundle.resources.webhooks) {
      const key = w.name;
      if (seen.has(key)) {
        if (strategy === "skip") {
          appendRecord(report, { resourceType: "webhooks", key, outcome: "skipped", finalName: w.name, message: "name already exists" });
          continue;
        }
        const newName = renameForImport(w.name, bundle.exportedAt);
        const sec = generateWebhookSecret();
        if (!dryRun) {
          try {
            await persistence.createWebhookEndpoint({
              name: newName,
              direction: w.direction,
              url: w.url ?? undefined,
              secretHash: sec.hash,
              secretPrefix: sec.prefix,
              signingAlgorithm: "hmac-sha256",
              allowedEventTypes: w.allowedEventTypes ?? undefined,
              description: w.description ?? undefined,
              createdBy,
            }, ctx);
          } catch (e) {
            appendRecord(report, { resourceType: "webhooks", key, outcome: "failed", originalName: w.name, finalName: newName, message: String(e) });
            continue;
          }
        }
        appendRecord(report, {
          resourceType: "webhooks", key, outcome: "renamed",
          originalName: w.name, finalName: newName,
          ...(dryRun ? {} : { generatedSecret: { name: newName, secret: sec.plaintext, prefix: sec.prefix } }),
        });
        continue;
      }
      const sec = generateWebhookSecret();
      if (!dryRun) {
        try {
          await persistence.createWebhookEndpoint({
            name: w.name,
            direction: w.direction,
            url: w.url ?? undefined,
            secretHash: sec.hash,
            secretPrefix: sec.prefix,
            signingAlgorithm: "hmac-sha256",
            allowedEventTypes: w.allowedEventTypes ?? undefined,
            description: w.description ?? undefined,
            createdBy,
          }, ctx);
        } catch (e) {
          appendRecord(report, { resourceType: "webhooks", key, outcome: "failed", finalName: w.name, message: String(e) });
          continue;
        }
      }
      appendRecord(report, {
        resourceType: "webhooks", key, outcome: "created", finalName: w.name,
        ...(dryRun ? {} : { generatedSecret: { name: w.name, secret: sec.plaintext, prefix: sec.prefix } }),
      });
    }
  }

  return report;
}
