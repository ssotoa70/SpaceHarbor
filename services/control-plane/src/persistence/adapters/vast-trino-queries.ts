/**
 * Trino SQL query helpers for VastPersistenceAdapter.
 *
 * All read/write operations against VAST Database go through this module.
 * The TrinoClient handles nextUri polling, auth, and error handling.
 * Row-to-domain mapping is done here.
 */

import { randomUUID } from "node:crypto";
import type { TrinoClient, TrinoQueryResult } from "../../db/trino-client.js";
import type {
  AnnotationType,
  AssetDependency,
  ClipConformStatus,
  CommentAnnotation,
  CommentStatus,
  DependencyStrength,
  DependencyType,
  Episode,
  EpisodeStatus,
  Material,
  MaterialStatus,
  MediaType,
  Project,
  ProjectStatus,
  ProjectType,
  ReviewComment,
  ReviewSession,
  ReviewSessionStatus,
  ReviewSessionType,
  ReviewSessionSubmission,
  ReviewStatus,
  Sequence,
  SequenceStatus,
  Shot,
  ShotAssetUsage,
  ShotStatus,
  SubmissionStatus,
  Task,
  TaskStatus,
  TaskType,
  TextureType,
  Timeline,
  TimelineChangeSet,
  TimelineChange,
  TimelineClip,
  TimelineStatus,
  UsageType,
  Version,
  VersionApproval,
  VersionStatus,
  ApprovalAction,
  AssetPriority,
  DisplayDataWindow,
  MaterialVersion,
  LookVariant,
  VersionMaterialBinding,
  MaterialDependency,
  AssetProvenance,
  Collection,
  CollectionItem,
  VersionComparison,
  VersionLineage,
  LineageRelationshipType,
  StorageMetric,
  StorageTier,
  RenderFarmMetric,
  DownstreamUsageCount
} from "../../domain/models.js";
import type {
  CreateProjectInput,
  CreateSequenceInput,
  CreateShotInput,
  CreateVersionInput,
  CreateVersionApprovalInput,
  CreateEpisodeInput,
  CreateTaskInput,
  CreateMaterialInput,
  CreateMaterialVersionInput,
  CreateLookVariantInput,
  CreateVersionMaterialBindingInput,
  CreateMaterialDependencyInput,
  CreateTimelineInput,
  CreateTimelineClipInput,
  CreateReviewSessionInput,
  AddSubmissionInput,
  CreateReviewCommentInput,
  CreateCommentAnnotationInput,
  CreateProvenanceInput,
  CreateLineageEdgeInput,
  CreateVersionComparisonInput,
  CreateDependencyInput,
  CreateShotAssetUsageInput,
  CreateCollectionInput,
  AddCollectionItemInput,
  CreateStorageMetricInput,
  CreateRenderFarmMetricInput,
  UpsertDownstreamUsageCountInput,
  WriteContext
} from "../types.js";
import { ReferentialIntegrityError } from "../types.js";

const S = 'vast."spaceharbor/production"';

// ---------------------------------------------------------------------------
// Row-to-column index helpers
// ---------------------------------------------------------------------------

function colIndex(result: TrinoQueryResult, name: string): number {
  const idx = result.columns.findIndex((c) => c.name === name);
  return idx;
}

function getVal<T = unknown>(row: unknown[], result: TrinoQueryResult, name: string): T | null {
  const idx = colIndex(result, name);
  if (idx < 0) return null;
  return (row[idx] as T) ?? null;
}

function getStr(row: unknown[], r: TrinoQueryResult, name: string): string | null {
  return getVal<string>(row, r, name);
}

function getNum(row: unknown[], r: TrinoQueryResult, name: string): number | null {
  const v = getVal<number>(row, r, name);
  return v != null ? Number(v) : null;
}

function getReqStr(row: unknown[], r: TrinoQueryResult, name: string): string {
  return getStr(row, r, name) ?? "";
}

function getReqNum(row: unknown[], r: TrinoQueryResult, name: string): number {
  return getNum(row, r, name) ?? 0;
}

// ---------------------------------------------------------------------------
// SQL value escaping (for string interpolation — Trino has no parameterized queries via REST API)
// ---------------------------------------------------------------------------

/** Maximum allowed length for SQL string values (prevents buffer abuse). */
const MAX_SQL_STRING_LENGTH = 10_000;

/**
 * Safely escape a string value for inclusion in a Trino SQL query.
 *
 * Handles: null bytes (rejected), backslashes (doubled), single quotes (doubled),
 * and enforces a maximum length limit.
 */
export function esc(val: string | null | undefined): string {
  if (val == null) return "NULL";
  if (typeof val !== "string") {
    throw new TypeError(`esc() expects a string, got ${typeof val}`);
  }
  if (val.includes("\x00")) {
    throw new Error("SQL string value must not contain null bytes");
  }
  if (val.length > MAX_SQL_STRING_LENGTH) {
    throw new Error(`SQL string value too long (${val.length} chars, max ${MAX_SQL_STRING_LENGTH})`);
  }
  // Escape backslashes first, then single quotes
  const escaped = val.replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Safely convert a numeric value for inclusion in a Trino SQL query.
 *
 * Performs strict runtime type validation: rejects NaN, Infinity, and non-number types.
 */
export function escNum(val: number | null | undefined): string {
  if (val == null) return "NULL";
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new TypeError(
      `escNum() expects a finite number, got ${typeof val === "number" ? String(val) : typeof val}`
    );
  }
  return String(val);
}

/**
 * Safely escape a timestamp string for inclusion in a Trino SQL query.
 */
export function escTimestamp(val: string | null | undefined): string {
  if (val == null) return "NULL";
  if (typeof val !== "string") {
    throw new TypeError(`escTimestamp() expects a string, got ${typeof val}`);
  }
  if (val.includes("\x00")) {
    throw new Error("SQL timestamp value must not contain null bytes");
  }
  // Validate ISO-8601-like timestamp format (loose check — Trino will validate the exact format)
  if (val.length > 50) {
    throw new Error(`SQL timestamp value too long (${val.length} chars, max 50)`);
  }
  const escaped = val.replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `TIMESTAMP '${escaped}'`;
}

// ---------------------------------------------------------------------------
// Row mappers — READ operations
// ---------------------------------------------------------------------------

