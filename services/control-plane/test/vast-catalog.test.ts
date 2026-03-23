import test from "node:test";
import assert from "node:assert/strict";

import {
  CatalogService,
  CATALOG_TAGS,
  tagColumnName,
} from "../src/integrations/vast-catalog.js";
import type { TrinoClient } from "../src/db/trino-client.js";
import type { TrinoQueryResult } from "../src/db/trino-client.js";

// ---------------------------------------------------------------------------
// Mock TrinoClient that captures queries for assertion
// ---------------------------------------------------------------------------

function mockTrino(result: TrinoQueryResult): TrinoClient & { lastQuery: string } {
  const mock = {
    lastQuery: "",
    async query(sql: string): Promise<TrinoQueryResult> {
      mock.lastQuery = sql;
      return result;
    },
    async healthCheck() {
      return { reachable: true };
    },
    get authorization() {
      return "Basic mock";
    },
  } as TrinoClient & { lastQuery: string };
  return mock;
}

// ---------------------------------------------------------------------------
// tagColumnName helper
// ---------------------------------------------------------------------------

test("tagColumnName produces quoted tag_<key> column reference", () => {
  assert.equal(tagColumnName("ah-asset-id"), '"tag_ah-asset-id"');
  assert.equal(tagColumnName("ah-project-id"), '"tag_ah-project-id"');
});

// ---------------------------------------------------------------------------
// findUnregisteredAssets
// ---------------------------------------------------------------------------

test("findUnregisteredAssets uses VAST Catalog column names correctly", async () => {
  const trino = mockTrino({
    columns: [
      { name: "path", type: "varchar" },
      { name: "size_bytes", type: "bigint" },
      { name: "modified_at", type: "varchar" },
      { name: "handle", type: "varchar" },
    ],
    data: [
      ["/projects/show1/shot01/render_v003.exr", 104857600, "2026-03-20 14:30:00.000000", "eh-001"],
    ],
    rowCount: 1,
  });

  const service = new CatalogService(trino);
  const results = await service.findUnregisteredAssets("/projects/show1");

  // Verify correct VAST Catalog columns are used
  const sql = trino.lastQuery;

  // Must use CONCAT(parent_path, '/', name) — NOT o.path
  assert.ok(sql.includes("CONCAT(o.parent_path, '/', o.name)"), "should use CONCAT(parent_path, name) not o.path");

  // Must use mtime — NOT modified_time
  assert.ok(sql.includes("o.mtime"), "should use mtime not modified_time");

  // Must use element_type = 'FILE' — NOT is_dir = false
  assert.ok(sql.includes("o.element_type = 'FILE'"), "should use element_type = 'FILE' not is_dir");

  // Must NOT reference a separate object_tags table
  assert.ok(!sql.includes("object_tags"), "should not reference non-existent object_tags table");

  // Must use indexed tag column for asset ID check
  assert.ok(sql.includes('"tag_ah-asset-id"'), "should use indexed tag column for asset ID");

  // Must use search_path virtual column for subtree restriction
  assert.ok(sql.includes("o.search_path"), "should use search_path for performance");

  // Must use o.handle — NOT element_handle
  assert.ok(sql.includes("o.handle"), "should use handle column");

  // Verify result mapping
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "/projects/show1/shot01/render_v003.exr");
  assert.equal(results[0].sizeBytes, 104857600);
  assert.equal(results[0].inferredMediaType, "image");
  assert.equal(results[0].elementHandle, "eh-001");
});

// ---------------------------------------------------------------------------
// detectOrphans
// ---------------------------------------------------------------------------

test("detectOrphans uses indexed tag columns instead of object_tags table", async () => {
  const trino = mockTrino({
    columns: [
      { name: "path", type: "varchar" },
      { name: "size_bytes", type: "bigint" },
      { name: "ah_asset_id", type: "varchar" },
      { name: "ah_version_id", type: "varchar" },
      { name: "handle", type: "varchar" },
      { name: "modified_at", type: "varchar" },
    ],
    data: [
      ["/projects/old/deleted_asset.mov", 52428800, "asset-999", null, "eh-orphan", "2026-03-19 10:00:00.000000"],
    ],
    rowCount: 1,
  });

  const service = new CatalogService(trino);
  const results = await service.detectOrphans();

  const sql = trino.lastQuery;

  // Must NOT join on a separate tags table
  assert.ok(!sql.includes("object_tags"), "should not reference object_tags table");
  assert.ok(!sql.includes("tag_key"), "should not reference tag_key column from non-existent table");

  // Must use indexed tag columns directly
  assert.ok(sql.includes('"tag_ah-asset-id"'), "should use indexed tag column for asset ID");
  assert.ok(sql.includes('"tag_ah-version-id"'), "should use indexed tag column for version ID");

  // Must use correct Catalog columns
  assert.ok(sql.includes("CONCAT(o.parent_path, '/', o.name)"), "should build path from parent_path + name");
  assert.ok(sql.includes("o.mtime"), "should use mtime");
  assert.ok(sql.includes("o.element_type = 'FILE'"), "should filter by element_type");

  // Verify result mapping
  assert.equal(results.length, 1);
  assert.equal(results[0].ahAssetId, "asset-999");
  assert.equal(results[0].ahVersionId, null);
  assert.equal(results[0].elementHandle, "eh-orphan");
});

// ---------------------------------------------------------------------------
// getStorageBreakdown
// ---------------------------------------------------------------------------

