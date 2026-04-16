/**
 * Custom Fields — runtime-extensible entity metadata.
 *
 * See migration 016 (custom_field_definitions + custom_field_values) for schema.
 * See routes/custom-fields.ts for HTTP surface.
 */

export const CUSTOM_FIELD_ENTITY_TYPES = [
  "asset",
  "version",
  "shot",
  "sequence",
  "project",
  "material",
] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_DATA_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "ref",
] as const;

export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];

export interface CustomFieldValidation {
  /** enum: list of allowed string values */
  allowed_values?: string[];
  /** string: max length (characters) */
  max_length?: number;
  /** number: inclusive min/max */
  min?: number;
  max?: number;
  /** ref: target entity type */
  ref_entity_type?: CustomFieldEntityType;
  /** regex — applied to `string` values if set */
  pattern?: string;
}

export interface CustomFieldDisplayConfig {
  group?: string;
  order?: number;
  placeholder?: string;
  helpText?: string;
}

export interface CustomFieldDefinition {
  id: string;
  entityType: CustomFieldEntityType;
  name: string;
  displayLabel: string;
  dataType: CustomFieldDataType;
  required: boolean;
  validation: CustomFieldValidation | null;
  displayConfig: CustomFieldDisplayConfig | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CustomFieldValue {
  id: string;
  definitionId: string;
  entityType: CustomFieldEntityType;
  entityId: string;
  value: string | number | boolean | null; // Date serialized as ISO string
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CustomFieldMap = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Validation helpers (pure — safe for import in route handlers and tests)
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

/**
 * Validates that `name` is a safe identifier for use as a JSON key and DB value.
 * Rules: 1-64 chars, starts with a-z, contains only a-z0-9_, not a reserved word.
 */
export function validateFieldName(name: string): ValidationError | null {
  if (typeof name !== "string") {
    return { field: "name", code: "VALIDATION_ERROR", message: "name must be a string" };
  }
  if (name.length < 1 || name.length > 64) {
    return { field: "name", code: "VALIDATION_ERROR", message: "name must be 1–64 chars" };
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return {
      field: "name",
      code: "VALIDATION_ERROR",
      message: "name must match /^[a-z][a-z0-9_]*$/ (lowercase, underscore-separated)",
    };
  }
  const reserved = new Set(["id", "created_at", "updated_at", "entity_id", "entity_type"]);
  if (reserved.has(name)) {
    return { field: "name", code: "VALIDATION_ERROR", message: `name "${name}" is reserved` };
  }
  return null;
}

/**
 * Validates a value against a definition. Returns null on success, or a
 * list of ValidationErrors (empty array means OK; non-empty array means
 * reject with 400).
 */
export function validateFieldValue(
  definition: CustomFieldDefinition,
  value: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (value === null || value === undefined) {
    if (definition.required) {
      errors.push({
        field: definition.name,
        code: "REQUIRED",
        message: `${definition.name} is required`,
      });
    }
    return errors;
  }

  const validation = definition.validation ?? {};

  switch (definition.dataType) {
    case "string": {
      if (typeof value !== "string") {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected string" });
        break;
      }
      if (validation.max_length !== undefined && value.length > validation.max_length) {
        errors.push({
          field: definition.name,
          code: "TOO_LONG",
          message: `exceeds max_length=${validation.max_length}`,
        });
      }
      if (validation.pattern) {
        try {
          const re = new RegExp(validation.pattern);
          if (!re.test(value)) {
            errors.push({
              field: definition.name,
              code: "PATTERN_MISMATCH",
              message: `value does not match pattern ${validation.pattern}`,
            });
          }
        } catch {
          // invalid pattern in definition — surface as internal, not user, error
          errors.push({
            field: definition.name,
            code: "INVALID_PATTERN",
            message: "definition contains an invalid regex pattern",
          });
        }
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected finite number" });
        break;
      }
      if (validation.min !== undefined && value < validation.min) {
        errors.push({ field: definition.name, code: "TOO_SMALL", message: `below min=${validation.min}` });
      }
      if (validation.max !== undefined && value > validation.max) {
        errors.push({ field: definition.name, code: "TOO_LARGE", message: `above max=${validation.max}` });
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected boolean" });
      }
      break;
    }
    case "date": {
      if (typeof value !== "string") {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected ISO 8601 date string" });
        break;
      }
      const ts = Date.parse(value);
      if (Number.isNaN(ts)) {
        errors.push({ field: definition.name, code: "INVALID_DATE", message: "unparseable date" });
      }
      break;
    }
    case "enum": {
      if (typeof value !== "string") {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected string (enum)" });
        break;
      }
      const allowed = validation.allowed_values ?? [];
      if (allowed.length === 0) {
        errors.push({
          field: definition.name,
          code: "INVALID_DEFINITION",
          message: "enum definition has no allowed_values",
        });
        break;
      }
      if (!allowed.includes(value)) {
        errors.push({
          field: definition.name,
          code: "NOT_IN_ENUM",
          message: `value must be one of: ${allowed.join(", ")}`,
        });
      }
      break;
    }
    case "ref": {
      if (typeof value !== "string" || value.length === 0) {
        errors.push({ field: definition.name, code: "TYPE_ERROR", message: "expected non-empty string (id reference)" });
      }
      // Referential integrity is enforced at persistence-layer write time
      // (not here — validation is pure/stateless).
      break;
    }
  }

  return errors;
}