export function mapRowToProject(row: unknown[], r: TrinoQueryResult): Project {
  return {
    id: getReqStr(row, r, "id"),
    code: getReqStr(row, r, "code"),
    name: getReqStr(row, r, "name"),
    type: (getStr(row, r, "type") ?? "vfx_only") as ProjectType,
    status: (getStr(row, r, "status") ?? "active") as ProjectStatus,
    frameRate: getNum(row, r, "frame_rate"),
    colorSpace: getStr(row, r, "color_space"),
    resolutionW: getNum(row, r, "resolution_w"),
    resolutionH: getNum(row, r, "resolution_h"),
    startDate: getStr(row, r, "start_date"),
    deliveryDate: getStr(row, r, "delivery_date"),
    owner: getStr(row, r, "owner"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

export function mapRowToSequence(row: unknown[], r: TrinoQueryResult): Sequence {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    code: getReqStr(row, r, "code"),
    episode: getStr(row, r, "episode"),
    episodeId: null, // Not in DB schema — derived at app layer
    name: getStr(row, r, "name"),
    status: (getStr(row, r, "status") ?? "active") as SequenceStatus,
    shotCount: getReqNum(row, r, "shot_count"),
    frameRangeStart: getNum(row, r, "frame_range_start"),
    frameRangeEnd: getNum(row, r, "frame_range_end"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

export function mapRowToShot(row: unknown[], r: TrinoQueryResult): Shot {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    sequenceId: getReqStr(row, r, "sequence_id"),
    code: getReqStr(row, r, "code"),
    name: getStr(row, r, "name"),
    status: (getStr(row, r, "status") ?? "active") as ShotStatus,
    frameRangeStart: getReqNum(row, r, "frame_range_start"),
    frameRangeEnd: getReqNum(row, r, "frame_range_end"),
    frameCount: getReqNum(row, r, "frame_count"),
    frameRate: getNum(row, r, "frame_rate"),
    vendor: getStr(row, r, "vendor"),
    lead: getStr(row, r, "lead"),
    priority: getStr(row, r, "priority") as AssetPriority | null,
    dueDate: getStr(row, r, "due_date"),
    notes: getStr(row, r, "notes"),
    latestVersionId: getStr(row, r, "latest_version_id"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

function parseRowWindow(row: unknown[], r: TrinoQueryResult, name: string): DisplayDataWindow | null {
  const v = getVal<{ x: number; y: number; w: number; h: number }>(row, r, name);
  if (!v) return null;
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

export function mapRowToVersion(row: unknown[], r: TrinoQueryResult): Version {
  return {
    id: getReqStr(row, r, "id"),
    shotId: getReqStr(row, r, "shot_id"),
    projectId: getReqStr(row, r, "project_id"),
    sequenceId: getReqStr(row, r, "sequence_id"),
    versionLabel: getReqStr(row, r, "version_label"),
    versionNumber: getReqNum(row, r, "version_number"),
    parentVersionId: getStr(row, r, "parent_version_id"),
    status: (getStr(row, r, "status") ?? "draft") as VersionStatus,
    mediaType: (getStr(row, r, "media_type") ?? "exr_sequence") as MediaType,
    codec: getStr(row, r, "codec"),
    resolutionW: getNum(row, r, "resolution_w"),
    resolutionH: getNum(row, r, "resolution_h"),
    frameRate: getNum(row, r, "frame_rate"),
    frameRangeStart: getNum(row, r, "frame_range_start"),
    frameRangeEnd: getNum(row, r, "frame_range_end"),
    headHandle: getNum(row, r, "head_handle"),
    tailHandle: getNum(row, r, "tail_handle"),
    pixelAspectRatio: getNum(row, r, "pixel_aspect_ratio"),
    displayWindow: parseRowWindow(row, r, "display_window"),
    dataWindow: parseRowWindow(row, r, "data_window"),
    compressionType: getStr(row, r, "compression_type"),
    colorSpace: getStr(row, r, "color_space"),
    bitDepth: getNum(row, r, "bit_depth"),
    channelCount: getNum(row, r, "channel_count"),
    fileSizeBytes: getNum(row, r, "file_size_bytes"),
    md5Checksum: getStr(row, r, "md5_checksum"),
    vastElementHandle: getStr(row, r, "vast_element_handle"),
    vastPath: getStr(row, r, "vast_path"),
    elementPath: getStr(row, r, "element_path"),
    createdBy: getReqStr(row, r, "created_by"),
    createdAt: getReqStr(row, r, "created_at"),
    publishedAt: getStr(row, r, "published_at"),
    notes: getStr(row, r, "notes"),
    taskId: null, // Derived via version_tasks join table
    reviewStatus: (getStr(row, r, "review_status") ?? "wip") as ReviewStatus
  };
}

export function mapRowToEpisode(row: unknown[], r: TrinoQueryResult): Episode {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    code: getReqStr(row, r, "code"),
    name: getStr(row, r, "name"),
    status: (getStr(row, r, "status") ?? "active") as EpisodeStatus,
    sequenceCount: getReqNum(row, r, "sequence_count"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

export function mapRowToTask(row: unknown[], r: TrinoQueryResult): Task {
  return {
    id: getReqStr(row, r, "id"),
    shotId: getReqStr(row, r, "shot_id"),
    projectId: getReqStr(row, r, "project_id"),
    sequenceId: getReqStr(row, r, "sequence_id"),
    code: getReqStr(row, r, "code"),
    type: (getStr(row, r, "type") ?? "other") as TaskType,
    status: (getStr(row, r, "status") ?? "not_started") as TaskStatus,
    assignee: getStr(row, r, "assignee"),
    dueDate: getStr(row, r, "due_date"),
    taskNumber: getReqNum(row, r, "task_number"),
    notes: getStr(row, r, "notes"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

export function mapRowToMaterial(row: unknown[], r: TrinoQueryResult): Material {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    name: getReqStr(row, r, "name"),
    description: getStr(row, r, "description"),
    status: (getStr(row, r, "status") ?? "active") as MaterialStatus,
    createdBy: getReqStr(row, r, "created_by"),
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at")
  };
}

export function mapRowToVersionApproval(row: unknown[], r: TrinoQueryResult): VersionApproval {
  return {
    id: getReqStr(row, r, "id"),
    versionId: getReqStr(row, r, "version_id"),
    shotId: getReqStr(row, r, "shot_id"),
    projectId: getReqStr(row, r, "project_id"),
    action: (getStr(row, r, "action") ?? "submit_for_review") as ApprovalAction,
    performedBy: getReqStr(row, r, "performed_by"),
    role: getStr(row, r, "role"),
    note: getStr(row, r, "note"),
    at: getReqStr(row, r, "at")
  };
}

export function mapRowToMaterialVersion(row: unknown[], r: TrinoQueryResult): MaterialVersion {
  const renderCtx = getVal<string[]>(row, r, "render_contexts");
  const lookN = getVal<string[]>(row, r, "look_names");
  return {
    id: getReqStr(row, r, "id"),
    materialId: getReqStr(row, r, "material_id"),
    versionNumber: getReqNum(row, r, "version_number"),
    versionLabel: getReqStr(row, r, "version_label"),
    parentVersionId: getStr(row, r, "parent_version_id"),
    status: (getStr(row, r, "status") ?? "draft") as VersionStatus,
    sourcePath: getReqStr(row, r, "source_path"),
    contentHash: getReqStr(row, r, "content_hash"),
    usdMaterialPath: getStr(row, r, "usd_material_path"),
    renderContexts: Array.isArray(renderCtx) ? renderCtx : [],
    colorspaceConfig: getStr(row, r, "colorspace_config"),
    mtlxSpecVersion: getStr(row, r, "mtlx_spec_version"),
    lookNames: Array.isArray(lookN) ? lookN : [],
    vastElementHandle: getStr(row, r, "vast_element_handle"),
    vastPath: getStr(row, r, "vast_path"),
    createdBy: getReqStr(row, r, "created_by"),
    createdAt: getReqStr(row, r, "created_at"),
    publishedAt: getStr(row, r, "published_at")
  };
}

export function mapRowToLookVariant(row: unknown[], r: TrinoQueryResult): LookVariant {
  return {
    id: getReqStr(row, r, "id"),
    materialVersionId: getReqStr(row, r, "material_version_id"),
    lookName: getReqStr(row, r, "look_name"),
    description: getStr(row, r, "description"),
    materialAssigns: getStr(row, r, "material_assigns"),
    createdAt: getReqStr(row, r, "created_at")
  };
}

export function mapRowToBinding(row: unknown[], r: TrinoQueryResult): VersionMaterialBinding {
  return {
    id: getReqStr(row, r, "id"),
    lookVariantId: getReqStr(row, r, "look_variant_id"),
    versionId: getReqStr(row, r, "version_id"),
    boundBy: getReqStr(row, r, "bound_by"),
    boundAt: getReqStr(row, r, "bound_at")
  };
}

export function mapRowToDependency(row: unknown[], r: TrinoQueryResult): MaterialDependency {
  return {
    id: getReqStr(row, r, "id"),
    materialVersionId: getReqStr(row, r, "material_version_id"),
    texturePath: getReqStr(row, r, "texture_path"),
    contentHash: getReqStr(row, r, "content_hash"),
    textureType: getStr(row, r, "texture_type") as TextureType | null,
    colorspace: getStr(row, r, "colorspace"),
    dependencyDepth: getReqNum(row, r, "dependency_depth"),
    createdAt: getReqStr(row, r, "created_at")
  };
}

// ---------------------------------------------------------------------------
// READ queries
// ---------------------------------------------------------------------------

export async function queryProjectById(client: TrinoClient, id: string): Promise<Project | null> {
  const r = await client.query(`SELECT * FROM ${S}.projects WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToProject(r.data[0], r) : null;
}

export async function queryProjects(client: TrinoClient, status?: ProjectStatus): Promise<Project[]> {
  const where = status ? ` WHERE status = ${esc(status)}` : "";
  const r = await client.query(`SELECT * FROM ${S}.projects${where}`);
  return r.data.map((row) => mapRowToProject(row, r));
}

export async function querySequenceById(client: TrinoClient, id: string): Promise<Sequence | null> {
  const r = await client.query(`SELECT * FROM ${S}.sequences WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToSequence(r.data[0], r) : null;
}

export async function querySequencesByProject(client: TrinoClient, projectId: string): Promise<Sequence[]> {
  const r = await client.query(`SELECT * FROM ${S}.sequences WHERE project_id = ${esc(projectId)}`);
  return r.data.map((row) => mapRowToSequence(row, r));
}

export async function queryShotById(client: TrinoClient, id: string): Promise<Shot | null> {
  const r = await client.query(`SELECT * FROM ${S}.shots WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToShot(r.data[0], r) : null;
}

export async function queryShotsBySequence(client: TrinoClient, sequenceId: string): Promise<Shot[]> {
  const r = await client.query(`SELECT * FROM ${S}.shots WHERE sequence_id = ${esc(sequenceId)}`);
  return r.data.map((row) => mapRowToShot(row, r));
}

/**
 * Versions queries LEFT JOIN companion tables for review_status and frame handles.
 */
function versionSelectSql(where: string): string {
  return `SELECT v.*, vrs.review_status, vfh.head_handle, vfh.tail_handle
FROM ${S}.versions v
LEFT JOIN ${S}.version_review_status vrs ON v.id = vrs.version_id
LEFT JOIN ${S}.version_frame_handles vfh ON v.id = vfh.version_id
${where}`;
}

export async function queryVersionById(client: TrinoClient, id: string): Promise<Version | null> {
  const r = await client.query(versionSelectSql(`WHERE v.id = ${esc(id)}`));
  return r.data.length > 0 ? mapRowToVersion(r.data[0], r) : null;
}

export async function queryVersionsByShot(client: TrinoClient, shotId: string): Promise<Version[]> {
  const r = await client.query(
    versionSelectSql(`WHERE v.shot_id = ${esc(shotId)} ORDER BY v.version_number DESC`)
  );
  return r.data.map((row) => mapRowToVersion(row, r));
}

export async function queryApprovalsByVersion(client: TrinoClient, versionId: string): Promise<VersionApproval[]> {
  const r = await client.query(
    `SELECT * FROM ${S}.version_approvals WHERE version_id = ${esc(versionId)} ORDER BY at DESC`
  );
  return r.data.map((row) => mapRowToVersionApproval(row, r));
}

export async function queryEpisodeById(client: TrinoClient, id: string): Promise<Episode | null> {
  const r = await client.query(`SELECT * FROM ${S}.episodes WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToEpisode(r.data[0], r) : null;
}

export async function queryEpisodesByProject(client: TrinoClient, projectId: string): Promise<Episode[]> {
  const r = await client.query(`SELECT * FROM ${S}.episodes WHERE project_id = ${esc(projectId)}`);
  return r.data.map((row) => mapRowToEpisode(row, r));
}

export async function queryTaskById(client: TrinoClient, id: string): Promise<Task | null> {
  const r = await client.query(`SELECT * FROM ${S}.tasks WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToTask(r.data[0], r) : null;
}

export async function queryTasksByShot(client: TrinoClient, shotId: string): Promise<Task[]> {
  const r = await client.query(`SELECT * FROM ${S}.tasks WHERE shot_id = ${esc(shotId)}`);
  return r.data.map((row) => mapRowToTask(row, r));
}

export async function queryMaterialById(client: TrinoClient, id: string): Promise<Material | null> {
  const r = await client.query(`SELECT * FROM ${S}.materials WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToMaterial(r.data[0], r) : null;
}

export async function queryMaterialsByProject(client: TrinoClient, projectId: string): Promise<Material[]> {
  const r = await client.query(`SELECT * FROM ${S}.materials WHERE project_id = ${esc(projectId)}`);
  return r.data.map((row) => mapRowToMaterial(row, r));
}

export async function queryMaterialVersionById(client: TrinoClient, id: string): Promise<MaterialVersion | null> {
  const r = await client.query(`SELECT * FROM ${S}.material_versions WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToMaterialVersion(r.data[0], r) : null;
}

export async function queryMaterialVersionsByMaterial(client: TrinoClient, materialId: string): Promise<MaterialVersion[]> {
  const r = await client.query(`SELECT * FROM ${S}.material_versions WHERE material_id = ${esc(materialId)} ORDER BY version_number DESC`);
  return r.data.map((row) => mapRowToMaterialVersion(row, r));
}

export async function queryMaterialVersionBySourcePathAndHash(client: TrinoClient, sourcePath: string, contentHash: string): Promise<MaterialVersion | null> {
  const r = await client.query(`SELECT * FROM ${S}.material_versions WHERE source_path = ${esc(sourcePath)} AND content_hash = ${esc(contentHash)}`);
  return r.data.length > 0 ? mapRowToMaterialVersion(r.data[0], r) : null;
}

export async function queryLookVariantsByMaterialVersion(client: TrinoClient, materialVersionId: string): Promise<LookVariant[]> {
  const r = await client.query(`SELECT * FROM ${S}.look_variants WHERE material_version_id = ${esc(materialVersionId)}`);
  return r.data.map((row) => mapRowToLookVariant(row, r));
}

export async function queryBindingsByLookVariant(client: TrinoClient, lookVariantId: string): Promise<VersionMaterialBinding[]> {
  const r = await client.query(`SELECT * FROM ${S}.version_material_bindings WHERE look_variant_id = ${esc(lookVariantId)}`);
  return r.data.map((row) => mapRowToBinding(row, r));
}

export async function queryBindingsByVersion(client: TrinoClient, versionId: string): Promise<VersionMaterialBinding[]> {
  const r = await client.query(`SELECT * FROM ${S}.version_material_bindings WHERE version_id = ${esc(versionId)}`);
  return r.data.map((row) => mapRowToBinding(row, r));
}

export async function queryDependenciesByMaterialVersion(client: TrinoClient, materialVersionId: string): Promise<MaterialDependency[]> {
  const r = await client.query(`SELECT * FROM ${S}.material_dependencies WHERE material_version_id = ${esc(materialVersionId)}`);
  return r.data.map((row) => mapRowToDependency(row, r));
}

export async function queryCountBindingsForMaterial(client: TrinoClient, materialId: string): Promise<number> {
  const r = await client.query(
    `SELECT COUNT(*) AS cnt FROM ${S}.version_material_bindings vmb
     JOIN ${S}.look_variants lv ON vmb.look_variant_id = lv.id
     JOIN ${S}.material_versions mv ON lv.material_version_id = mv.id
     WHERE mv.material_id = ${esc(materialId)}`
  );
  if (r.data.length > 0 && r.data[0][0] != null) {
    return Number(r.data[0][0]);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// WRITE queries
// ---------------------------------------------------------------------------

function nowIso(ctx: WriteContext): string {
  return ctx.now ?? new Date().toISOString();
}

export async function insertProject(client: TrinoClient, input: CreateProjectInput, ctx: WriteContext): Promise<Project> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.projects (id, code, name, type, status, frame_rate, color_space, resolution_w, resolution_h, start_date, delivery_date, owner, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.code)}, ${esc(input.name)}, ${esc(input.type)}, ${esc(input.status)}, ${escNum(input.frameRate)}, ${esc(input.colorSpace)}, ${escNum(input.resolutionW)}, ${escNum(input.resolutionH)}, ${escTimestamp(input.startDate)}, ${escTimestamp(input.deliveryDate)}, ${esc(input.owner)}, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);

  return {
    id, code: input.code, name: input.name, type: input.type, status: input.status,
    frameRate: input.frameRate ?? null, colorSpace: input.colorSpace ?? null,
    resolutionW: input.resolutionW ?? null, resolutionH: input.resolutionH ?? null,
    startDate: input.startDate ?? null, deliveryDate: input.deliveryDate ?? null,
    owner: input.owner ?? null, createdAt: now, updatedAt: now
  };
}

export async function insertSequence(client: TrinoClient, input: CreateSequenceInput, ctx: WriteContext): Promise<Sequence> {
  // Referential integrity: project must exist
  const project = await queryProjectById(client, input.projectId);
  if (!project) throw new ReferentialIntegrityError(`Project ${input.projectId} not found`);

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.sequences (id, project_id, code, episode, name, status, shot_count, frame_range_start, frame_range_end, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.code)}, ${esc(input.episode)}, ${esc(input.name)}, ${esc(input.status)}, 0, ${escNum(input.frameRangeStart)}, ${escNum(input.frameRangeEnd)}, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);

  return {
    id, projectId: input.projectId, code: input.code,
    episode: input.episode ?? null, episodeId: input.episodeId ?? null,
    name: input.name ?? null, status: input.status, shotCount: 0,
    frameRangeStart: input.frameRangeStart ?? null, frameRangeEnd: input.frameRangeEnd ?? null,
    createdAt: now, updatedAt: now
  };
}

export async function insertShot(client: TrinoClient, input: CreateShotInput, ctx: WriteContext): Promise<Shot> {
  const project = await queryProjectById(client, input.projectId);
  if (!project) throw new ReferentialIntegrityError(`Project ${input.projectId} not found`);
  const seq = await querySequenceById(client, input.sequenceId);
  if (!seq) throw new ReferentialIntegrityError(`Sequence ${input.sequenceId} not found`);

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.shots (id, project_id, sequence_id, code, name, status, frame_range_start, frame_range_end, frame_count, frame_rate, vendor, lead, priority, due_date, notes, latest_version_id, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.sequenceId)}, ${esc(input.code)}, ${esc(input.name)}, ${esc(input.status)}, ${escNum(input.frameRangeStart)}, ${escNum(input.frameRangeEnd)}, ${escNum(input.frameCount)}, ${escNum(input.frameRate)}, ${esc(input.vendor)}, ${esc(input.lead)}, ${esc(input.priority)}, ${escTimestamp(input.dueDate)}, ${esc(input.notes)}, NULL, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);

  return {
    id, projectId: input.projectId, sequenceId: input.sequenceId,
    code: input.code, name: input.name ?? null, status: input.status,
    frameRangeStart: input.frameRangeStart, frameRangeEnd: input.frameRangeEnd,
    frameCount: input.frameCount, frameRate: input.frameRate ?? null,
    vendor: input.vendor ?? null, lead: input.lead ?? null,
    priority: input.priority ?? null, dueDate: input.dueDate ?? null,
    notes: input.notes ?? null, latestVersionId: null,
    createdAt: now, updatedAt: now
  };
}

export async function insertVersion(client: TrinoClient, input: CreateVersionInput, ctx: WriteContext): Promise<Version> {
  // Determine next version number
  const existing = await queryVersionsByShot(client, input.shotId);
  const versionNumber = existing.length > 0 ? existing[0].versionNumber + 1 : 1;

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.versions (id, shot_id, project_id, sequence_id, version_label, version_number, parent_version_id, status, media_type, created_by, created_at, notes) VALUES (${esc(id)}, ${esc(input.shotId)}, ${esc(input.projectId)}, ${esc(input.sequenceId)}, ${esc(input.versionLabel)}, ${escNum(versionNumber)}, ${esc(input.parentVersionId)}, ${esc(input.status)}, ${esc(input.mediaType)}, ${esc(input.createdBy)}, TIMESTAMP ${esc(now)}, ${esc(input.notes)})`);

  // Insert companion rows if provided
  const reviewStatus = input.reviewStatus ?? "wip";
  await client.query(`INSERT INTO ${S}.version_review_status (version_id, review_status, updated_at) VALUES (${esc(id)}, ${esc(reviewStatus)}, TIMESTAMP ${esc(now)})`);

  if (input.headHandle != null || input.tailHandle != null) {
    await client.query(`INSERT INTO ${S}.version_frame_handles (version_id, head_handle, tail_handle, updated_at) VALUES (${esc(id)}, ${escNum(input.headHandle ?? 0)}, ${escNum(input.tailHandle ?? 0)}, TIMESTAMP ${esc(now)})`);
  }

  return {
    id, shotId: input.shotId, projectId: input.projectId,
    sequenceId: input.sequenceId, versionLabel: input.versionLabel,
    versionNumber, parentVersionId: input.parentVersionId ?? null,
    status: input.status, mediaType: input.mediaType,
    codec: null, resolutionW: null, resolutionH: null,
    frameRate: null, frameRangeStart: null, frameRangeEnd: null,
    headHandle: input.headHandle ?? null, tailHandle: input.tailHandle ?? null,
    pixelAspectRatio: null, displayWindow: null, dataWindow: null,
    compressionType: null, colorSpace: null, bitDepth: null,
    channelCount: null, fileSizeBytes: null, md5Checksum: null,
    vastElementHandle: null, vastPath: null, elementPath: null,
    createdBy: input.createdBy, createdAt: now,
    publishedAt: null, notes: input.notes ?? null,
    taskId: input.taskId ?? null, reviewStatus
  };
}

export async function updateShotStatusSql(client: TrinoClient, shotId: string, status: ShotStatus, ctx: WriteContext): Promise<Shot | null> {
  const shot = await queryShotById(client, shotId);
  if (!shot) return null;
  const now = nowIso(ctx);
  await client.query(`UPDATE ${S}.shots SET status = ${esc(status)}, updated_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(shotId)}`);
  return { ...shot, status, updatedAt: now };
}

export async function publishVersionSql(client: TrinoClient, versionId: string, ctx: WriteContext): Promise<Version | null> {
  const version = await queryVersionById(client, versionId);
  if (!version) return null;
  const now = nowIso(ctx);
  await client.query(`UPDATE ${S}.versions SET status = 'published', published_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(versionId)}`);
  return { ...version, status: "published", publishedAt: now };
}

export async function updateVersionReviewStatusSql(client: TrinoClient, versionId: string, status: ReviewStatus, ctx: WriteContext): Promise<Version | null> {
  const version = await queryVersionById(client, versionId);
  if (!version) return null;
  const now = nowIso(ctx);
  // Upsert: delete + insert (VAST cannot UPDATE sort key columns)
  await client.query(`DELETE FROM ${S}.version_review_status WHERE version_id = ${esc(versionId)}`);
  await client.query(`INSERT INTO ${S}.version_review_status (version_id, review_status, updated_at) VALUES (${esc(versionId)}, ${esc(status)}, TIMESTAMP ${esc(now)})`);
  return { ...version, reviewStatus: status };
}

export async function updateVersionTechnicalMetadataSql(client: TrinoClient, versionId: string, meta: Partial<import("../../domain/models.js").VfxMetadata>, ctx: WriteContext): Promise<Version | null> {
  const version = await queryVersionById(client, versionId);
  if (!version) return null;
  const now = nowIso(ctx);
  const sets: string[] = [`updated_at = TIMESTAMP ${esc(now)}`];
  // Build dynamic SET clause — Trino does not support partial updates easily
  // but we avoid the sort-key limitation by only updating non-sort columns
  if (meta.codec !== undefined) sets.push(`codec = ${esc(meta.codec ?? null)}`);
  if (meta.resolution?.width !== undefined) sets.push(`resolution_w = ${escNum(meta.resolution.width)}`);
  if (meta.resolution?.height !== undefined) sets.push(`resolution_h = ${escNum(meta.resolution.height)}`);
  if (meta.frame_rate !== undefined) sets.push(`frame_rate = ${escNum(meta.frame_rate ?? null)}`);
  if (meta.frame_range?.start !== undefined) sets.push(`frame_range_start = ${escNum(meta.frame_range.start)}`);
  if (meta.frame_range?.end !== undefined) sets.push(`frame_range_end = ${escNum(meta.frame_range.end)}`);
  if (meta.color_space !== undefined) sets.push(`color_space = ${esc(meta.color_space ?? null)}`);
  if (meta.compression_type !== undefined) sets.push(`compression_type = ${esc(meta.compression_type ?? null)}`);
  if (meta.bit_depth !== undefined) sets.push(`bit_depth = ${escNum(meta.bit_depth ?? null)}`);
  if (meta.file_size_bytes !== undefined) sets.push(`file_size_bytes = ${escNum(meta.file_size_bytes ?? null)}`);
  if (meta.md5_checksum !== undefined) sets.push(`md5_checksum = ${esc(meta.md5_checksum ?? null)}`);
  if (meta.pixel_aspect_ratio !== undefined) sets.push(`pixel_aspect_ratio = ${escNum(meta.pixel_aspect_ratio ?? null)}`);
  if (meta.display_window !== undefined) {
    const dw = meta.display_window;
    sets.push(dw ? `display_window = ROW(${escNum(dw.x)}, ${escNum(dw.y)}, ${escNum(dw.width)}, ${escNum(dw.height)})` : `display_window = NULL`);
  }
  if (meta.data_window !== undefined) {
    const daw = meta.data_window;
    sets.push(daw ? `data_window = ROW(${escNum(daw.x)}, ${escNum(daw.y)}, ${escNum(daw.width)}, ${escNum(daw.height)})` : `data_window = NULL`);
  }
  if (meta.channels !== undefined) sets.push(`channel_count = ${escNum(meta.channels?.length ?? null)}`);

  if (sets.length > 1) {
    await client.query(`UPDATE ${S}.versions SET ${sets.join(", ")} WHERE id = ${esc(versionId)}`);
  }

  // Persist proxy/thumbnail URLs to companion table when present
  if (meta.thumbnail_url !== undefined || meta.proxy_url !== undefined) {
    await upsertVersionMediaUrls(client, versionId, meta.thumbnail_url, meta.proxy_url, ctx);
  }

  return queryVersionById(client, versionId);
}

export async function insertVersionApproval(client: TrinoClient, input: CreateVersionApprovalInput, ctx: WriteContext): Promise<VersionApproval> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.version_approvals (id, version_id, shot_id, project_id, action, performed_by, role, note, at) VALUES (${esc(id)}, ${esc(input.versionId)}, ${esc(input.shotId)}, ${esc(input.projectId)}, ${esc(input.action)}, ${esc(input.performedBy)}, ${esc(input.role)}, ${esc(input.note)}, TIMESTAMP ${esc(now)})`);
  return {
    id, versionId: input.versionId, shotId: input.shotId,
    projectId: input.projectId, action: input.action,
    performedBy: input.performedBy, role: input.role ?? null,
    note: input.note ?? null, at: now
  };
}

export async function insertEpisode(client: TrinoClient, input: CreateEpisodeInput, ctx: WriteContext): Promise<Episode> {
  const project = await queryProjectById(client, input.projectId);
  if (!project) throw new ReferentialIntegrityError(`Project ${input.projectId} not found`);

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.episodes (id, project_id, code, name, status, sequence_count, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.code)}, ${esc(input.name)}, ${esc(input.status)}, 0, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, projectId: input.projectId, code: input.code,
    name: input.name ?? null, status: input.status,
    sequenceCount: 0, createdAt: now, updatedAt: now
  };
}

export async function insertTask(client: TrinoClient, input: CreateTaskInput, ctx: WriteContext): Promise<Task> {
  // Determine next task number for this shot
  const existing = await queryTasksByShot(client, input.shotId);
  const taskNumber = existing.length + 1;

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.tasks (id, shot_id, project_id, sequence_id, code, type, status, assignee, due_date, task_number, notes, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.shotId)}, ${esc(input.projectId)}, ${esc(input.sequenceId)}, ${esc(input.code)}, ${esc(input.type)}, ${esc(input.status)}, ${esc(input.assignee)}, ${escTimestamp(input.dueDate)}, ${escNum(taskNumber)}, ${esc(input.notes)}, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, shotId: input.shotId, projectId: input.projectId,
    sequenceId: input.sequenceId, code: input.code,
    type: input.type, status: input.status,
    assignee: input.assignee ?? null, dueDate: input.dueDate ?? null,
    taskNumber, notes: input.notes ?? null,
    createdAt: now, updatedAt: now
  };
}

export async function updateTaskStatusSql(client: TrinoClient, taskId: string, status: TaskStatus, ctx: WriteContext): Promise<Task | null> {
  const task = await queryTaskById(client, taskId);
  if (!task) return null;
  const now = nowIso(ctx);
  await client.query(`UPDATE ${S}.tasks SET status = ${esc(status)}, updated_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(taskId)}`);
  return { ...task, status, updatedAt: now };
}

export async function insertMaterial(client: TrinoClient, input: CreateMaterialInput, ctx: WriteContext): Promise<Material> {
  const project = await queryProjectById(client, input.projectId);
  if (!project) throw new ReferentialIntegrityError(`Project ${input.projectId} not found`);

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.materials (id, project_id, name, description, status, created_by, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.name)}, ${esc(input.description)}, ${esc(input.status)}, ${esc(input.createdBy)}, TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, projectId: input.projectId, name: input.name,
    description: input.description ?? null, status: input.status,
    createdBy: input.createdBy, createdAt: now, updatedAt: now
  };
}

export async function insertMaterialVersion(client: TrinoClient, input: CreateMaterialVersionInput, ctx: WriteContext): Promise<MaterialVersion> {
  // Determine next version number
  const existing = await queryMaterialVersionsByMaterial(client, input.materialId);
  const versionNumber = existing.length > 0 ? existing[0].versionNumber + 1 : 1;

  const id = randomUUID();
  const now = nowIso(ctx);
  const renderCtx = input.renderContexts ? `ARRAY[${input.renderContexts.map((s) => esc(s)).join(",")}]` : "NULL";
  const lookN = input.lookNames ? `ARRAY[${input.lookNames.map((s) => esc(s)).join(",")}]` : "NULL";

  await client.query(`INSERT INTO ${S}.material_versions (id, material_id, version_number, version_label, parent_version_id, status, source_path, content_hash, usd_material_path, render_contexts, colorspace_config, mtlx_spec_version, look_names, vast_element_handle, vast_path, created_by, created_at, published_at) VALUES (${esc(id)}, ${esc(input.materialId)}, ${escNum(versionNumber)}, ${esc(input.versionLabel)}, ${esc(input.parentVersionId)}, ${esc(input.status)}, ${esc(input.sourcePath)}, ${esc(input.contentHash)}, ${esc(input.usdMaterialPath)}, ${renderCtx}, ${esc(input.colorspaceConfig)}, ${esc(input.mtlxSpecVersion)}, ${lookN}, NULL, NULL, ${esc(input.createdBy)}, TIMESTAMP ${esc(now)}, NULL)`);

  return {
    id, materialId: input.materialId, versionNumber,
    versionLabel: input.versionLabel,
    parentVersionId: input.parentVersionId ?? null,
    status: input.status, sourcePath: input.sourcePath,
    contentHash: input.contentHash,
    usdMaterialPath: input.usdMaterialPath ?? null,
    renderContexts: input.renderContexts ?? [],
    colorspaceConfig: input.colorspaceConfig ?? null,
    mtlxSpecVersion: input.mtlxSpecVersion ?? null,
    lookNames: input.lookNames ?? [],
    vastElementHandle: null, vastPath: null,
    createdBy: input.createdBy, createdAt: now, publishedAt: null
  };
}

export async function insertLookVariant(client: TrinoClient, input: CreateLookVariantInput, ctx: WriteContext): Promise<LookVariant> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.look_variants (id, material_version_id, look_name, description, material_assigns, created_at) VALUES (${esc(id)}, ${esc(input.materialVersionId)}, ${esc(input.lookName)}, ${esc(input.description)}, ${esc(input.materialAssigns)}, TIMESTAMP ${esc(now)})`);
  return {
    id, materialVersionId: input.materialVersionId,
    lookName: input.lookName, description: input.description ?? null,
    materialAssigns: input.materialAssigns ?? null, createdAt: now
  };
}

export async function insertVersionMaterialBinding(client: TrinoClient, input: CreateVersionMaterialBindingInput, ctx: WriteContext): Promise<VersionMaterialBinding> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.version_material_bindings (id, look_variant_id, version_id, bound_by, bound_at) VALUES (${esc(id)}, ${esc(input.lookVariantId)}, ${esc(input.versionId)}, ${esc(input.boundBy)}, TIMESTAMP ${esc(now)})`);
  return {
    id, lookVariantId: input.lookVariantId,
    versionId: input.versionId, boundBy: input.boundBy, boundAt: now
  };
}

export async function insertMaterialDependency(client: TrinoClient, input: CreateMaterialDependencyInput, ctx: WriteContext): Promise<MaterialDependency> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.material_dependencies (id, material_version_id, texture_path, content_hash, texture_type, colorspace, dependency_depth, created_at) VALUES (${esc(id)}, ${esc(input.materialVersionId)}, ${esc(input.texturePath)}, ${esc(input.contentHash)}, ${esc(input.textureType)}, ${esc(input.colorspace)}, ${escNum(input.dependencyDepth)}, TIMESTAMP ${esc(now)})`);
  return {
    id, materialVersionId: input.materialVersionId,
    texturePath: input.texturePath, contentHash: input.contentHash,
    textureType: input.textureType ?? null, colorspace: input.colorspace ?? null,
    dependencyDepth: input.dependencyDepth, createdAt: now
  };
}

// ---------------------------------------------------------------------------
// Timeline queries (OTIO)
// ---------------------------------------------------------------------------

function mapRowToTimeline(row: unknown[], r: TrinoQueryResult): Timeline {
  return {
    id: getReqStr(row, r, "id"),
    name: getReqStr(row, r, "name"),
    projectId: getReqStr(row, r, "project_id"),
    frameRate: getReqNum(row, r, "frame_rate"),
    durationFrames: getReqNum(row, r, "duration_frames"),
    status: (getStr(row, r, "status") ?? "ingested") as TimelineStatus,
    sourceUri: getReqStr(row, r, "source_uri"),
    createdAt: getReqStr(row, r, "created_at")
  };
}

/** SELECT for timeline_clips with LEFT JOIN to companion timeline_clip_details. */
function clipSelectSql(where: string): string {
  return `SELECT c.*, tcd.vfx_cut_in, tcd.vfx_cut_out, tcd.handle_head, tcd.handle_tail, tcd.delivery_in, tcd.delivery_out, tcd.source_timecode
FROM ${S}.timeline_clips c
LEFT JOIN ${S}.timeline_clip_details tcd ON c.id = tcd.clip_id
${where}`;
}

function mapRowToTimelineClip(row: unknown[], r: TrinoQueryResult): TimelineClip {
  return {
    id: getReqStr(row, r, "id"),
    timelineId: getReqStr(row, r, "timeline_id"),
    trackName: getReqStr(row, r, "track_name"),
    clipName: getReqStr(row, r, "clip_name"),
    sourceUri: getStr(row, r, "source_uri"),
    inFrame: getReqNum(row, r, "in_frame"),
    outFrame: getReqNum(row, r, "out_frame"),
    durationFrames: getReqNum(row, r, "duration_frames"),
    shotId: getStr(row, r, "matched_shot_id"),
    assetId: getStr(row, r, "matched_asset_id"),
    conformStatus: (getStr(row, r, "conform_status") ?? "pending") as ClipConformStatus,
    vfxCutIn: getNum(row, r, "vfx_cut_in"),
    vfxCutOut: getNum(row, r, "vfx_cut_out"),
    handleHead: getNum(row, r, "handle_head"),
    handleTail: getNum(row, r, "handle_tail"),
    deliveryIn: getNum(row, r, "delivery_in"),
    deliveryOut: getNum(row, r, "delivery_out"),
    sourceTimecode: getStr(row, r, "source_timecode")
  };
}

export async function insertTimeline(client: TrinoClient, input: CreateTimelineInput, ctx: WriteContext): Promise<Timeline> {
  const project = await queryProjectById(client, input.projectId);
  if (!project) throw new ReferentialIntegrityError(`Project ${input.projectId} not found`);

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.timelines (id, name, project_id, frame_rate, duration_frames, source_uri, status, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.name)}, ${esc(input.projectId)}, ${escNum(input.frameRate)}, ${escNum(input.durationFrames)}, ${esc(input.sourceUri)}, 'ingested', TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, name: input.name, projectId: input.projectId,
    frameRate: input.frameRate, durationFrames: input.durationFrames,
    status: "ingested", sourceUri: input.sourceUri, createdAt: now
  };
}

export async function queryTimelineById(client: TrinoClient, id: string): Promise<Timeline | null> {
  const r = await client.query(`SELECT * FROM ${S}.timelines WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToTimeline(r.data[0], r) : null;
}

export async function queryTimelinesByProject(client: TrinoClient, projectId: string): Promise<Timeline[]> {
  const r = await client.query(`SELECT * FROM ${S}.timelines WHERE project_id = ${esc(projectId)} ORDER BY created_at DESC`);
  return r.data.map((row) => mapRowToTimeline(row, r));
}

export async function queryTimelineByProjectAndName(client: TrinoClient, projectId: string, name: string): Promise<Timeline | null> {
  const r = await client.query(`SELECT * FROM ${S}.timelines WHERE project_id = ${esc(projectId)} AND name = ${esc(name)}`);
  return r.data.length > 0 ? mapRowToTimeline(r.data[0], r) : null;
}

export async function updateTimelineStatusSql(client: TrinoClient, id: string, status: TimelineStatus, ctx: WriteContext): Promise<Timeline | null> {
  const timeline = await queryTimelineById(client, id);
  if (!timeline) return null;
  const now = nowIso(ctx);
  await client.query(`UPDATE ${S}.timelines SET status = ${esc(status)}, updated_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(id)}`);
  return { ...timeline, status };
}

export async function insertTimelineClip(client: TrinoClient, input: CreateTimelineClipInput, ctx: WriteContext): Promise<TimelineClip> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.timeline_clips (id, timeline_id, track_name, clip_name, source_uri, in_frame, out_frame, duration_frames, shot_name, conform_status, matched_shot_id, matched_asset_id, created_at) VALUES (${esc(id)}, ${esc(input.timelineId)}, ${esc(input.trackName)}, ${esc(input.clipName)}, ${esc(input.sourceUri)}, ${escNum(input.inFrame)}, ${escNum(input.outFrame)}, ${escNum(input.durationFrames)}, ${esc(input.shotName)}, 'pending', NULL, NULL, TIMESTAMP ${esc(now)})`);

  // Insert companion row for extended fields if any are present
  const hasDetails = input.vfxCutIn != null || input.vfxCutOut != null ||
    input.handleHead != null || input.handleTail != null ||
    input.deliveryIn != null || input.deliveryOut != null ||
    input.sourceTimecode != null;
  if (hasDetails) {
    await client.query(`INSERT INTO ${S}.timeline_clip_details (clip_id, vfx_cut_in, vfx_cut_out, handle_head, handle_tail, delivery_in, delivery_out, source_timecode) VALUES (${esc(id)}, ${escNum(input.vfxCutIn ?? null)}, ${escNum(input.vfxCutOut ?? null)}, ${escNum(input.handleHead ?? null)}, ${escNum(input.handleTail ?? null)}, ${escNum(input.deliveryIn ?? null)}, ${escNum(input.deliveryOut ?? null)}, ${esc(input.sourceTimecode ?? null)})`);
  }

  return {
    id, timelineId: input.timelineId, trackName: input.trackName,
    clipName: input.clipName, sourceUri: input.sourceUri ?? null,
    inFrame: input.inFrame, outFrame: input.outFrame,
    durationFrames: input.durationFrames,
    shotId: null, assetId: null, conformStatus: "pending",
    vfxCutIn: input.vfxCutIn ?? null, vfxCutOut: input.vfxCutOut ?? null,
    handleHead: input.handleHead ?? null, handleTail: input.handleTail ?? null,
    deliveryIn: input.deliveryIn ?? null, deliveryOut: input.deliveryOut ?? null,
    sourceTimecode: input.sourceTimecode ?? null
  };
}

export async function queryClipsByTimeline(client: TrinoClient, timelineId: string): Promise<TimelineClip[]> {
  const r = await client.query(clipSelectSql(`WHERE c.timeline_id = ${esc(timelineId)} ORDER BY c.in_frame`));
  return r.data.map((row) => mapRowToTimelineClip(row, r));
}

export async function updateClipConformStatusSql(client: TrinoClient, clipId: string, status: ClipConformStatus, shotId?: string, assetId?: string): Promise<void> {
  const sets: string[] = [`conform_status = ${esc(status)}`];
  if (shotId !== undefined) sets.push(`matched_shot_id = ${esc(shotId)}`);
  if (assetId !== undefined) sets.push(`matched_asset_id = ${esc(assetId)}`);
  await client.query(`UPDATE ${S}.timeline_clips SET ${sets.join(", ")} WHERE id = ${esc(clipId)}`);
}

export async function insertTimelineChangeSet(client: TrinoClient, changeSet: TimelineChangeSet): Promise<void> {
  await client.query(`INSERT INTO ${S}.timeline_change_sets (id, timeline_id, previous_timeline_id, changes, created_at) VALUES (${esc(changeSet.id)}, ${esc(changeSet.timelineId)}, ${esc(changeSet.previousTimelineId)}, ${esc(JSON.stringify(changeSet.changes))}, TIMESTAMP ${esc(changeSet.createdAt)})`);
}

export async function queryTimelineChangeSet(client: TrinoClient, timelineId: string): Promise<TimelineChangeSet | null> {
  const r = await client.query(`SELECT * FROM ${S}.timeline_change_sets WHERE timeline_id = ${esc(timelineId)} ORDER BY created_at DESC`);
  if (r.data.length === 0) return null;
  const row = r.data[0];
  const changesRaw = getStr(row, r, "changes");
  let changes: TimelineChange[] = [];
  if (changesRaw) {
    try { changes = JSON.parse(changesRaw) as TimelineChange[]; } catch { /* empty */ }
  }
  return {
    id: getReqStr(row, r, "id"),
    timelineId: getReqStr(row, r, "timeline_id"),
    previousTimelineId: getReqStr(row, r, "previous_timeline_id"),
    changes,
    createdAt: getReqStr(row, r, "created_at")
  };
}

// ---------------------------------------------------------------------------
// Review Session queries
// ---------------------------------------------------------------------------

function mapRowToReviewSession(row: unknown[], r: TrinoQueryResult): ReviewSession {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    department: getStr(row, r, "department"),
    sessionDate: getReqStr(row, r, "session_date"),
    sessionType: (getStr(row, r, "session_type") ?? "dailies") as ReviewSessionType,
    supervisorId: getStr(row, r, "supervisor_id"),
    status: (getStr(row, r, "status") ?? "open") as ReviewSessionStatus,
    createdAt: getReqStr(row, r, "created_at")
  };
}

function mapRowToSubmission(row: unknown[], r: TrinoQueryResult): ReviewSessionSubmission {
  return {
    id: getReqStr(row, r, "id"),
    sessionId: getReqStr(row, r, "session_id"),
    assetId: getReqStr(row, r, "asset_id"),
    versionId: getStr(row, r, "version_id"),
    submissionOrder: getReqNum(row, r, "submission_order"),
    status: (getStr(row, r, "status") ?? "pending") as SubmissionStatus,
    submittedAt: getReqStr(row, r, "submitted_at")
  };
}

export async function insertReviewSession(client: TrinoClient, input: CreateReviewSessionInput, ctx: WriteContext): Promise<ReviewSession> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.review_sessions (id, project_id, department, session_date, session_type, supervisor_id, status, created_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.department)}, DATE ${esc(input.sessionDate)}, ${esc(input.sessionType)}, ${esc(input.supervisorId)}, 'open', TIMESTAMP ${esc(now)})`);
  return {
    id, projectId: input.projectId,
    department: input.department ?? null,
    sessionDate: input.sessionDate,
    sessionType: input.sessionType,
    supervisorId: input.supervisorId ?? null,
    status: "open", createdAt: now
  };
}

export async function queryReviewSessionById(client: TrinoClient, id: string): Promise<ReviewSession | null> {
  const r = await client.query(`SELECT * FROM ${S}.review_sessions WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToReviewSession(r.data[0], r) : null;
}

export async function queryReviewSessions(client: TrinoClient, filters?: { projectId?: string; status?: ReviewSessionStatus; department?: string }): Promise<ReviewSession[]> {
  const clauses: string[] = [];
  if (filters?.projectId) clauses.push(`project_id = ${esc(filters.projectId)}`);
  if (filters?.status) clauses.push(`status = ${esc(filters.status)}`);
  if (filters?.department) clauses.push(`department = ${esc(filters.department)}`);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const r = await client.query(`SELECT * FROM ${S}.review_sessions ${where} ORDER BY session_date DESC`);
  return r.data.map((row) => mapRowToReviewSession(row, r));
}

export async function updateReviewSessionStatusSql(client: TrinoClient, id: string, fromStatus: ReviewSessionStatus, toStatus: ReviewSessionStatus, ctx: WriteContext): Promise<ReviewSession | null> {
  const session = await queryReviewSessionById(client, id);
  if (!session) return null;
  if (session.status !== fromStatus) return null;
  await client.query(`UPDATE ${S}.review_sessions SET status = ${esc(toStatus)} WHERE id = ${esc(id)}`);
  return { ...session, status: toStatus };
}

export async function insertSubmission(client: TrinoClient, input: AddSubmissionInput, ctx: WriteContext): Promise<ReviewSessionSubmission> {
  // Determine next submission order if not provided
  let order = input.submissionOrder;
  if (order == null) {
    const existing = await querySubmissionsBySession(client, input.sessionId);
    order = existing.length + 1;
  }

  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.review_session_submissions (id, session_id, asset_id, version_id, submission_order, status, submitted_at) VALUES (${esc(id)}, ${esc(input.sessionId)}, ${esc(input.assetId)}, ${esc(input.versionId)}, ${escNum(order)}, 'pending', TIMESTAMP ${esc(now)})`);
  return {
    id, sessionId: input.sessionId,
    assetId: input.assetId,
    versionId: input.versionId ?? null,
    submissionOrder: order,
    status: "pending", submittedAt: now
  };
}

export async function querySubmissionsBySession(client: TrinoClient, sessionId: string): Promise<ReviewSessionSubmission[]> {
  const r = await client.query(`SELECT * FROM ${S}.review_session_submissions WHERE session_id = ${esc(sessionId)} ORDER BY submission_order`);
  return r.data.map((row) => mapRowToSubmission(row, r));
}

export async function updateSubmissionStatusSql(client: TrinoClient, id: string, fromStatus: SubmissionStatus, toStatus: SubmissionStatus, ctx: WriteContext): Promise<ReviewSessionSubmission | null> {
  // Find submission — need to query by id across all sessions
  const r = await client.query(`SELECT * FROM ${S}.review_session_submissions WHERE id = ${esc(id)}`);
  if (r.data.length === 0) return null;
  const submission = mapRowToSubmission(r.data[0], r);
  if (submission.status !== fromStatus) return null;
  await client.query(`UPDATE ${S}.review_session_submissions SET status = ${esc(toStatus)} WHERE id = ${esc(id)}`);
  return { ...submission, status: toStatus };
}

// ---------------------------------------------------------------------------
// Approval audit companion (version_id + session_id links)
// ---------------------------------------------------------------------------

export async function insertApprovalAuditLink(client: TrinoClient, auditId: string, versionId?: string, sessionId?: string): Promise<void> {
  if (versionId == null && sessionId == null) return;
  await client.query(`INSERT INTO ${S}.approval_audit_links (audit_id, version_id, session_id) VALUES (${esc(auditId)}, ${esc(versionId)}, ${esc(sessionId)})`);
}

// ---------------------------------------------------------------------------
// Version media URLs (companion to versions)
// ---------------------------------------------------------------------------

export async function upsertVersionMediaUrls(client: TrinoClient, versionId: string, thumbnailUrl?: string, proxyUrl?: string, ctx?: WriteContext): Promise<void> {
  const now = ctx ? nowIso(ctx) : new Date().toISOString();
  // VAST cannot UPDATE sort-key columns; use DELETE + INSERT
  await client.query(`DELETE FROM ${S}.version_media_urls WHERE version_id = ${esc(versionId)}`);
  await client.query(`INSERT INTO ${S}.version_media_urls (version_id, thumbnail_url, proxy_url, updated_at) VALUES (${esc(versionId)}, ${esc(thumbnailUrl)}, ${esc(proxyUrl)}, TIMESTAMP ${esc(now)})`);
}

// ---------------------------------------------------------------------------
// Review Comments (Phase B)
// ---------------------------------------------------------------------------

function mapRowToReviewComment(row: unknown[], r: TrinoQueryResult): ReviewComment {
  return {
    id: getReqStr(row, r, "id"),
    sessionId: getStr(row, r, "session_id"),
    submissionId: getStr(row, r, "submission_id"),
    versionId: getStr(row, r, "version_id"),
    parentCommentId: getStr(row, r, "parent_comment_id"),
    authorId: getReqStr(row, r, "author_id"),
    authorRole: getStr(row, r, "author_role"),
    body: getReqStr(row, r, "body"),
    frameNumber: getNum(row, r, "frame_number"),
    timecode: getStr(row, r, "timecode"),
    annotationType: (getStr(row, r, "annotation_type") as AnnotationType | null),
    status: (getReqStr(row, r, "status") as CommentStatus) || "open",
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at"),
  };
}

export async function insertReviewComment(client: TrinoClient, input: CreateReviewCommentInput, ctx: WriteContext): Promise<ReviewComment> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.review_comments (id, session_id, submission_id, version_id, parent_comment_id, author_id, author_role, body, frame_number, timecode, annotation_type, status, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.sessionId)}, ${esc(input.submissionId)}, ${esc(input.versionId)}, ${esc(input.parentCommentId)}, ${esc(input.authorId)}, ${esc(input.authorRole)}, ${esc(input.body)}, ${escNum(input.frameNumber)}, ${esc(input.timecode)}, ${esc(input.annotationType)}, 'open', TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, sessionId: input.sessionId ?? null, submissionId: input.submissionId ?? null,
    versionId: input.versionId ?? null, parentCommentId: input.parentCommentId ?? null,
    authorId: input.authorId, authorRole: input.authorRole ?? null,
    body: input.body, frameNumber: input.frameNumber ?? null,
    timecode: input.timecode ?? null, annotationType: input.annotationType ?? null,
    status: "open", createdAt: now, updatedAt: now
  };
}

export async function queryReviewCommentById(client: TrinoClient, id: string): Promise<ReviewComment | null> {
  const r = await client.query(`SELECT * FROM ${S}.review_comments WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToReviewComment(r.data[0], r) : null;
}

export async function queryCommentsBySession(client: TrinoClient, sessionId: string): Promise<ReviewComment[]> {
  const r = await client.query(`SELECT * FROM ${S}.review_comments WHERE session_id = ${esc(sessionId)} AND status != 'archived' ORDER BY created_at`);
  return r.data.map((row) => mapRowToReviewComment(row, r));
}

export async function queryCommentsBySubmission(client: TrinoClient, submissionId: string): Promise<ReviewComment[]> {
  const r = await client.query(`SELECT * FROM ${S}.review_comments WHERE submission_id = ${esc(submissionId)} AND status != 'archived' ORDER BY created_at`);
  return r.data.map((row) => mapRowToReviewComment(row, r));
}

export async function queryReplies(client: TrinoClient, parentCommentId: string): Promise<ReviewComment[]> {
  const r = await client.query(`SELECT * FROM ${S}.review_comments WHERE parent_comment_id = ${esc(parentCommentId)} AND status != 'archived' ORDER BY created_at`);
  return r.data.map((row) => mapRowToReviewComment(row, r));
}

export async function updateReviewCommentStatus(client: TrinoClient, id: string, status: CommentStatus, ctx: WriteContext): Promise<ReviewComment | null> {
  const comment = await queryReviewCommentById(client, id);
  if (!comment) return null;
  const now = nowIso(ctx);
  await client.query(`UPDATE ${S}.review_comments SET status = ${esc(status)}, updated_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(id)}`);
  return { ...comment, status, updatedAt: now };
}

export async function resolveReviewComment(client: TrinoClient, id: string, ctx: WriteContext): Promise<ReviewComment | null> {
  return updateReviewCommentStatus(client, id, "resolved", ctx);
}

// ---------------------------------------------------------------------------
// Comment Annotations (Phase B)
// ---------------------------------------------------------------------------

function mapRowToCommentAnnotation(row: unknown[], r: TrinoQueryResult): CommentAnnotation {
  return {
    id: getReqStr(row, r, "id"),
    commentId: getReqStr(row, r, "comment_id"),
    annotationData: getReqStr(row, r, "annotation_data"),
    frameNumber: getReqNum(row, r, "frame_number"),
  };
}

export async function insertCommentAnnotation(client: TrinoClient, input: CreateCommentAnnotationInput, ctx: WriteContext): Promise<CommentAnnotation> {
  const id = randomUUID();
  await client.query(`INSERT INTO ${S}.comment_annotations (id, comment_id, annotation_data, frame_number) VALUES (${esc(id)}, ${esc(input.commentId)}, ${esc(input.annotationData)}, ${escNum(input.frameNumber)})`);
  return { id, commentId: input.commentId, annotationData: input.annotationData, frameNumber: input.frameNumber };
}

export async function queryAnnotationsByComment(client: TrinoClient, commentId: string): Promise<CommentAnnotation[]> {
  const r = await client.query(`SELECT * FROM ${S}.comment_annotations WHERE comment_id = ${esc(commentId)} ORDER BY frame_number`);
  return r.data.map((row) => mapRowToCommentAnnotation(row, r));
}

// ---------------------------------------------------------------------------
// Version Comparisons (Phase B)
// ---------------------------------------------------------------------------

function mapRowToVersionComparison(row: unknown[], r: TrinoQueryResult): VersionComparison {
  return {
    id: getReqStr(row, r, "id"),
    versionAId: getReqStr(row, r, "version_a_id"),
    versionBId: getReqStr(row, r, "version_b_id"),
    comparisonType: getReqStr(row, r, "comparison_type") as VersionComparison["comparisonType"],
    diffMetadata: getStr(row, r, "diff_metadata"),
    pixelDiffPercentage: getNum(row, r, "pixel_diff_percentage"),
    frameDiffCount: getNum(row, r, "frame_diff_count"),
    resolutionMatch: Boolean(getReqNum(row, r, "resolution_match")),
    colorspaceMatch: Boolean(getReqNum(row, r, "colorspace_match")),
    createdAt: getReqStr(row, r, "created_at"),
    createdBy: getReqStr(row, r, "created_by"),
  };
}

export async function insertVersionComparison(client: TrinoClient, input: CreateVersionComparisonInput, ctx: WriteContext): Promise<VersionComparison> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.version_comparisons (id, version_a_id, version_b_id, comparison_type, diff_metadata, pixel_diff_percentage, frame_diff_count, resolution_match, colorspace_match, created_at, created_by) VALUES (${esc(id)}, ${esc(input.versionAId)}, ${esc(input.versionBId)}, ${esc(input.comparisonType)}, ${esc(input.diffMetadata)}, ${escNum(input.pixelDiffPercentage)}, ${escNum(input.frameDiffCount)}, ${input.resolutionMatch}, ${input.colorspaceMatch}, TIMESTAMP ${esc(now)}, ${esc(input.createdBy)})`);
  return {
    id, versionAId: input.versionAId, versionBId: input.versionBId,
    comparisonType: input.comparisonType as VersionComparison["comparisonType"],
    diffMetadata: input.diffMetadata ?? null,
    pixelDiffPercentage: input.pixelDiffPercentage ?? null,
    frameDiffCount: input.frameDiffCount ?? null,
    resolutionMatch: input.resolutionMatch,
    colorspaceMatch: input.colorspaceMatch,
    createdAt: now, createdBy: input.createdBy
  };
}

export async function queryVersionComparisonById(client: TrinoClient, id: string): Promise<VersionComparison | null> {
  const r = await client.query(`SELECT * FROM ${S}.version_comparisons WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToVersionComparison(r.data[0], r) : null;
}

export async function queryComparisonsByVersion(client: TrinoClient, versionId: string): Promise<VersionComparison[]> {
  const r = await client.query(`SELECT * FROM ${S}.version_comparisons WHERE version_a_id = ${esc(versionId)} OR version_b_id = ${esc(versionId)} ORDER BY created_at DESC`);
  return r.data.map((row) => mapRowToVersionComparison(row, r));
}

// ---------------------------------------------------------------------------
// Asset Provenance (Phase C)
// ---------------------------------------------------------------------------

function mapRowToProvenance(row: unknown[], r: TrinoQueryResult): AssetProvenance {
  return {
    id: getReqStr(row, r, "id"),
    versionId: getReqStr(row, r, "version_id"),
    creator: getStr(row, r, "creator"),
    softwareUsed: getStr(row, r, "software_used"),
    softwareVersion: getStr(row, r, "software_version"),
    renderJobId: getStr(row, r, "render_job_id"),
    pipelineStage: getStr(row, r, "pipeline_stage"),
    vastStoragePath: getStr(row, r, "vast_storage_path"),
    vastElementHandle: getStr(row, r, "vast_element_handle"),
    sourceHost: getStr(row, r, "source_host"),
    sourceProcessId: getStr(row, r, "source_process_id"),
    createdAt: getReqStr(row, r, "created_at"),
  };
}

export async function insertProvenance(client: TrinoClient, input: CreateProvenanceInput, ctx: WriteContext): Promise<AssetProvenance> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.asset_provenance (id, version_id, creator, software_used, software_version, render_job_id, pipeline_stage, vast_storage_path, vast_element_handle, source_host, source_process_id, created_at) VALUES (${esc(id)}, ${esc(input.versionId)}, ${esc(input.creator)}, ${esc(input.softwareUsed)}, ${esc(input.softwareVersion)}, ${esc(input.renderJobId)}, ${esc(input.pipelineStage)}, ${esc(input.vastStoragePath)}, ${esc(input.vastElementHandle)}, ${esc(input.sourceHost)}, ${esc(input.sourceProcessId)}, TIMESTAMP ${esc(now)})`);
  return {
    id, versionId: input.versionId,
    creator: input.creator ?? null, softwareUsed: input.softwareUsed ?? null,
    softwareVersion: input.softwareVersion ?? null, renderJobId: input.renderJobId ?? null,
    pipelineStage: input.pipelineStage ?? null, vastStoragePath: input.vastStoragePath ?? null,
    vastElementHandle: input.vastElementHandle ?? null, sourceHost: input.sourceHost ?? null,
    sourceProcessId: input.sourceProcessId ?? null, createdAt: now
  };
}

export async function queryProvenanceByVersion(client: TrinoClient, versionId: string): Promise<AssetProvenance[]> {
  const r = await client.query(`SELECT * FROM ${S}.asset_provenance WHERE version_id = ${esc(versionId)} ORDER BY created_at`);
  return r.data.map((row) => mapRowToProvenance(row, r));
}

// ---------------------------------------------------------------------------
// Version Lineage (Phase C)
// Bounded-depth queries — NO recursive CTEs (VAST Database limitation)
// ---------------------------------------------------------------------------

function mapRowToLineage(row: unknown[], r: TrinoQueryResult): VersionLineage {
  return {
    id: getReqStr(row, r, "id"),
    ancestorVersionId: getReqStr(row, r, "ancestor_version_id"),
    descendantVersionId: getReqStr(row, r, "descendant_version_id"),
    relationshipType: (getReqStr(row, r, "relationship_type") as LineageRelationshipType) || "parent",
    depth: getReqNum(row, r, "depth"),
    createdAt: getReqStr(row, r, "created_at"),
  };
}

export async function insertLineageEdge(client: TrinoClient, input: CreateLineageEdgeInput, ctx: WriteContext): Promise<VersionLineage> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.version_lineage (id, ancestor_version_id, descendant_version_id, relationship_type, depth, created_at) VALUES (${esc(id)}, ${esc(input.ancestorVersionId)}, ${esc(input.descendantVersionId)}, ${esc(input.relationshipType)}, ${escNum(input.depth)}, TIMESTAMP ${esc(now)})`);
  return {
    id, ancestorVersionId: input.ancestorVersionId,
    descendantVersionId: input.descendantVersionId,
    relationshipType: input.relationshipType,
    depth: input.depth, createdAt: now
  };
}

