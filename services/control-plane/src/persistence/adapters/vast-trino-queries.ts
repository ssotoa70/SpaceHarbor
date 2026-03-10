/**
 * Trino SQL query helpers for VastPersistenceAdapter.
 *
 * All read/write operations against VAST Database go through this module.
 * The TrinoClient handles nextUri polling, auth, and error handling.
 * Row-to-domain mapping is done here.
 */

import type { TrinoClient, TrinoQueryResult } from "../../db/trino-client.js";
import type {
  Episode,
  EpisodeStatus,
  Material,
  MaterialStatus,
  MediaType,
  Project,
  ProjectStatus,
  ProjectType,
  ReviewStatus,
  Sequence,
  SequenceStatus,
  Shot,
  ShotStatus,
  Task,
  TaskStatus,
  TaskType,
  TextureType,
  Version,
  VersionApproval,
  VersionStatus,
  ApprovalAction,
  AssetPriority,
  DisplayDataWindow,
  MaterialVersion,
  LookVariant,
  VersionMaterialBinding,
  MaterialDependency
} from "../../domain/models.js";

const S = 'vast."assetharbor/production"';

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

export function esc(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

export function escNum(val: number | null | undefined): string {
  if (val == null) return "NULL";
  return String(val);
}

export function escTimestamp(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `TIMESTAMP '${val.replace(/'/g, "''")}'`;
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
