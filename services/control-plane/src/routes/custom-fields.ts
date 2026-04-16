/**
 * Custom Fields — HTTP surface for runtime-extensible entity metadata.
 *
 *   GET    /custom-fields/definitions              list all definitions
 *   GET    /custom-fields/definitions?entity=asset filter by entity type
 *   POST   /custom-fields/definitions              create a new definition
 *   GET    /custom-fields/definitions/:id          fetch a single definition
 *   PATCH  /custom-fields/definitions/:id          update display/validation
 *   DELETE /custom-fields/definitions/:id          soft-delete
 *
 *   GET    /custom-fields/values/:entity_type/:entity_id    list values
 *   PUT    /custom-fields/values/:entity_type/:entity_id    upsert values (bulk)
 *   DELETE /custom-fields/values/:entity_type/:entity_id/:name   delete one
 *
 * Definitions are authoritative: writing a value for an undefined or
 * soft-deleted field returns 400. Updates of `name`/`entityType`/`dataType`
 * are rejected — changing these would silently invalidate stored values.
 *
 * Values are validated against the definition's data_type + validation_json.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import { withPrefix } from "../http/routes.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  CUSTOM_FIELD_DATA_TYPES,
  CUSTOM_FIELD_ENTITY_TYPES,
  type CustomFieldDataType,
  type CustomFieldEntityType,
  type CustomFieldValidation,
  validateFieldName,
  validateFieldValue,
} from "../domain/custom-fields.js";

function parseValidation(json: string | null): CustomFieldValidation | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as CustomFieldValidation;
  } catch {
    return null;
  }
}

function readValueFromRecord(record: {
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  valueDate: string | null;
}, dataType: string): string | number | boolean | null {
  switch (dataType) {
    case "string":
    case "enum":
    case "ref":
      return record.valueText;
    case "number":
      return record.valueNumber;
    case "boolean":
      return record.valueBool;
    case "date":
      return record.valueDate;
  }
  return null;
}

function splitValue(
  dataType: string,
  value: unknown,
): { valueText?: string | null; valueNumber?: number | null; valueBool?: boolean | null; valueDate?: string | null } {
  if (value === null || value === undefined) {
    return { valueText: null, valueNumber: null, valueBool: null, valueDate: null };
  }
  switch (dataType) {
    case "string":
    case "enum":
    case "ref":
      return { valueText: value as string };
    case "number":
      return { valueNumber: value as number };
    case "boolean":
      return { valueBool: value as boolean };
    case "date":
      return { valueDate: value as string };
  }
  return {};
}

const definitionResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    entityType: { type: "string" },
    name: { type: "string" },
    displayLabel: { type: "string" },
    dataType: { type: "string" },
    required: { type: "boolean" },
    validation: { type: ["object", "null"], additionalProperties: true },
    displayConfig: { type: ["object", "null"], additionalProperties: true },
    description: { type: ["string", "null"] },
    createdBy: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    deletedAt: { type: ["string", "null"] },
  },
} as const;

function recordToResponse(r: {
  id: string;
  entityType: string;
  name: string;
  displayLabel: string;
  dataType: string;
  required: boolean;
  validationJson: string | null;
  displayConfigJson: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}) {
  return {
    id: r.id,
    entityType: r.entityType,
    name: r.name,
    displayLabel: r.displayLabel,
    dataType: r.dataType,
    required: r.required,
    validation: r.validationJson ? JSON.parse(r.validationJson) : null,
    displayConfig: r.displayConfigJson ? JSON.parse(r.displayConfigJson) : null,
    description: r.description,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

export async function registerCustomFieldsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix === "/api/v1" ? "v1" : "legacy";

    // ── GET /custom-fields/definitions ──
    app.get<{ Querystring: { entity?: string; include_deleted?: string } }>(
      withPrefix(prefix, "/custom-fields/definitions"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}ListCustomFieldDefinitions`,
          summary: "List custom field definitions",
          querystring: {
            type: "object",
            properties: {
              entity: { type: "string", enum: [...CUSTOM_FIELD_ENTITY_TYPES] },
              include_deleted: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                definitions: { type: "array", items: definitionResponseSchema },
              },
            },
          },
        },
      },
      async (request) => {
        const entityType = request.query.entity;
        const includeDeleted = request.query.include_deleted === "true";
        const rows = await persistence.listCustomFieldDefinitions(entityType, includeDeleted);
        return { definitions: rows.map(recordToResponse) };
      },
    );

    // ── POST /custom-fields/definitions ──
    app.post<{ Body: {
      entityType: string;
      name: string;
      displayLabel: string;
      dataType: string;
      required?: boolean;
      validation?: CustomFieldValidation | null;
      displayConfig?: Record<string, unknown> | null;
      description?: string | null;
    } }>(
      withPrefix(prefix, "/custom-fields/definitions"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}CreateCustomFieldDefinition`,
          summary: "Create a new custom field definition",
          body: {
            type: "object",
            required: ["entityType", "name", "displayLabel", "dataType"],
            properties: {
              entityType: { type: "string", enum: [...CUSTOM_FIELD_ENTITY_TYPES] },
              name: { type: "string", minLength: 1, maxLength: 64 },
              displayLabel: { type: "string", minLength: 1, maxLength: 128 },
              dataType: { type: "string", enum: [...CUSTOM_FIELD_DATA_TYPES] },
              required: { type: "boolean" },
              validation: { type: ["object", "null"], additionalProperties: true },
              displayConfig: { type: ["object", "null"], additionalProperties: true },
              description: { type: ["string", "null"], maxLength: 1000 },
            },
          },
          response: {
            201: { type: "object", properties: { definition: definitionResponseSchema } },
            400: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        const nameErr = validateFieldName(body.name);
        if (nameErr) {
          return sendError(request, reply, 400, nameErr.code, nameErr.message, {
            field: nameErr.field,
          });
        }

        const createdBy = request.identity ?? "unknown";

        try {
          const record = await persistence.createCustomFieldDefinition(
            {
              entityType: body.entityType,
              name: body.name,
              displayLabel: body.displayLabel,
              dataType: body.dataType,
              required: body.required ?? false,
              validationJson: body.validation ? JSON.stringify(body.validation) : null,
              displayConfigJson: body.displayConfig ? JSON.stringify(body.displayConfig) : null,
              description: body.description ?? null,
              createdBy,
            },
            {
              correlationId: request.id,
              now: new Date().toISOString(),
            },
          );
          return reply.status(201).send({ definition: recordToResponse(record) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("already exists")) {
            return sendError(request, reply, 409, "ALREADY_EXISTS", msg);
          }
          throw e;
        }
      },
    );

    // ── GET /custom-fields/definitions/:id ──
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/custom-fields/definitions/:id"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}GetCustomFieldDefinition`,
          summary: "Get a custom field definition",
          response: {
            200: { type: "object", properties: { definition: definitionResponseSchema } },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const record = await persistence.getCustomFieldDefinition(request.params.id);
        if (!record) {
          return sendError(request, reply, 404, "NOT_FOUND", `Definition not found: ${request.params.id}`);
        }
        return { definition: recordToResponse(record) };
      },
    );

    // ── PATCH /custom-fields/definitions/:id ──
    app.patch<{ Params: { id: string }; Body: {
      displayLabel?: string;
      required?: boolean;
      validation?: CustomFieldValidation | null;
      displayConfig?: Record<string, unknown> | null;
      description?: string | null;
    } }>(
      withPrefix(prefix, "/custom-fields/definitions/:id"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}UpdateCustomFieldDefinition`,
          summary: "Update mutable fields of a definition (label, validation, display)",
          body: {
            type: "object",
            properties: {
              displayLabel: { type: "string", minLength: 1, maxLength: 128 },
              required: { type: "boolean" },
              validation: { type: ["object", "null"], additionalProperties: true },
              displayConfig: { type: ["object", "null"], additionalProperties: true },
              description: { type: ["string", "null"], maxLength: 1000 },
            },
          },
          response: {
            200: { type: "object", properties: { definition: definitionResponseSchema } },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const updates: Record<string, unknown> = {};
        if (body.displayLabel !== undefined) updates.displayLabel = body.displayLabel;
        if (body.required !== undefined) updates.required = body.required;
        if (body.validation !== undefined) {
          updates.validationJson = body.validation ? JSON.stringify(body.validation) : null;
        }
        if (body.displayConfig !== undefined) {
          updates.displayConfigJson = body.displayConfig ? JSON.stringify(body.displayConfig) : null;
        }
        if (body.description !== undefined) updates.description = body.description;

        const record = await persistence.updateCustomFieldDefinition(
          request.params.id,
          updates as Parameters<PersistenceAdapter["updateCustomFieldDefinition"]>[1],
          { correlationId: request.id, now: new Date().toISOString() },
        );
        if (!record) {
          return sendError(request, reply, 404, "NOT_FOUND", `Definition not found or deleted: ${request.params.id}`);
        }
        return { definition: recordToResponse(record) };
      },
    );

    // ── DELETE /custom-fields/definitions/:id ──
    app.delete<{ Params: { id: string } }>(
      withPrefix(prefix, "/custom-fields/definitions/:id"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}DeleteCustomFieldDefinition`,
          summary: "Soft-delete a custom field definition (values remain readable)",
          response: {
            204: { type: "null" },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const ok = await persistence.softDeleteCustomFieldDefinition(request.params.id, {
          correlationId: request.id,
          now: new Date().toISOString(),
        });
        if (!ok) {
          return sendError(request, reply, 404, "NOT_FOUND", `Definition not found or already deleted: ${request.params.id}`);
        }
        return reply.status(204).send();
      },
    );

    // ── GET /custom-fields/values/:entity_type/:entity_id ──
    app.get<{ Params: { entity_type: string; entity_id: string } }>(
      withPrefix(prefix, "/custom-fields/values/:entity_type/:entity_id"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}GetCustomFieldValues`,
          summary: "Get all custom field values for an entity",
          response: {
            200: {
              type: "object",
              properties: {
                entityType: { type: "string" },
                entityId: { type: "string" },
                fields: { type: "object", additionalProperties: true },
              },
            },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { entity_type, entity_id } = request.params;
        if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entity_type as CustomFieldEntityType)) {
          return sendError(request, reply, 400, "INVALID_ENTITY_TYPE", `Unsupported entity type: ${entity_type}`);
        }

        const [definitions, values] = await Promise.all([
          persistence.listCustomFieldDefinitions(entity_type),
          persistence.getCustomFieldValues(entity_type, entity_id),
        ]);

        const defById = new Map(definitions.map((d) => [d.id, d]));
        const fields: Record<string, unknown> = {};
        for (const v of values) {
          const def = defById.get(v.definitionId);
          if (!def) continue; // orphaned value (deleted definition)
          fields[def.name] = readValueFromRecord(v, def.dataType);
        }

        return { entityType: entity_type, entityId: entity_id, fields };
      },
    );

    // ── PUT /custom-fields/values/:entity_type/:entity_id ──
    app.put<{
      Params: { entity_type: string; entity_id: string };
      Body: { fields: Record<string, unknown> };
    }>(
      withPrefix(prefix, "/custom-fields/values/:entity_type/:entity_id"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}SetCustomFieldValues`,
          summary: "Upsert custom field values (partial — keys not provided are unchanged)",
          body: {
            type: "object",
            required: ["fields"],
            properties: {
              fields: { type: "object", additionalProperties: true },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                entityType: { type: "string" },
                entityId: { type: "string" },
                fields: { type: "object", additionalProperties: true },
                validationErrors: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
            400: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { entity_type, entity_id } = request.params;
        if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entity_type as CustomFieldEntityType)) {
          return sendError(request, reply, 400, "INVALID_ENTITY_TYPE", `Unsupported entity type: ${entity_type}`);
        }

        const definitions = await persistence.listCustomFieldDefinitions(entity_type);
        const defByName = new Map(definitions.map((d) => [d.name, d]));

        // Validate every incoming field against its definition. Reject the
        // whole batch on any error — atomicity matters for audit clarity.
        const errors: Array<{ field: string; code: string; message: string }> = [];
        for (const [name, value] of Object.entries(request.body.fields)) {
          const def = defByName.get(name);
          if (!def) {
            errors.push({ field: name, code: "UNKNOWN_FIELD", message: `No definition for ${entity_type}.${name}` });
            continue;
          }
          const validation = parseValidation(def.validationJson);
          const domainDef = {
            id: def.id,
            entityType: def.entityType as CustomFieldEntityType,
            name: def.name,
            displayLabel: def.displayLabel,
            dataType: def.dataType as CustomFieldDataType,
            required: def.required,
            validation,
            displayConfig: null,
            description: def.description,
            createdBy: def.createdBy,
            createdAt: def.createdAt,
            updatedAt: def.updatedAt,
            deletedAt: def.deletedAt,
          };
          errors.push(...validateFieldValue(domainDef, value));
        }

        if (errors.length > 0) {
          return sendError(request, reply, 400, "VALIDATION_ERROR", "Custom field validation failed", {
            errors,
          });
        }

        const createdBy = request.identity ?? "unknown";

        // Apply — we already validated everything so this should succeed.
        for (const [name, value] of Object.entries(request.body.fields)) {
          const def = defByName.get(name)!;
          if (value === null || value === undefined) {
            await persistence.deleteCustomFieldValue(def.id, entity_type, entity_id, {
              correlationId: request.id,
              now: new Date().toISOString(),
            });
          } else {
            await persistence.setCustomFieldValue(
              {
                definitionId: def.id,
                entityType: entity_type,
                entityId: entity_id,
                createdBy,
                ...splitValue(def.dataType, value),
              },
              { correlationId: request.id, now: new Date().toISOString() },
            );
          }
        }

        // Return final state
        const allValues = await persistence.getCustomFieldValues(entity_type, entity_id);
        const defById = new Map(definitions.map((d) => [d.id, d]));
        const fields: Record<string, unknown> = {};
        for (const v of allValues) {
          const def = defById.get(v.definitionId);
          if (!def) continue;
          fields[def.name] = readValueFromRecord(v, def.dataType);
        }

        return { entityType: entity_type, entityId: entity_id, fields, validationErrors: [] };
      },
    );

    // ── DELETE /custom-fields/values/:entity_type/:entity_id/:name ──
    app.delete<{ Params: { entity_type: string; entity_id: string; name: string } }>(
      withPrefix(prefix, "/custom-fields/values/:entity_type/:entity_id/:name"),
      {
        schema: {
          tags: ["custom-fields"],
          operationId: `${opPrefix}DeleteCustomFieldValue`,
          summary: "Delete one custom field value for an entity",
          response: {
            204: { type: "null" },
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        const { entity_type, entity_id, name } = request.params;
        const definitions = await persistence.listCustomFieldDefinitions(entity_type, true);
        const def = definitions.find((d) => d.name === name);
        if (!def) {
          return sendError(request, reply, 404, "NOT_FOUND", `No definition for ${entity_type}.${name}`);
        }
        const ok = await persistence.deleteCustomFieldValue(def.id, entity_type, entity_id, {
          correlationId: request.id,
          now: new Date().toISOString(),
        });
        if (!ok) {
          return sendError(request, reply, 404, "NOT_FOUND", `No value to delete`);
        }
        return reply.status(204).send();
      },
    );
  }
}