/**
 * Get ancestors of a version using bounded-depth query.
 * Uses WHERE depth <= maxDepth on the pre-computed depth column.
 */
export async function queryAncestors(client: TrinoClient, versionId: string, maxDepth: number = 10): Promise<VersionLineage[]> {
  const r = await client.query(`SELECT * FROM ${S}.version_lineage WHERE descendant_version_id = ${esc(versionId)} AND depth <= ${escNum(maxDepth)} ORDER BY depth`);
  return r.data.map((row) => mapRowToLineage(row, r));
}

/**
 * Get descendants of a version using bounded-depth query.
 * Sort key is on ancestor_version_id so this query is efficient.
 */
export async function queryDescendants(client: TrinoClient, versionId: string, maxDepth: number = 10): Promise<VersionLineage[]> {
  const r = await client.query(`SELECT * FROM ${S}.version_lineage WHERE ancestor_version_id = ${esc(versionId)} AND depth <= ${escNum(maxDepth)} ORDER BY depth`);
  return r.data.map((row) => mapRowToLineage(row, r));
}

/**
 * Get full version lineage tree for a shot.
 * Joins version_lineage against versions table to find all lineage edges
 * where the ancestor belongs to this shot.
 */
export async function queryVersionTreeByShot(client: TrinoClient, shotId: string): Promise<VersionLineage[]> {
  const r = await client.query(`SELECT vl.* FROM ${S}.version_lineage vl INNER JOIN ${S}.versions v ON vl.ancestor_version_id = v.id WHERE v.shot_id = ${esc(shotId)} ORDER BY vl.depth`);
  return r.data.map((row) => mapRowToLineage(row, r));
}

