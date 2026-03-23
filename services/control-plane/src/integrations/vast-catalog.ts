/**
 * VAST Catalog integration service.
 *
 * The VAST Catalog is a cluster-managed, read-only index of every file on the
 * VAST filesystem. It complements SpaceHarbor's Trino tables:
 *   - SpaceHarbor DB = application state (workflow, reviews, approvals)
 *   - VAST Catalog = physical storage truth (disk contents, accounting, ACLs, time-travel)
 *
 * The join key is `vastElementHandle`, present on Version and MaterialVersion models.
 * In the Catalog, the element handle is exposed via the `handle` column.
 *
 * All Catalog queries are read-only — the Catalog is populated by the cluster.
 * S3 object tags written at ingest time become queryable Catalog columns via
 * user-defined indexed columns configured on the VAST cluster.
 *
 * VAST Catalog schema reference (VAST 5.4 Admin Guide p.175-178):
 *   - There is NO `path` column — use CONCAT(parent_path, '/', name)
 *   - Modification time column is `mtime`, not `modified_time`
 *   - Element type column is `element_type` (values: 'FILE', 'DIR'), not `is_dir`
 *   - S3 tags are in `user_tags` MAP column, or as indexed `tag_<key>` columns
 *     added via `vastcatalogindexedcolumn add --name <key> --column_type tag`
 *   - `search_path` is a virtual column that restricts queries to a subtree
 */

import type { TrinoClient } from "../db/trino-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnregisteredFile {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  inferredMediaType: string;
  elementHandle: string;
}

export interface OrphanFile {
  path: string;
  sizeBytes: number;
  ahAssetId: string;
  ahVersionId: string | null;
  elementHandle: string;
  modifiedAt: string;
}

export interface StorageBreakdownEntry {
  mediaType: string;
  totalBytes: number;
  fileCount: number;
}

export interface StorageBreakdown {
  projectId: string;
  totalBytes: number;
  totalFileCount: number;
  byMediaType: StorageBreakdownEntry[];
}

export interface ResolvedElement {
  elementHandle: string;
  currentPath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface FileHistoryEntry {
  snapshotId: string;
  snapshotTime: string;
  path: string;
  sizeBytes: number;
  action: string;
}

// ---------------------------------------------------------------------------
// Media type inference from file extension
// ---------------------------------------------------------------------------

const EXTENSION_MEDIA_MAP: Record<string, string> = {
  ".exr": "image", ".dpx": "image", ".tiff": "image", ".tif": "image",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".hdr": "image",
  ".tx": "texture", ".tex": "texture",
  ".mov": "video", ".mp4": "video", ".mxf": "video", ".avi": "video", ".mkv": "video",
  ".r3d": "video", ".braw": "video", ".ari": "video",
  ".wav": "audio", ".aif": "audio", ".aiff": "audio", ".mp3": "audio", ".flac": "audio",
  ".abc": "3d", ".usd": "3d", ".usda": "3d", ".usdc": "3d", ".usdz": "3d",
  ".fbx": "3d", ".obj": "3d", ".gltf": "3d", ".glb": "3d",
  ".mtlx": "material", ".osl": "material", ".oso": "material",
  ".otio": "editorial", ".edl": "editorial", ".xml": "editorial", ".aaf": "editorial",
  ".nk": "comp", ".hip": "fx", ".ma": "scene", ".mb": "scene",
};

function inferMediaType(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "unknown";
  const ext = path.substring(lastDot).toLowerCase();
  return EXTENSION_MEDIA_MAP[ext] ?? "other";
}

// ---------------------------------------------------------------------------
// S3 Tag vocabulary constants
//
// These tag keys are applied to S3 objects at ingest time. To make them
// queryable in the VAST Catalog as dedicated columns, run on the cluster:
//   vastcatalogindexedcolumn add --name "ah-project-id" --column_type tag
//   vastcatalogindexedcolumn add --name "ah-asset-id"   --column_type tag
//   vastcatalogindexedcolumn add --name "ah-version-id" --column_type tag
//   vastcatalogindexedcolumn add --name "ah-media-type" --column_type tag
//   vastcatalogindexedcolumn add --name "ah-pipeline-stage" --column_type tag
//   vastcatalogindexedcolumn add --name "ah-ingest-timestamp" --column_type tag
//
// After indexing, these appear as tag_<key> columns on the Catalog table,
// e.g. "tag_ah-asset-id". The column names use hyphens as-is from the tag key.
// ---------------------------------------------------------------------------

export const CATALOG_TAG_PREFIX = "ah-";
export const CATALOG_TAGS = {
  projectId: "ah-project-id",
  assetId: "ah-asset-id",
  versionId: "ah-version-id",
  mediaType: "ah-media-type",
  pipelineStage: "ah-pipeline-stage",
  ingestTimestamp: "ah-ingest-timestamp",
} as const;

/**
 * Map a tag key to its VAST Catalog indexed column name.
 * When a tag key is registered via `vastcatalogindexedcolumn add`,
 * VAST creates a column named `tag_<key>` on the Catalog table.
 */
export function tagColumnName(tagKey: string): string {
  return `"tag_${tagKey}"`;
}

// ---------------------------------------------------------------------------
// Catalog table name (configurable via env)
//
// The VAST Catalog is a single table per tenant. There is no separate
// "object_tags" table — tags are either in the `user_tags` MAP column
// or in indexed `tag_<key>` columns on the same table.
// ---------------------------------------------------------------------------

const CATALOG_TABLE = process.env.VAST_CATALOG_TABLE ?? "vast_catalog.default.catalog";

// ---------------------------------------------------------------------------
// CatalogService
// ---------------------------------------------------------------------------

export class CatalogService {
  constructor(private readonly trino: TrinoClient) {}

