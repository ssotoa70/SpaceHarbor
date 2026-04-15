/**
 * Metadata rendering module — public surface.
 *
 * Internal files (schemas, formatters, dispatch, group config) are still
 * importable directly for tests, but application code should go through
 * this barrel so refactors stay contained.
 */

export { VideoMetadataRenderer } from "./VideoMetadataRenderer";
export type { VideoMetadataRendererProps } from "./VideoMetadataRenderer";
export { MetaGroup } from "./MetaGroup";
export { MetaRow } from "./MetaRow";
export { detectSchema, extractVideoFields } from "./schema-dispatch";
export type {
  MetadataSchemaId,
  VideoMetadataPayload,
  VideoMetadataFields,
  FrameMetadataPayload,
} from "./schemas";
export {
  VIDEO_METADATA_GROUPS,
  collectKnownKeys,
} from "./video-metadata-groups";
export type {
  VideoFieldSpec,
  VideoGroupSpec,
  FieldFormatter,
} from "./video-metadata-groups";