// ---------------------------------------------------------------------------
// Asset Dependencies (Phase C.4)
// ---------------------------------------------------------------------------

function mapRowToAssetDependency(row: unknown[], r: TrinoQueryResult): AssetDependency {
  return {
    id: getReqStr(row, r, "id"),
    sourceEntityType: getReqStr(row, r, "source_entity_type"),
    sourceEntityId: getReqStr(row, r, "source_entity_id"),
    targetEntityType: getReqStr(row, r, "target_entity_type"),
    targetEntityId: getReqStr(row, r, "target_entity_id"),
    dependencyType: getReqStr(row, r, "dependency_type") as DependencyType,
    dependencyStrength: getReqStr(row, r, "dependency_strength") as DependencyStrength,
    discoveredBy: getStr(row, r, "discovered_by"),
    discoveredAt: getReqStr(row, r, "discovered_at"),
  };
}

export async function insertDependency(client: TrinoClient, input: CreateDependencyInput, ctx: WriteContext): Promise<AssetDependency> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.asset_dependencies (id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, dependency_type, dependency_strength, discovered_by, discovered_at) VALUES (${esc(id)}, ${esc(input.sourceEntityType)}, ${esc(input.sourceEntityId)}, ${esc(input.targetEntityType)}, ${esc(input.targetEntityId)}, ${esc(input.dependencyType)}, ${esc(input.dependencyStrength)}, ${esc(input.discoveredBy)}, TIMESTAMP ${esc(now)})`);
  return {
    id, sourceEntityType: input.sourceEntityType, sourceEntityId: input.sourceEntityId,
    targetEntityType: input.targetEntityType, targetEntityId: input.targetEntityId,
    dependencyType: input.dependencyType, dependencyStrength: input.dependencyStrength,
    discoveredBy: input.discoveredBy ?? null, discoveredAt: now
  };
}

export async function queryDependenciesBySource(client: TrinoClient, entityType: string, entityId: string): Promise<AssetDependency[]> {
  const r = await client.query(`SELECT * FROM ${S}.asset_dependencies WHERE source_entity_type = ${esc(entityType)} AND source_entity_id = ${esc(entityId)} ORDER BY discovered_at`);
  return r.data.map((row) => mapRowToAssetDependency(row, r));
}

export async function queryDependenciesByTarget(client: TrinoClient, entityType: string, entityId: string): Promise<AssetDependency[]> {
  const r = await client.query(`SELECT * FROM ${S}.asset_dependencies WHERE target_entity_type = ${esc(entityType)} AND target_entity_id = ${esc(entityId)} ORDER BY discovered_at`);
  return r.data.map((row) => mapRowToAssetDependency(row, r));
}

/** Reverse dependencies = who depends on this entity (same as queryDependenciesByTarget). */
export async function queryReverseDependencies(client: TrinoClient, entityType: string, entityId: string): Promise<AssetDependency[]> {
  return queryDependenciesByTarget(client, entityType, entityId);
}

/**
 * Get full dependency graph for a material:
 * joins asset_dependencies where source is material or any of its versions,
 * plus shot_asset_usage for fan-out across shots.
 */
export async function queryDependencyGraphForMaterial(client: TrinoClient, materialId: string): Promise<AssetDependency[]> {
  const r = await client.query(`SELECT ad.* FROM ${S}.asset_dependencies ad WHERE (ad.source_entity_type = 'material' AND ad.source_entity_id = ${esc(materialId)}) OR (ad.source_entity_type = 'material_version' AND ad.source_entity_id IN (SELECT id FROM ${S}.material_versions WHERE material_id = ${esc(materialId)})) OR (ad.target_entity_type = 'material' AND ad.target_entity_id = ${esc(materialId)}) OR (ad.target_entity_type = 'material_version' AND ad.target_entity_id IN (SELECT id FROM ${S}.material_versions WHERE material_id = ${esc(materialId)})) ORDER BY ad.discovered_at`);
  return r.data.map((row) => mapRowToAssetDependency(row, r));
}

// ---------------------------------------------------------------------------
// Shot Asset Usage (Phase C.4)
// ---------------------------------------------------------------------------

function mapRowToShotUsage(row: unknown[], r: TrinoQueryResult): ShotAssetUsage {
  return {
    id: getReqStr(row, r, "id"),
    shotId: getReqStr(row, r, "shot_id"),
    versionId: getReqStr(row, r, "version_id"),
    usageType: getReqStr(row, r, "usage_type") as UsageType,
    layerName: getStr(row, r, "layer_name"),
    isActive: Boolean(getReqNum(row, r, "is_active")),
    addedAt: getReqStr(row, r, "added_at"),
    removedAt: getStr(row, r, "removed_at"),
  };
}

export async function insertShotAssetUsage(client: TrinoClient, input: CreateShotAssetUsageInput, ctx: WriteContext): Promise<ShotAssetUsage> {
  const id = randomUUID();
  const now = nowIso(ctx);
  const isActive = input.isActive !== false;
  await client.query(`INSERT INTO ${S}.shot_asset_usage (id, shot_id, version_id, usage_type, layer_name, is_active, added_at, removed_at) VALUES (${esc(id)}, ${esc(input.shotId)}, ${esc(input.versionId)}, ${esc(input.usageType)}, ${esc(input.layerName)}, ${isActive}, TIMESTAMP ${esc(now)}, NULL)`);
  return {
    id, shotId: input.shotId, versionId: input.versionId,
    usageType: input.usageType, layerName: input.layerName ?? null,
    isActive, addedAt: now, removedAt: null
  };
}

export async function queryShotUsage(client: TrinoClient, shotId: string): Promise<ShotAssetUsage[]> {
  const r = await client.query(`SELECT * FROM ${S}.shot_asset_usage WHERE shot_id = ${esc(shotId)} ORDER BY added_at`);
  return r.data.map((row) => mapRowToShotUsage(row, r));
}

export async function queryVersionUsageAcrossShots(client: TrinoClient, versionId: string): Promise<ShotAssetUsage[]> {
  const r = await client.query(`SELECT * FROM ${S}.shot_asset_usage WHERE version_id = ${esc(versionId)} ORDER BY added_at`);
  return r.data.map((row) => mapRowToShotUsage(row, r));
}

// ---------------------------------------------------------------------------
// Collections (Phase B.6)
// ---------------------------------------------------------------------------

function mapRowToCollection(row: unknown[], r: TrinoQueryResult): Collection {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    name: getReqStr(row, r, "name"),
    description: getStr(row, r, "description"),
    collectionType: getReqStr(row, r, "collection_type") as Collection["collectionType"],
    ownerId: getReqStr(row, r, "owner_id"),
    status: getReqStr(row, r, "status") as Collection["status"],
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at"),
  };
}

function mapRowToCollectionItem(row: unknown[], r: TrinoQueryResult): CollectionItem {
  return {
    id: getReqStr(row, r, "id"),
    collectionId: getReqStr(row, r, "collection_id"),
    entityType: getReqStr(row, r, "entity_type") as CollectionItem["entityType"],
    entityId: getReqStr(row, r, "entity_id"),
    sortOrder: getReqNum(row, r, "sort_order"),
    addedBy: getReqStr(row, r, "added_by"),
    addedAt: getReqStr(row, r, "added_at"),
    notes: getStr(row, r, "notes"),
  };
}

export async function insertCollection(client: TrinoClient, input: CreateCollectionInput, ctx: WriteContext): Promise<Collection> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.collections (id, project_id, name, description, collection_type, owner_id, status, created_at, updated_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.name)}, ${esc(input.description)}, ${esc(input.collectionType)}, ${esc(input.ownerId)}, 'active', TIMESTAMP ${esc(now)}, TIMESTAMP ${esc(now)})`);
  return {
    id, projectId: input.projectId, name: input.name,
    description: input.description ?? null, collectionType: input.collectionType,
    ownerId: input.ownerId, status: "active", createdAt: now, updatedAt: now
  };
}