test("getStorageBreakdown uses indexed tag columns for filtering", async () => {
  const trino = mockTrino({
    columns: [
      { name: "media_type", type: "varchar" },
      { name: "total_bytes", type: "bigint" },
      { name: "file_count", type: "bigint" },
    ],
    data: [
      ["image", 5368709120, 50],
      ["video", 10737418240, 5],
    ],
    rowCount: 2,
  });

  const service = new CatalogService(trino);
  const result = await service.getStorageBreakdown("proj-001");

  const sql = trino.lastQuery;

  // Must use indexed tag column for project filtering
  assert.ok(sql.includes('"tag_ah-project-id"'), "should use indexed tag column for project ID");
  assert.ok(sql.includes('"tag_ah-media-type"'), "should use indexed tag column for media type");

  // Must NOT join on object_tags
  assert.ok(!sql.includes("object_tags"), "should not reference object_tags table");

  // Must use element_type
  assert.ok(sql.includes("o.element_type = 'FILE'"), "should filter by element_type");

  // Verify aggregation
  assert.equal(result.projectId, "proj-001");
  assert.equal(result.totalBytes, 5368709120 + 10737418240);
  assert.equal(result.totalFileCount, 55);
  assert.equal(result.byMediaType.length, 2);
});

// ---------------------------------------------------------------------------
// resolveElementHandle
// ---------------------------------------------------------------------------

test("resolveElementHandle uses handle column and builds path correctly", async () => {
  const trino = mockTrino({
    columns: [
      { name: "handle", type: "varchar" },
      { name: "path", type: "varchar" },
      { name: "size_bytes", type: "bigint" },
      { name: "modified_at", type: "varchar" },
    ],
    data: [
      ["eh-resolve-1", "/projects/show1/moved_file.exr", 209715200, "2026-03-21 09:00:00.000000"],
    ],
    rowCount: 1,
  });

  const service = new CatalogService(trino);
  const result = await service.resolveElementHandle("eh-resolve-1");

  const sql = trino.lastQuery;

  // Must use o.handle for lookup
  assert.ok(sql.includes("o.handle = 'eh-resolve-1'"), "should filter by handle column");

  // Must build path correctly
  assert.ok(sql.includes("CONCAT(o.parent_path, '/', o.name)"), "should build path from parent_path + name");

  // Must use mtime
  assert.ok(sql.includes("o.mtime"), "should use mtime");

  assert.ok(result !== null);
  assert.equal(result!.elementHandle, "eh-resolve-1");
  assert.equal(result!.currentPath, "/projects/show1/moved_file.exr");
});

test("resolveElementHandle returns null when handle not found", async () => {
  const trino = mockTrino({
    columns: [],
    data: [],
    rowCount: 0,
  });

  const service = new CatalogService(trino);
  const result = await service.resolveElementHandle("nonexistent");
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// getFileHistory
// ---------------------------------------------------------------------------

test("getFileHistory returns current state (time-travel not yet implemented)", async () => {
  const trino = mockTrino({
    columns: [
      { name: "path", type: "varchar" },
      { name: "size_bytes", type: "bigint" },
      { name: "modified_at", type: "varchar" },
    ],
    data: [
      ["/projects/show1/current.exr", 104857600, "2026-03-21 12:00:00.000000"],
    ],
    rowCount: 1,
  });

  const service = new CatalogService(trino);
  const history = await service.getFileHistory("eh-hist-1");

  assert.equal(history.length, 1);
  assert.equal(history[0].snapshotId, "current");
  assert.equal(history[0].action, "current");
  assert.equal(history[0].path, "/projects/show1/current.exr");
});

test("getFileHistory returns empty array when handle not found", async () => {
  const trino = mockTrino({
    columns: [],
    data: [],
    rowCount: 0,
  });

  const service = new CatalogService(trino);
  const history = await service.getFileHistory("nonexistent");
  assert.deepEqual(history, []);
});

// ---------------------------------------------------------------------------
// SQL injection safety
// ---------------------------------------------------------------------------

test("single quotes in path prefix are escaped", async () => {
  const trino = mockTrino({ columns: [], data: [], rowCount: 0 });
  const service = new CatalogService(trino);

  await service.findUnregisteredAssets("/projects/it's a test");
  assert.ok(trino.lastQuery.includes("it''s a test"), "should escape single quotes");
});

test("single quotes in element handle are escaped", async () => {
  const trino = mockTrino({ columns: [], data: [], rowCount: 0 });
  const service = new CatalogService(trino);

  await service.resolveElementHandle("handle'injection");
  assert.ok(trino.lastQuery.includes("handle''injection"), "should escape single quotes in handle");
});

// ---------------------------------------------------------------------------
// Media type inference
// ---------------------------------------------------------------------------

test("findUnregisteredAssets infers correct media types", async () => {
  const trino = mockTrino({
    columns: [
      { name: "path", type: "varchar" },
      { name: "size_bytes", type: "bigint" },
      { name: "modified_at", type: "varchar" },
      { name: "handle", type: "varchar" },
    ],
    data: [
      ["/test/render.exr", 100, "2026-01-01", "h1"],
      ["/test/clip.mov", 200, "2026-01-01", "h2"],
      ["/test/model.usd", 300, "2026-01-01", "h3"],
      ["/test/unknown_file", 400, "2026-01-01", "h4"],
    ],
    rowCount: 4,
  });

  const service = new CatalogService(trino);
  const results = await service.findUnregisteredAssets("/test");

  assert.equal(results[0].inferredMediaType, "image");
  assert.equal(results[1].inferredMediaType, "video");
  assert.equal(results[2].inferredMediaType, "3d");
  assert.equal(results[3].inferredMediaType, "unknown");
});
