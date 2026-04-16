/**
 * Triggers — admin-editable automation rules.
 *
 *   GET    /triggers                list all triggers
 *   GET    /triggers/:id            get one
 *   POST   /triggers                create
 *   PATCH  /triggers/:id            update
 *   DELETE /triggers/:id            delete
 *
 * Related: routes/webhooks.ts (outbound endpoints + inbound handler),
 * automation/trigger-consumer.ts (runtime event processor).
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { paginateSortedArray, parsePaginationParams, paginationQuerySchema } from "../http/pagination.js";
import type { PersistenceAdapter, TriggerActionKind } from "../persistence/types.js";

const ACTION_KINDS: TriggerActionKind[] = [
  "http_call",
  "enqueue_job",
  "run_workflow",
  "run_script",
  "post_event",
];

const triggerResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    eventSelector: { type: "string" },
    conditionJson: { type: ["string", "null"] },
    actionKind: { type: "string" },
    actionConfigJson: { type: "string" },
    enabled: { type: "boolean" },
    createdBy: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    lastFiredAt: { type: ["string", "null"] },
    fireCount: { type: "integer" },
  },
} as const;

export async function registerTriggersRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    app.get<{ Querystring: { enabled?: string; cursor?: string; limit?: string; offset?: string } }>(
      withPrefix(prefix, "/triggers"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}ListTriggers`,
          summary: "List all triggers",
          querystring: {
            type: "object",
            properties: {
              enabled: { type: "string" },
              ...paginationQuerySchema,
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                triggers: { type: "array", items: triggerResponseSchema },
                nextCursor: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      async (request) => {
        const filter: { enabled?: boolean } = {};
        if (request.query.enabled === "true") filter.enabled = true;
        if (request.query.enabled === "false") filter.enabled = false;
        const pageParams = parsePaginationParams(request.query, { defaultLimit: 50 });
        const all = await persistence.listTriggers(filter);
        // Sort DESC by createdAt for cursor pagination
        all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const { items, nextCursor } = paginateSortedArray(all, pageParams, (t) => `${t.createdAt}|${t.id}`);
        return { triggers: items, nextCursor };
      },
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/triggers/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}GetTrigger`,
          summary: "Get a trigger by ID",
          response: { 200: { type: "object", properties: { trigger: triggerResponseSchema } }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const t = await persistence.getTrigger(request.params.id);
        if (!t) return sendError(request, reply, 404, "NOT_FOUND", `Trigger not found: ${request.params.id}`);
        return { trigger: t };
      },
    );

    app.post<{ Body: {
      name: string;
      description?: string;
      eventSelector: string;
      conditionJson?: string;
      actionKind: TriggerActionKind;
      actionConfig: Record<string, unknown>;
      enabled?: boolean;
    } }>(
      withPrefix(prefix, "/triggers"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}CreateTrigger`,
          summary: "Create a new trigger",
          body: {
            type: "object",
            required: ["name", "eventSelector", "actionKind", "actionConfig"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 128 },
              description: { type: "string", maxLength: 1000 },
              eventSelector: { type: "string", minLength: 1, maxLength: 255 },
              conditionJson: { type: "string", maxLength: 4000 },
              actionKind: { type: "string", enum: ACTION_KINDS as readonly string[] },
              actionConfig: { type: "object", additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: { 201: { type: "object", properties: { trigger: triggerResponseSchema } }, 400: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const trigger = await persistence.createTrigger(
          {
            name: body.name,
            description: body.description,
            eventSelector: body.eventSelector,
            conditionJson: body.conditionJson,
            actionKind: body.actionKind,
            actionConfigJson: JSON.stringify(body.actionConfig),
            enabled: body.enabled ?? true,
            createdBy: request.identity ?? "unknown",
          },
          { correlationId: request.id, now: new Date().toISOString() },
        );
        return reply.status(201).send({ trigger });
      },
    );

    app.patch<{ Params: { id: string }; Body: {
      name?: string;
      description?: string;
      eventSelector?: string;
      conditionJson?: string;
      actionKind?: TriggerActionKind;
      actionConfig?: Record<string, unknown>;
      enabled?: boolean;
    } }>(
      withPrefix(prefix, "/triggers/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}UpdateTrigger`,
          summary: "Update a trigger",
          body: {
            type: "object",
            properties: {
              name: { type: "string", maxLength: 128 },
              description: { type: "string", maxLength: 1000 },
              eventSelector: { type: "string", maxLength: 255 },
              conditionJson: { type: "string", maxLength: 4000 },
              actionKind: { type: "string", enum: ACTION_KINDS as readonly string[] },
              actionConfig: { type: "object", additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: { 200: { type: "object", properties: { trigger: triggerResponseSchema } }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = body.name;
        if (body.description !== undefined) updates.description = body.description;
        if (body.eventSelector !== undefined) updates.eventSelector = body.eventSelector;
        if (body.conditionJson !== undefined) updates.conditionJson = body.conditionJson;
        if (body.actionKind !== undefined) updates.actionKind = body.actionKind;
        if (body.actionConfig !== undefined) updates.actionConfigJson = JSON.stringify(body.actionConfig);
        if (body.enabled !== undefined) updates.enabled = body.enabled;
        const trigger = await persistence.updateTrigger(
          request.params.id,
          updates as Parameters<PersistenceAdapter["updateTrigger"]>[1],
          { correlationId: request.id, now: new Date().toISOString() },
        );
        if (!trigger) return sendError(request, reply, 404, "NOT_FOUND", `Trigger not found: ${request.params.id}`);
        return { trigger };
      },
    );

    app.delete<{ Params: { id: string } }>(
      withPrefix(prefix, "/triggers/:id"),
      {
        schema: {
          tags: ["automation"],
          operationId: `${op}DeleteTrigger`,
          summary: "Delete a trigger",
          response: { 204: { type: "null" }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const ok = await persistence.deleteTrigger(request.params.id, { correlationId: request.id, now: new Date().toISOString() });
        if (!ok) return sendError(request, reply, 404, "NOT_FOUND", `Trigger not found: ${request.params.id}`);
        return reply.status(204).send();
      },
    );
  }
}