export async function queryCollectionById(client: TrinoClient, id: string): Promise<Collection | null> {
  const r = await client.query(`SELECT * FROM ${S}.collections WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToCollection(r.data[0], r) : null;
}

export async function queryCollectionsByProject(client: TrinoClient, projectId: string): Promise<Collection[]> {
  const r = await client.query(`SELECT * FROM ${S}.collections WHERE project_id = ${esc(projectId)} AND status = 'active' ORDER BY created_at`);
  return r.data.map((row) => mapRowToCollection(row, r));
}

export async function insertCollectionItem(client: TrinoClient, input: AddCollectionItemInput, ctx: WriteContext): Promise<CollectionItem> {
  const id = randomUUID();
  const now = nowIso(ctx);
  const sortOrder = input.sortOrder ?? 0;
  await client.query(`INSERT INTO ${S}.collection_items (id, collection_id, entity_type, entity_id, sort_order, added_by, added_at, notes) VALUES (${esc(id)}, ${esc(input.collectionId)}, ${esc(input.entityType)}, ${esc(input.entityId)}, ${sortOrder}, ${esc(input.addedBy)}, TIMESTAMP ${esc(now)}, ${esc(input.notes)})`);
  return {
    id, collectionId: input.collectionId, entityType: input.entityType,
    entityId: input.entityId, sortOrder, addedBy: input.addedBy,
    addedAt: now, notes: input.notes ?? null
  };
}

export async function deleteCollectionItem(client: TrinoClient, collectionId: string, itemId: string): Promise<boolean> {
  const r = await client.query(`DELETE FROM ${S}.collection_items WHERE id = ${esc(itemId)} AND collection_id = ${esc(collectionId)}`);
  return r.data.length >= 0; // Trino DELETE succeeds silently
}

export async function queryCollectionItems(client: TrinoClient, collectionId: string): Promise<CollectionItem[]> {
  const r = await client.query(`SELECT * FROM ${S}.collection_items WHERE collection_id = ${esc(collectionId)} ORDER BY sort_order`);
  return r.data.map((row) => mapRowToCollectionItem(row, r));
}

// ---------------------------------------------------------------------------
// Capacity Planning — Storage Metrics (Phase C.7)
// ---------------------------------------------------------------------------

function mapRowToStorageMetric(row: unknown[], r: TrinoQueryResult): StorageMetric {
  return {
    id: getReqStr(row, r, "id"),
    entityType: getReqStr(row, r, "entity_type"),
    entityId: getReqStr(row, r, "entity_id"),
    totalBytes: getReqNum(row, r, "total_bytes"),
    fileCount: getReqNum(row, r, "file_count"),
    proxyBytes: getReqNum(row, r, "proxy_bytes"),
    thumbnailBytes: getReqNum(row, r, "thumbnail_bytes"),
    storageTier: (getStr(row, r, "storage_tier") ?? "hot") as StorageTier,
    measuredAt: getReqStr(row, r, "measured_at"),
  };
}

export async function insertStorageMetric(client: TrinoClient, input: CreateStorageMetricInput, ctx: WriteContext): Promise<StorageMetric> {
  const id = randomUUID();
  const now = nowIso(ctx);
  const proxyBytes = input.proxyBytes ?? 0;
  const thumbnailBytes = input.thumbnailBytes ?? 0;
  const storageTier = input.storageTier ?? "hot";
  await client.query(`INSERT INTO ${S}.storage_metrics (id, entity_type, entity_id, total_bytes, file_count, proxy_bytes, thumbnail_bytes, storage_tier, measured_at) VALUES (${esc(id)}, ${esc(input.entityType)}, ${esc(input.entityId)}, ${escNum(input.totalBytes)}, ${escNum(input.fileCount)}, ${escNum(proxyBytes)}, ${escNum(thumbnailBytes)}, ${esc(storageTier)}, TIMESTAMP ${esc(now)})`);
  return {
    id, entityType: input.entityType, entityId: input.entityId,
    totalBytes: input.totalBytes, fileCount: input.fileCount,
    proxyBytes, thumbnailBytes, storageTier, measuredAt: now
  };
}

export async function queryStorageMetricsByEntity(client: TrinoClient, entityType: string, entityId: string): Promise<StorageMetric[]> {
  const r = await client.query(`SELECT * FROM ${S}.storage_metrics WHERE entity_type = ${esc(entityType)} AND entity_id = ${esc(entityId)} ORDER BY measured_at`);
  return r.data.map((row) => mapRowToStorageMetric(row, r));
}

export async function queryLatestStorageMetric(client: TrinoClient, entityType: string, entityId: string): Promise<StorageMetric | null> {
  const r = await client.query(`SELECT * FROM ${S}.storage_metrics WHERE entity_type = ${esc(entityType)} AND entity_id = ${esc(entityId)} ORDER BY measured_at DESC LIMIT 1`);
  return r.data.length > 0 ? mapRowToStorageMetric(r.data[0], r) : null;
}

export async function queryStorageSummaryByProject(client: TrinoClient, projectId: string): Promise<StorageMetric[]> {
  const r = await client.query(`SELECT * FROM ${S}.storage_metrics WHERE entity_type = 'project' AND entity_id = ${esc(projectId)} ORDER BY measured_at`);
  return r.data.map((row) => mapRowToStorageMetric(row, r));
}

// ---------------------------------------------------------------------------
// Capacity Planning — Render Farm Metrics (Phase C.7)
// ---------------------------------------------------------------------------

function mapRowToRenderFarmMetric(row: unknown[], r: TrinoQueryResult): RenderFarmMetric {
  return {
    id: getReqStr(row, r, "id"),
    projectId: getReqStr(row, r, "project_id"),
    shotId: getStr(row, r, "shot_id"),
    versionId: getStr(row, r, "version_id"),
    renderEngine: getStr(row, r, "render_engine"),
    renderTimeSeconds: getNum(row, r, "render_time_seconds"),
    coreHours: getNum(row, r, "core_hours"),
    peakMemoryGb: getNum(row, r, "peak_memory_gb"),
    frameCount: getNum(row, r, "frame_count"),
    submittedAt: getStr(row, r, "submitted_at"),
    completedAt: getReqStr(row, r, "completed_at"),
  };
}

export async function insertRenderFarmMetric(client: TrinoClient, input: CreateRenderFarmMetricInput, ctx: WriteContext): Promise<RenderFarmMetric> {
  const id = randomUUID();
  const now = nowIso(ctx);
  await client.query(`INSERT INTO ${S}.render_farm_metrics (id, project_id, shot_id, version_id, render_engine, render_time_seconds, core_hours, peak_memory_gb, frame_count, submitted_at, completed_at) VALUES (${esc(id)}, ${esc(input.projectId)}, ${esc(input.shotId)}, ${esc(input.versionId)}, ${esc(input.renderEngine)}, ${escNum(input.renderTimeSeconds)}, ${escNum(input.coreHours)}, ${escNum(input.peakMemoryGb)}, ${escNum(input.frameCount)}, ${input.submittedAt ? `TIMESTAMP ${esc(input.submittedAt)}` : "NULL"}, TIMESTAMP ${esc(now)})`);
  return {
    id, projectId: input.projectId,
    shotId: input.shotId ?? null, versionId: input.versionId ?? null,
    renderEngine: input.renderEngine ?? null,
    renderTimeSeconds: input.renderTimeSeconds ?? null,
    coreHours: input.coreHours ?? null,
    peakMemoryGb: input.peakMemoryGb ?? null,
    frameCount: input.frameCount ?? null,
    submittedAt: input.submittedAt ?? null,
    completedAt: now
  };
}

export async function queryRenderMetricsByProject(client: TrinoClient, projectId: string, from?: string, to?: string): Promise<RenderFarmMetric[]> {
  let sql = `SELECT * FROM ${S}.render_farm_metrics WHERE project_id = ${esc(projectId)}`;
  if (from) sql += ` AND completed_at >= TIMESTAMP ${esc(from)}`;
  if (to) sql += ` AND completed_at <= TIMESTAMP ${esc(to)}`;
  sql += ` ORDER BY completed_at`;
  const r = await client.query(sql);
  return r.data.map((row) => mapRowToRenderFarmMetric(row, r));
}

export async function queryRenderMetricsByShot(client: TrinoClient, shotId: string): Promise<RenderFarmMetric[]> {
  const r = await client.query(`SELECT * FROM ${S}.render_farm_metrics WHERE shot_id = ${esc(shotId)} ORDER BY completed_at`);
  return r.data.map((row) => mapRowToRenderFarmMetric(row, r));
}

// ---------------------------------------------------------------------------
// Capacity Planning — Downstream Usage Counts (Phase C.7)
// ---------------------------------------------------------------------------

function mapRowToDownstreamUsageCount(row: unknown[], r: TrinoQueryResult): DownstreamUsageCount {
  return {
    entityType: getReqStr(row, r, "entity_type"),
    entityId: getReqStr(row, r, "entity_id"),
    directDependents: getReqNum(row, r, "direct_dependents"),
    transitiveDependents: getReqNum(row, r, "transitive_dependents"),
    shotCount: getReqNum(row, r, "shot_count"),
    lastComputedAt: getReqStr(row, r, "last_computed_at"),
  };
}

export async function upsertDownstreamUsageCount(client: TrinoClient, input: UpsertDownstreamUsageCountInput, ctx: WriteContext): Promise<DownstreamUsageCount> {
  const now = nowIso(ctx);
  // VAST/Trino: DELETE then INSERT to simulate upsert (no native MERGE support)
  await client.query(`DELETE FROM ${S}.downstream_usage_counts WHERE entity_type = ${esc(input.entityType)} AND entity_id = ${esc(input.entityId)}`);
  await client.query(`INSERT INTO ${S}.downstream_usage_counts (entity_type, entity_id, direct_dependents, transitive_dependents, shot_count, last_computed_at) VALUES (${esc(input.entityType)}, ${esc(input.entityId)}, ${escNum(input.directDependents)}, ${escNum(input.transitiveDependents)}, ${escNum(input.shotCount)}, TIMESTAMP ${esc(now)})`);
  return {
    entityType: input.entityType, entityId: input.entityId,
    directDependents: input.directDependents,
    transitiveDependents: input.transitiveDependents,
    shotCount: input.shotCount,
    lastComputedAt: now
  };
}

export async function queryDownstreamUsageCount(client: TrinoClient, entityType: string, entityId: string): Promise<DownstreamUsageCount | null> {
  const r = await client.query(`SELECT * FROM ${S}.downstream_usage_counts WHERE entity_type = ${esc(entityType)} AND entity_id = ${esc(entityId)}`);
  return r.data.length > 0 ? mapRowToDownstreamUsageCount(r.data[0], r) : null;
}

// ---------------------------------------------------------------------------
// IAM — Users (Phase 1.2)
// ---------------------------------------------------------------------------

import type {
  User,
  UserStatus,
  ProjectMembership,
  ProjectRole,
  GlobalRoleAssignment,
  GlobalRole,
  ApiKeyRecord,
} from "../../iam/types.js";

function mapRowToIamUser(row: unknown[], r: TrinoQueryResult): User {
  return {
    id: getReqStr(row, r, "id"),
    externalId: getStr(row, r, "external_id"),
    email: getReqStr(row, r, "email"),
    displayName: getReqStr(row, r, "display_name"),
    avatarUrl: getStr(row, r, "avatar_url"),
    status: getReqStr(row, r, "status") as UserStatus,
    createdAt: getReqStr(row, r, "created_at"),
    updatedAt: getReqStr(row, r, "updated_at"),
  };
}

export async function insertIamUser(client: TrinoClient, user: User): Promise<void> {
  await client.query(
    `INSERT INTO ${S}.iam_users (id, external_id, email, display_name, avatar_url, status, created_at, updated_at) VALUES (${esc(user.id)}, ${esc(user.externalId)}, ${esc(user.email)}, ${esc(user.displayName)}, ${esc(user.avatarUrl)}, ${esc(user.status)}, TIMESTAMP ${esc(user.createdAt)}, TIMESTAMP ${esc(user.updatedAt)})`
  );
}

export async function queryIamUserById(client: TrinoClient, id: string): Promise<User | null> {
  const r = await client.query(`SELECT * FROM ${S}.iam_users WHERE id = ${esc(id)}`);
  return r.data.length > 0 ? mapRowToIamUser(r.data[0], r) : null;
}

export async function queryIamUserByExternalId(client: TrinoClient, externalId: string): Promise<User | null> {
  const r = await client.query(`SELECT * FROM ${S}.iam_users WHERE external_id = ${esc(externalId)}`);
  return r.data.length > 0 ? mapRowToIamUser(r.data[0], r) : null;
}

export async function queryIamUserByEmail(client: TrinoClient, email: string): Promise<User | null> {
  const r = await client.query(`SELECT * FROM ${S}.iam_users WHERE email = ${esc(email)}`);
  return r.data.length > 0 ? mapRowToIamUser(r.data[0], r) : null;
}

export async function queryIamUsers(client: TrinoClient): Promise<User[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_users ORDER BY created_at`);
  return r.data.map((row) => mapRowToIamUser(row, r));
}

