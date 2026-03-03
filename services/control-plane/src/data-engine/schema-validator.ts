/**
 * Lightweight JSON Schema validator for Data Engine function boundaries.
 *
 * Validates `type`, `required`, and nested `properties` — enough for
 * the contract-level checks the pipeline needs without pulling in ajv.
 */

import type { JsonSchema } from "./types.js";

export class SchemaValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`Schema validation failed at '${path}': ${message}`);
    this.name = "SchemaValidationError";
  }
}

export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path = "$",
): void {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new SchemaValidationError(path, `expected object, got ${typeof value}`);
    }
    const obj = value as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          throw new SchemaValidationError(path, `missing required property '${key}'`);
        }
      }
    }

    // Recurse into declared properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateJsonSchema(obj[key], propSchema, `${path}.${key}`);
        }
      }
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      throw new SchemaValidationError(path, `expected string, got ${typeof value}`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new SchemaValidationError(path, `value '${value}' not in enum [${schema.enum.join(", ")}]`);
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number") {
      throw new SchemaValidationError(path, `expected number, got ${typeof value}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new SchemaValidationError(path, `expected array, got ${typeof value}`);
    }
  }
}