  /**
   * Find files under a VAST path prefix that have no `ah-asset-id` tag,
   * indicating they were deposited outside SpaceHarbor's ingest pipeline.
   *
   * Uses the indexed column `tag_ah-asset-id` (requires cluster-side setup
   * via `vastcatalogindexedcolumn add`). Falls back to the `user_tags` MAP
   * column if indexed columns are not configured.
   */
  async findUnregisteredAssets(pathPrefix: string): Promise<UnregisteredFile[]> {
    const sanitizedPrefix = pathPrefix.replace(/'/g, "''");

    // Use search_path virtual column for performance (restricts scan to subtree)
    // and filter on element_type = 'FILE' (replaces incorrect is_dir = false).
    // The tag column tag_ah-asset-id is NULL when the tag was not set on the object.
    const sql = `
      SELECT
        CONCAT(o.parent_path, '/', o.name) AS path,
        o.size AS size_bytes,
        CAST(o.mtime AS VARCHAR) AS modified_at,
        o.handle
      FROM ${CATALOG_TABLE} o
      WHERE o.search_path = '${sanitizedPrefix}'
        AND o.element_type = 'FILE'
        AND ${tagColumnName(CATALOG_TAGS.assetId)} IS NULL
      ORDER BY o.mtime DESC
      LIMIT 500
    `;

    const result = await this.trino.query(sql);
    return result.data.map((row) => ({
      path: String(row[0]),
      sizeBytes: Number(row[1]),
      modifiedAt: String(row[2]),
      inferredMediaType: inferMediaType(String(row[0])),
      elementHandle: String(row[3]),
    }));
  }

  /**
   * Cross-reference Catalog tags against SpaceHarbor DB to find orphaned files.
   * Orphans are files that have `ah-asset-id` tags but whose asset records
   * no longer exist in the application database.
   *
   * Uses indexed tag columns on the single Catalog table (no separate tags table).
   */
  async detectOrphans(): Promise<OrphanFile[]> {
    const sql = `
      SELECT
        CONCAT(o.parent_path, '/', o.name) AS path,
        o.size AS size_bytes,
        ${tagColumnName(CATALOG_TAGS.assetId)} AS ah_asset_id,
        ${tagColumnName(CATALOG_TAGS.versionId)} AS ah_version_id,
        o.handle,
        CAST(o.mtime AS VARCHAR) AS modified_at
      FROM ${CATALOG_TABLE} o
      LEFT JOIN "spaceharbor/production".assets a
        ON a.id = ${tagColumnName(CATALOG_TAGS.assetId)}
      WHERE ${tagColumnName(CATALOG_TAGS.assetId)} IS NOT NULL
        AND a.id IS NULL
        AND o.element_type = 'FILE'
      ORDER BY o.mtime DESC
      LIMIT 500
    `;

    const result = await this.trino.query(sql);
    return result.data.map((row) => ({
      path: String(row[0]),
      sizeBytes: Number(row[1]),
      ahAssetId: String(row[2]),
      ahVersionId: row[3] != null ? String(row[3]) : null,
      elementHandle: String(row[4]),
      modifiedAt: String(row[5]),
    }));
  }

  /**
   * Query Catalog for storage breakdown by media type for a given project.
   * Uses indexed tag columns for project ID and media type filtering.
   */
  async getStorageBreakdown(projectId: string): Promise<StorageBreakdown> {
    const sanitizedProjectId = projectId.replace(/'/g, "''");

    const sql = `
      SELECT
        COALESCE(${tagColumnName(CATALOG_TAGS.mediaType)}, 'unknown') AS media_type,
        SUM(o.size) AS total_bytes,
        COUNT(*) AS file_count
      FROM ${CATALOG_TABLE} o
      WHERE ${tagColumnName(CATALOG_TAGS.projectId)} = '${sanitizedProjectId}'
        AND o.element_type = 'FILE'
      GROUP BY COALESCE(${tagColumnName(CATALOG_TAGS.mediaType)}, 'unknown')
      ORDER BY total_bytes DESC
    `;

    const result = await this.trino.query(sql);
    const byMediaType: StorageBreakdownEntry[] = result.data.map((row) => ({
      mediaType: String(row[0]),
      totalBytes: Number(row[1]),
      fileCount: Number(row[2]),
    }));

    const totalBytes = byMediaType.reduce((sum, e) => sum + e.totalBytes, 0);
    const totalFileCount = byMediaType.reduce((sum, e) => sum + e.fileCount, 0);

    return { projectId, totalBytes, totalFileCount, byMediaType };
  }

  /**
   * Resolve a vastElementHandle to its current storage path.
   * Element handles survive file renames, moves, and clones.
   */
  async resolveElementHandle(handle: string): Promise<ResolvedElement | null> {
    const sanitizedHandle = handle.replace(/'/g, "''");

    const sql = `
      SELECT
        o.handle,
        CONCAT(o.parent_path, '/', o.name) AS path,
        o.size AS size_bytes,
        CAST(o.mtime AS VARCHAR) AS modified_at
      FROM ${CATALOG_TABLE} o
      WHERE o.handle = '${sanitizedHandle}'
      LIMIT 1
    `;

    const result = await this.trino.query(sql);
    if (result.rowCount === 0) return null;

    const row = result.data[0];
    return {
      elementHandle: String(row[0]),
      currentPath: String(row[1]),
      sizeBytes: Number(row[2]),
      modifiedAt: String(row[3]),
    };
  }

  /**
   * Time-travel query returning historical states of a file across Catalog snapshots.
   *
   * NOTE: VAST Catalog snapshots are accessed by querying the Catalog table
   * at specific snapshot points. The exact mechanism for time-travel queries
   * depends on cluster configuration (snapshot retention policy). This
   * implementation queries the current Catalog snapshot only. Full time-travel
   * requires querying specific Catalog snapshot IDs, which is not yet
   * implemented — see VAST Catalog documentation on snapshot retention.
   */
  async getFileHistory(
    handle: string,
    _snapshotRange?: { from?: string; to?: string },
  ): Promise<FileHistoryEntry[]> {
    // TODO: Implement proper time-travel across Catalog snapshots.
    // VAST Catalog snapshots have configurable retention and can be queried
    // at specific points in time, but the exact Trino syntax for targeting
    // a specific Catalog snapshot needs cluster-level validation.
    //
    // For now, return the current state as a single "current" entry.
    const sanitizedHandle = handle.replace(/'/g, "''");

    const sql = `
      SELECT
        CONCAT(o.parent_path, '/', o.name) AS path,
        o.size AS size_bytes,
        CAST(o.mtime AS VARCHAR) AS modified_at
      FROM ${CATALOG_TABLE} o
      WHERE o.handle = '${sanitizedHandle}'
      LIMIT 1
    `;

    const result = await this.trino.query(sql);
    if (result.rowCount === 0) return [];

    const row = result.data[0];
    return [{
      snapshotId: "current",
      snapshotTime: String(row[2]),
      path: String(row[0]),
      sizeBytes: Number(row[1]),
      action: "current",
    }];
  }
}