export async function updateIamUserStatus(client: TrinoClient, userId: string, status: UserStatus): Promise<void> {
  const now = new Date().toISOString();
  await client.query(`UPDATE ${S}.iam_users SET status = ${esc(status)}, updated_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(userId)}`);
}

// ---------------------------------------------------------------------------
// IAM — Project Memberships (Phase 1.2)
// ---------------------------------------------------------------------------

function mapRowToMembership(row: unknown[], r: TrinoQueryResult): ProjectMembership {
  return {
    id: getReqStr(row, r, "id"),
    userId: getReqStr(row, r, "user_id"),
    projectId: getReqStr(row, r, "project_id"),
    tenantId: getReqStr(row, r, "tenant_id"),
    role: getReqStr(row, r, "role") as ProjectRole,
    grantedBy: getReqStr(row, r, "granted_by"),
    grantedAt: getReqStr(row, r, "granted_at"),
  };
}

export async function insertIamMembership(client: TrinoClient, m: ProjectMembership): Promise<void> {
  await client.query(
    `INSERT INTO ${S}.iam_project_memberships (id, user_id, project_id, tenant_id, role, granted_by, granted_at) VALUES (${esc(m.id)}, ${esc(m.userId)}, ${esc(m.projectId)}, ${esc(m.tenantId)}, ${esc(m.role)}, ${esc(m.grantedBy)}, TIMESTAMP ${esc(m.grantedAt)})`
  );
}

