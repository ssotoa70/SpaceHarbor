/**
 * Workflows HTTP surface.
 *
 *   POST   /workflows                                create definition
 *   GET    /workflows                                list definitions
 *   GET    /workflows/:id                            get definition
 *   PATCH  /workflows/:id                            update (new version bump)
 *   DELETE /workflows/:id                            soft-delete
 *
 *   POST   /workflows/:name/start                    create instance (uses latest version of name)
 *   GET    /workflow-instances                       list instances
 *   GET    /workflow-instances/:id                   get instance + transitions
 *   POST   /workflow-instances/:id/transition        external event/approval decision
 *   POST   /workflow-instances/:id/cancel            cancel a running instance
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import { paginateSortedArray, parsePaginationParams, paginationQuerySchema } from "../http/pagination.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import { runWorkflowToBoundary, type WorkflowDsl } from "../workflow/engine.js";
import { workflowInstanceTotal } from "../infra/metrics.js";

function validateDsl(dsl: unknown): { ok: true; dsl: WorkflowDsl } | { ok: false; message: string } {
  if (!dsl || typeof dsl !== "object") return { ok: false, message: "dsl must be an object" };
  const d = dsl as Record<string, unknown>;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return { ok: false, message: "dsl.nodes must be a non-empty array" };
  if (!Array.isArray(d.edges)) return { ok: false, message: "dsl.edges must be an array" };
  const nodeIds = new Set<string>();
  for (const n of d.nodes) {
    const node = n as { id?: unknown; kind?: unknown };
    if (typeof node.id !== "string" || !node.id) return { ok: false, message: "every node needs a string id" };
    if (typeof node.kind !== "string") return { ok: false, message: `node ${node.id}: missing kind` };
    if (nodeIds.has(node.id)) return { ok: false, message: `duplicate node id: ${node.id}` };
    nodeIds.add(node.id);
  }
  const hasStart = d.nodes.some((n) => (n as { kind?: string }).kind === "start");
  if (!hasStart) return { ok: false, message: "dsl must include a node of kind 'start'" };
  for (const e of d.edges) {
    const edge = e as { from?: unknown; to?: unknown };
    if (typeof edge.from !== "string" || !nodeIds.has(edge.from)) return { ok: false, message: `edge.from "${String(edge.from)}" is not a known node id` };
    if (typeof edge.to !== "string" || !nodeIds.has(edge.to)) return { ok: false, message: `edge.to "${String(edge.to)}" is not a known node id` };
  }
  return { ok: true, dsl: dsl as WorkflowDsl };
}

const definitionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "integer" },
    description: { type: ["string", "null"] },
    dslJson: { type: "string" },
    enabled: { type: "boolean" },
    createdBy: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    deletedAt: { type: ["string", "null"] },
  },
} as const;

const instanceSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    definitionId: { type: "string" },
    definitionVersion: { type: "integer" },
    currentNodeId: { type: "string" },
    state: { type: "string" },
    contextJson: { type: "string" },
    startedBy: { type: "string" },
    startedAt: { type: "string" },
    updatedAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    lastError: { type: ["string", "null"] },
    parentEntityType: { type: ["string", "null"] },
    parentEntityId: { type: ["string", "null"] },
  },
} as const;

export async function registerWorkflowsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const op = prefix === "/api/v1" ? "v1" : "legacy";

    // ── Definitions ──
    app.get(
      withPrefix(prefix, "/workflows"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}ListWorkflows`,
          summary: "List workflow definitions",
          response: {
            200: { type: "object", properties: { definitions: { type: "array", items: definitionSchema } } },
          },
        },
      },
      async () => {
        const defs = await persistence.listWorkflowDefinitions();
        return { definitions: defs };
      },
    );

    app.post<{ Body: { name: string; description?: string; dsl: WorkflowDsl; enabled?: boolean } }>(
      withPrefix(prefix, "/workflows"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}CreateWorkflow`,
          summary: "Create a new workflow definition (auto-increments version per name)",
          body: {
            type: "object",
            required: ["name", "dsl"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 128 },
              description: { type: "string", maxLength: 1000 },
              dsl: { type: "object", additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: {
            201: { type: "object", properties: { definition: definitionSchema } },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const dslCheck = validateDsl(request.body.dsl);
        if (!dslCheck.ok) return sendError(request, reply, 400, "VALIDATION_ERROR", dslCheck.message);
        const def = await persistence.createWorkflowDefinition(
          {
            name: request.body.name,
            description: request.body.description,
            dslJson: JSON.stringify(dslCheck.dsl),
            enabled: request.body.enabled ?? true,
            createdBy: request.identity ?? "unknown",
          },
          { correlationId: request.id, now: new Date().toISOString() },
        );
        return reply.status(201).send({ definition: def });
      },
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/workflows/:id"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}GetWorkflow`,
          summary: "Get a workflow definition",
          response: { 200: { type: "object", properties: { definition: definitionSchema } }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const def = await persistence.getWorkflowDefinition(request.params.id);
        if (!def) return sendError(request, reply, 404, "NOT_FOUND", `Workflow not found: ${request.params.id}`);
        return { definition: def };
      },
    );

    app.patch<{ Params: { id: string }; Body: { description?: string; dsl?: WorkflowDsl; enabled?: boolean } }>(
      withPrefix(prefix, "/workflows/:id"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}UpdateWorkflow`,
          summary: "Update a workflow definition (same version — use POST to bump)",
          body: {
            type: "object",
            properties: {
              description: { type: "string", maxLength: 1000 },
              dsl: { type: "object", additionalProperties: true },
              enabled: { type: "boolean" },
            },
          },
          response: { 200: { type: "object", properties: { definition: definitionSchema } }, 404: errorEnvelopeSchema, 400: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const updates: Record<string, unknown> = {};
        if (request.body.description !== undefined) updates.description = request.body.description;
        if (request.body.enabled !== undefined) updates.enabled = request.body.enabled;
        if (request.body.dsl !== undefined) {
          const dslCheck = validateDsl(request.body.dsl);
          if (!dslCheck.ok) return sendError(request, reply, 400, "VALIDATION_ERROR", dslCheck.message);
          updates.dslJson = JSON.stringify(dslCheck.dsl);
        }
        const def = await persistence.updateWorkflowDefinition(
          request.params.id,
          updates as Parameters<PersistenceAdapter["updateWorkflowDefinition"]>[1],
          { correlationId: request.id, now: new Date().toISOString() },
        );
        if (!def) return sendError(request, reply, 404, "NOT_FOUND", `Workflow not found or deleted: ${request.params.id}`);
        return { definition: def };
      },
    );

    app.delete<{ Params: { id: string } }>(
      withPrefix(prefix, "/workflows/:id"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}DeleteWorkflow`,
          summary: "Soft-delete a workflow definition",
          response: { 204: { type: "null" }, 404: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const ok = await persistence.deleteWorkflowDefinition(request.params.id, { correlationId: request.id, now: new Date().toISOString() });
        if (!ok) return sendError(request, reply, 404, "NOT_FOUND", `Workflow not found or already deleted`);
        return reply.status(204).send();
      },
    );

    // ── Instances ──
    app.post<{ Params: { name: string }; Body: { context?: Record<string, unknown>; parentEntityType?: string; parentEntityId?: string } }>(
      withPrefix(prefix, "/workflows/:name/start"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}StartWorkflow`,
          summary: "Start a new workflow instance from the latest version of a named definition",
          body: {
            type: "object",
            properties: {
              context: { type: "object", additionalProperties: true },
              parentEntityType: { type: "string" },
              parentEntityId: { type: "string" },
            },
          },
          response: { 201: { type: "object", properties: { instance: instanceSchema } }, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const def = await persistence.getWorkflowDefinitionByName(request.params.name);
        if (!def) return sendError(request, reply, 404, "NOT_FOUND", `No workflow named "${request.params.name}"`);
        if (!def.enabled) return sendError(request, reply, 409, "DISABLED", `Workflow "${request.params.name}" is disabled`);
        const dsl = JSON.parse(def.dslJson) as WorkflowDsl;
        const startNode = dsl.nodes.find((n) => n.kind === "start");
        if (!startNode) return sendError(request, reply, 500, "INTERNAL_ERROR", "Definition has no start node");
        const instance = await persistence.createWorkflowInstance(
          {
            definitionId: def.id,
            definitionVersion: def.version,
            currentNodeId: startNode.id,
            contextJson: JSON.stringify(request.body?.context ?? {}),
            startedBy: request.identity ?? "unknown",
            parentEntityType: request.body?.parentEntityType,
            parentEntityId: request.body?.parentEntityId,
          },
          { correlationId: request.id, now: new Date().toISOString() },
        );
        workflowInstanceTotal.inc({ definition_name: def.name });
        // Drive the engine to the first wait/complete/fail
        const driven = await runWorkflowToBoundary(persistence, instance.id, request.id);
        return reply.status(201).send({ instance: driven ?? instance });
      },
    );

    app.get<{ Querystring: { definitionId?: string; state?: string; parentEntityType?: string; parentEntityId?: string; cursor?: string; limit?: string; offset?: string } }>(
      withPrefix(prefix, "/workflow-instances"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}ListWorkflowInstances`,
          summary: "List workflow instances",
          querystring: {
            type: "object",
            properties: {
              definitionId: { type: "string" },
              state: { type: "string" },
              parentEntityType: { type: "string" },
              parentEntityId: { type: "string" },
              ...paginationQuerySchema,
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                instances: { type: "array", items: instanceSchema },
                nextCursor: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      async (request) => {
        const pageParams = parsePaginationParams(request.query, { defaultLimit: 50 });
        // Fetch a superset (up to 500) then cursor-slice. The persistence
        // layer already sorts by startedAt DESC.
        const all = await persistence.listWorkflowInstances({
          definitionId: request.query.definitionId,
          state: request.query.state,
          parentEntityType: request.query.parentEntityType,
          parentEntityId: request.query.parentEntityId,
          limit: 500,
        });
        const { items, nextCursor } = paginateSortedArray(all, pageParams, (i) => `${i.startedAt}|${i.id}`);
        return { instances: items, nextCursor };
      },
    );

    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/workflow-instances/:id"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}GetWorkflowInstance`,
          summary: "Get a workflow instance + its transitions",
          response: {
            200: {
              type: "object",
              properties: {
                instance: instanceSchema,
                transitions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      fromNodeId: { type: "string" },
                      toNodeId: { type: "string" },
                      eventType: { type: ["string", "null"] },
                      actor: { type: ["string", "null"] },
                      at: { type: "string" },
                    },
                  },
                },
              },
            },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const instance = await persistence.getWorkflowInstance(request.params.id);
        if (!instance) return sendError(request, reply, 404, "NOT_FOUND", `Instance not found: ${request.params.id}`);
        const transitions = await persistence.listWorkflowTransitions(request.params.id);
        return { instance, transitions };
      },
    );

    app.post<{ Params: { id: string }; Body: { nextNodeId?: string; eventType?: string; payload?: Record<string, unknown> } }>(
      withPrefix(prefix, "/workflow-instances/:id/transition"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}TransitionWorkflowInstance`,
          summary: "Transition a waiting instance (e.g. approval decision)",
          body: {
            type: "object",
            properties: {
              nextNodeId: { type: "string" },
              eventType: { type: "string" },
              payload: { type: "object", additionalProperties: true },
            },
          },
          response: { 200: { type: "object", properties: { instance: instanceSchema } }, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const instance = await persistence.getWorkflowInstance(request.params.id);
        if (!instance) return sendError(request, reply, 404, "NOT_FOUND", `Instance not found`);
        if (instance.state === "completed" || instance.state === "failed" || instance.state === "cancelled") {
          return sendError(request, reply, 409, "TERMINAL_STATE", `Instance is ${instance.state}`);
        }
        if (request.body.nextNodeId) {
          // Explicit override — advance directly to the requested node
          await persistence.recordWorkflowTransition(
            {
              instanceId: instance.id,
              fromNodeId: instance.currentNodeId,
              toNodeId: request.body.nextNodeId,
              eventType: request.body.eventType,
              actor: request.identity ?? "unknown",
              payloadJson: request.body.payload ? JSON.stringify(request.body.payload) : undefined,
            },
            { correlationId: request.id, now: new Date().toISOString() },
          );
          const updated = await persistence.updateWorkflowInstance(
            instance.id,
            {
              currentNodeId: request.body.nextNodeId,
              state: "running",
              contextJson: instance.contextJson,
              completedAt: null,
              lastError: null,
            },
            { correlationId: request.id, now: new Date().toISOString() },
          );
          if (!updated) return sendError(request, reply, 500, "INTERNAL_ERROR", "Failed to update instance");
          // Continue driving
          const driven = await runWorkflowToBoundary(persistence, instance.id, request.id);
          return { instance: driven ?? updated };
        }
        // No explicit nextNodeId — drive from current node (handler re-evaluates wait)
        const driven = await runWorkflowToBoundary(persistence, instance.id, request.id);
        return { instance: driven ?? instance };
      },
    );

    app.post<{ Params: { id: string } }>(
      withPrefix(prefix, "/workflow-instances/:id/cancel"),
      {
        schema: {
          tags: ["workflow"],
          operationId: `${op}CancelWorkflowInstance`,
          summary: "Cancel a running workflow instance",
          response: { 200: { type: "object", properties: { instance: instanceSchema } }, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema },
        },
      },
      async (request, reply) => {
        const instance = await persistence.getWorkflowInstance(request.params.id);
        if (!instance) return sendError(request, reply, 404, "NOT_FOUND", `Instance not found`);
        if (instance.state === "completed" || instance.state === "failed" || instance.state === "cancelled") {
          return sendError(request, reply, 409, "TERMINAL_STATE", `Instance is already ${instance.state}`);
        }
        const updated = await persistence.updateWorkflowInstance(
          instance.id,
          {
            currentNodeId: instance.currentNodeId,
            state: "cancelled",
            contextJson: instance.contextJson,
            completedAt: new Date().toISOString(),
            lastError: "cancelled by user",
          },
          { correlationId: request.id, now: new Date().toISOString() },
        );
        return { instance: updated ?? instance };
      },
    );
  }
}
