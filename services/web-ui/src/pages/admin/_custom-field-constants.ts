/**
 * Shared constants + re-exports for the Custom Fields admin page.
 *
 * Separated so the entity/data-type enums can be referenced by the page
 * AND by the CustomFieldsPanel used on entity detail views (Phase 5).
 */
export const CUSTOM_FIELD_ENTITY_TYPES = [
  "asset",
  "version",
  "shot",
  "sequence",
  "project",
  "material",
] as const;

export {
  listCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
} from "../../api";

export type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldDataType,
  CustomFieldValidation,
} from "../../api";