export async function queryIamMembershipsByUser(client: TrinoClient, userId: string): Promise<ProjectMembership[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_project_memberships WHERE user_id = ${esc(userId)} ORDER BY granted_at`);
  return r.data.map((row) => mapRowToMembership(row, r));
}

export async function queryIamMembershipsByProject(client: TrinoClient, projectId: string): Promise<ProjectMembership[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_project_memberships WHERE project_id = ${esc(projectId)} ORDER BY granted_at`);
  return r.data.map((row) => mapRowToMembership(row, r));
}

export async function deleteIamMembership(client: TrinoClient, userId: string, projectId: string): Promise<void> {
  await client.query(`DELETE FROM ${S}.iam_project_memberships WHERE user_id = ${esc(userId)} AND project_id = ${esc(projectId)}`);
}

export async function updateIamMembershipRole(client: TrinoClient, userId: string, projectId: string, role: ProjectRole, grantedBy: string): Promise<void> {
  const now = new Date().toISOString();
  // VAST/Trino: DELETE then INSERT to simulate upsert
  await deleteIamMembership(client, userId, projectId);
  await client.query(
    `INSERT INTO ${S}.iam_project_memberships (id, user_id, project_id, tenant_id, role, granted_by, granted_at) VALUES (${esc(randomUUID())}, ${esc(userId)}, ${esc(projectId)}, 'default', ${esc(role)}, ${esc(grantedBy)}, TIMESTAMP ${esc(now)})`
  );
}

