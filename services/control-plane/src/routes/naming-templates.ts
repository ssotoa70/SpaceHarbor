/**
 * Naming Templates — admin REST surface for studio naming conventions.
 *
 *   GET    /naming-templates                list (filter by scope, enabled)
 *   GET    /naming-templates/:id            get one
 *   POST   /naming-templates                create
 *   PATCH  /naming-templates/:id            update template/desc/enabled
 *   DELETE /naming-templates/:id            soft-delete
 *   POST   /naming-templates/preview        render template against context
 *                                           (no persistence; used by UI live preview)
 *
 * Engine lives in src/domain/naming-template.ts. Schema lives in
 * migration 023. Soft-delete preserves audit trail.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase5.md (TBD)
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { eventBus } from "../events/bus.js";
import {
  NAMING_TEMPLATE_SCOPES,
  renderTemplate,
  tokenNames,
  validateTemplate,
} from "../domain/naming-template.js";
import type {
  NamingTemplateRecord,
  PersistenceAdapter,
} from "../persistence/types.js";

const templateResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    scope: { type: "string" },
    template: { type: "string" },
    sampleContext: { type: ["object", "null"], additionalProperties: true },
    enabled: { type: "boolean" },
    createdBy: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    deletedAt: { type: ["string", "null"] },
    tokens: { type: "array", items: { type: "string" } },
  },
} as const;

function recordToResponse(r: NamingTemplateRecord): Record<string, unknown> {
  let sampleContext: unknown = null;
  if (r.sampleContextJson) {
    try { sampleContext = JSON.parse(r.sampleContextJson); }
    catch { sampleContext = null; }
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    scope: r.scope,
    template: r.template,
    sampleContext,
    enabled: r.enabled,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    tokens: tokenNames(r.template),
  };
}

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export async function registerNamingTemplatesRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    // ── GET /naming-templates ──
    app.get<{ Querystring: { scope?: string; enabled?: string; include_deleted?: string } }>(
      withPrefix(prefix, "/naming-templates"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}ListNamingTemplates`,
          summary: "List naming templates",
          querystring: {
            type: "object",
            properties: {
              scope: { type: "string", enum: [...NAMING_TEMPLATE_SCOPES] },
              enabled: { type: "string" },
              include_deleted: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                templates: { type: "array", items: templateResponseSchema },
              },
            },
          },
        },
      },
      async (request) => {
        const filter: { scope?: string; enabled?: boolean; includeDeleted?: boolean } = {};
        if (request.query.scope) filter.scope = request.query.scope;
        if (request.query.enabled === "true") filter.enabled = true;
        if (request.query.enabled === "false") filter.enabled = false;
        if (request.query.include_deleted === "true") filter.includeDeleted = true;
        const rows = await persistence.listNamingTemplates(filter);
        return { templates: rows.map(recordToResponse) };
      },
    );

    // ── GET /naming-templates/:id ──
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/naming-templates/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}GetNamingTemplate`,
          summary: "Get a naming template",
          response: {
            200: { type: "object", properties: { template: templateResponseSchema } },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const r = await persistence.getNamingTemplate(request.params.id);
        if (!r) return sendError(request, reply, 404, "NOT_FOUND", `naming template not found: ${request.params.id}`);
        return { template: recordToResponse(r) };
      },
    );

    // ── POST /naming-templates ──
    app.post<{
      Body: {
        name: string;
        scope: string;
        template: string;
        description?: string | null;
        sampleContext?: Record<string, unknown> | null;
        enabled?: boolean;
      };
    }>(
      withPrefix(prefix, "/naming-templates"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}CreateNamingTemplate`,
          summary: "Create a new naming template",
          body: {
            type: "object",
            required: ["name", "scope", "template"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 64 },
              scope: { type: "string", enum: [...NAMING_TEMPLATE_SCOPES] },
              template: { type: "string", minLength: 1, maxLength: 2048 },
              description: { type: ["string", "null"], maxLength: 1000 },
              sampleContext: { type: ["object", "null"], additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: {
            201: { type: "object", properties: { template: templateResponseSchema } },
            400: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        if (!NAME_RE.test(body.name)) {
          return sendError(request, reply, 400, "INVALID_NAME",
            `name must match ${NAME_RE.source} (lowercase, underscores, 1-64 chars)`);
        }
        const v = validateTemplate(body.template);
        if (!v.ok) {
          return sendError(request, reply, 400, "INVALID_TEMPLATE",
            `template invalid: ${v.errors.join("; ")}`, { errors: v.errors });
        }
        const createdBy = request.identity ?? "unknown";
        try {
          const record = await persistence.createNamingTemplate(
            {
              name: body.name,
              scope: body.scope,
              template: body.template,
              description: body.description ?? null,
              sampleContextJson: body.sampleContext ? JSON.stringify(body.sampleContext) : null,
              enabled: body.enabled ?? true,
              createdBy,
            },
            { correlationId: request.id, now: new Date().toISOString() },
          );
          eventBus.publish({
            type: "naming_template.created",
            subject: `naming_template:${record.id}`,
            data: { id: record.id, scope: record.scope, name: record.name },
            actor: createdBy,
            correlationId: request.id,
          });
          return reply.status(201).send({ template: recordToResponse(record) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("already exists")) {
            return sendError(request, reply, 409, "ALREADY_EXISTS", msg);
          }
          throw e;
        }
      },
    );

    // ── PATCH /naming-templates/:id ──
    app.patch<{
      Params: { id: string };
      Body: {
        description?: string | null;
        template?: string;
        sampleContext?: Record<string, unknown> | null;
        enabled?: boolean;
      };
    }>(
      withPrefix(prefix, "/naming-templates/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}UpdateNamingTemplate`,
          summary: "Update mutable fields of a naming template",
          body: {
            type: "object",
            properties: {
              description: { type: ["string", "null"], maxLength: 1000 },
              template: { type: "string", minLength: 1, maxLength: 2048 },
              sampleContext: { type: ["object", "null"], additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: {
            200: { type: "object", properties: { template: templateResponseSchema } },
            400: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        if (body.template !== undefined) {
          const v = validateTemplate(body.template);
          if (!v.ok) {
            return sendError(request, reply, 400, "INVALID_TEMPLATE",
              `template invalid: ${v.errors.join("; ")}`, { errors: v.errors });
          }
        }
        const updates: Parameters<PersistenceAdapter["updateNamingTemplate"]>[1] = {};
        if (body.description !== undefined) updates.description = body.description;
        if (body.template !== undefined) updates.template = body.template;
        if (body.sampleContext !== undefined) {
          updates.sampleContextJson = body.sampleContext ? JSON.stringify(body.sampleContext) : null;
        }
        if (body.enabled !== undefined) updates.enabled = body.enabled;
        const record = await persistence.updateNamingTemplate(
          request.params.id,
          updates,
          { correlationId: request.id, now: new Date().toISOString() },
        );
        if (!record) {
          return sendError(request, reply, 404, "NOT_FOUND",
            `naming template not found or deleted: ${request.params.id}`);
        }
        eventBus.publish({
          type: "naming_template.updated",
          subject: `naming_template:${record.id}`,
          data: { id: record.id, scope: record.scope, name: record.name, enabled: record.enabled },
          actor: request.identity ?? "unknown",
          correlationId: request.id,
        });
        return { template: recordToResponse(record) };
      },
    );

    // ── DELETE /naming-templates/:id ──
    app.delete<{ Params: { id: string } }>(
      withPrefix(prefix, "/naming-templates/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}DeleteNamingTemplate`,
          summary: "Soft-delete a naming template",
          response: {
            204: { type: "null" },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const ok = await persistence.softDeleteNamingTemplate(request.params.id, {
          correlationId: request.id, now: new Date().toISOString(),
        });
        if (!ok) {
          return sendError(request, reply, 404, "NOT_FOUND",
            `naming template not found or already deleted: ${request.params.id}`);
        }
        eventBus.publish({
          type: "naming_template.deleted",
          subject: `naming_template:${request.params.id}`,
          data: { id: request.params.id },
          actor: request.identity ?? "unknown",
          correlationId: request.id,
        });
        return reply.status(204).send();
      },
    );

    // ── POST /naming-templates/preview ──
    // Stateless render: used by the admin UI for live preview without
    // requiring the template to be persisted yet.
    app.post<{
      Body: {
        template: string;
        context?: Record<string, unknown>;
      };
    }>(
      withPrefix(prefix, "/naming-templates/preview"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}PreviewNamingTemplate`,
          summary: "Render a naming template against a context (no persistence)",
          body: {
            type: "object",
            required: ["template"],
            properties: {
              template: { type: "string", minLength: 1, maxLength: 2048 },
              context: { type: "object", additionalProperties: true },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                rendered: { type: "string" },
                tokens: { type: "array", items: { type: "string" } },
                errors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { token: { type: "string" }, message: { type: "string" } },
                  },
                },
                validation: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    errors: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        const validation = validateTemplate(request.body.template);
        const rendered = validation.ok
          ? renderTemplate(request.body.template, request.body.context ?? {})
          : { rendered: "", errors: [] };
        return {
          rendered: rendered.rendered,
          tokens: tokenNames(request.body.template),
          errors: rendered.errors,
          validation: validation.ok
            ? { ok: true, errors: [] }
            : { ok: false, errors: validation.errors },
        };
      },
    );
  }
}