// ---------------------------------------------------------------------------
// IAM — Global Roles (Phase 1.2)
// ---------------------------------------------------------------------------

function mapRowToGlobalRole(row: unknown[], r: TrinoQueryResult): GlobalRoleAssignment {
  return {
    userId: getReqStr(row, r, "user_id"),
    role: getReqStr(row, r, "role") as GlobalRole,
    grantedBy: getReqStr(row, r, "granted_by"),
    grantedAt: getReqStr(row, r, "granted_at"),
  };
}

export async function insertIamGlobalRole(client: TrinoClient, assignment: GlobalRoleAssignment): Promise<void> {
  await client.query(
    `INSERT INTO ${S}.iam_global_roles (user_id, role, granted_by, granted_at) VALUES (${esc(assignment.userId)}, ${esc(assignment.role)}, ${esc(assignment.grantedBy)}, TIMESTAMP ${esc(assignment.grantedAt)})`
  );
}

export async function queryIamGlobalRoles(client: TrinoClient): Promise<GlobalRoleAssignment[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_global_roles ORDER BY granted_at`);
  return r.data.map((row) => mapRowToGlobalRole(row, r));
}

export async function queryIamGlobalRoleByUser(client: TrinoClient, userId: string): Promise<GlobalRoleAssignment | null> {
  const r = await client.query(`SELECT * FROM ${S}.iam_global_roles WHERE user_id = ${esc(userId)}`);
  return r.data.length > 0 ? mapRowToGlobalRole(r.data[0], r) : null;
}

export async function deleteIamGlobalRole(client: TrinoClient, userId: string): Promise<void> {
  await client.query(`DELETE FROM ${S}.iam_global_roles WHERE user_id = ${esc(userId)}`);
}

// ---------------------------------------------------------------------------
// IAM — API Keys (Phase 1.2)
// ---------------------------------------------------------------------------

function mapRowToApiKey(row: unknown[], r: TrinoQueryResult): ApiKeyRecord {
  const scopesRaw = getStr(row, r, "scopes");
  return {
    id: getReqStr(row, r, "id"),
    keyHash: getReqStr(row, r, "key_hash"),
    ownerId: getReqStr(row, r, "owner_id"),
    label: getStr(row, r, "label"),
    scopes: scopesRaw ? scopesRaw.split(",") : [],
    expiresAt: getStr(row, r, "expires_at"),
    createdAt: getReqStr(row, r, "created_at"),
    lastUsedAt: getStr(row, r, "last_used_at"),
  };
}

export interface InsertApiKeyInput {
  id: string;
  keyHash: string;
  keySalt: string;
  ownerId: string;
  label: string | null;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

export async function insertIamApiKey(client: TrinoClient, input: InsertApiKeyInput): Promise<void> {
  const scopesStr = input.scopes.join(",");
  await client.query(
    `INSERT INTO ${S}.iam_api_keys (id, key_hash, key_salt, owner_id, label, scopes, expires_at, created_at, last_used_at, revoked) VALUES (${esc(input.id)}, ${esc(input.keyHash)}, ${esc(input.keySalt)}, ${esc(input.ownerId)}, ${esc(input.label)}, ${esc(scopesStr)}, ${input.expiresAt ? `TIMESTAMP ${esc(input.expiresAt)}` : "NULL"}, TIMESTAMP ${esc(input.createdAt)}, NULL, false)`
  );
}

export async function queryIamApiKeysByOwner(client: TrinoClient, ownerId: string): Promise<ApiKeyRecord[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_api_keys WHERE owner_id = ${esc(ownerId)} AND revoked = false ORDER BY created_at`);
  return r.data.map((row) => mapRowToApiKey(row, r));
}

export async function queryAllActiveIamApiKeys(client: TrinoClient): Promise<ApiKeyRecord[]> {
  const r = await client.query(`SELECT * FROM ${S}.iam_api_keys WHERE revoked = false ORDER BY created_at`);
  return r.data.map((row) => mapRowToApiKey(row, r));
}

export async function revokeIamApiKey(client: TrinoClient, keyId: string): Promise<void> {
  await client.query(`UPDATE ${S}.iam_api_keys SET revoked = true WHERE id = ${esc(keyId)}`);
}

export async function updateIamApiKeyLastUsed(client: TrinoClient, keyId: string): Promise<void> {
  const now = new Date().toISOString();
  await client.query(`UPDATE ${S}.iam_api_keys SET last_used_at = TIMESTAMP ${esc(now)} WHERE id = ${esc(keyId)}`);
}
