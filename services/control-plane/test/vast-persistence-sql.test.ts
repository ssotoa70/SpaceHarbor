import test from "node:test";
import assert from "node:assert/strict";
import { TrinoClient } from "../src/db/trino-client.js";
import * as tq from "../src/persistence/adapters/vast-trino-queries.js";
import type { TrinoQueryResult } from "../src/db/trino-client.js";
import { VastPersistenceAdapter } from "../src/persistence/adapters/vast-persistence.js";

// ---------------------------------------------------------------------------
// Mock TrinoClient that records queries and returns canned results
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function withMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    return handler(urlStr, init);
  }) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

/** Build a fake TrinoQueryResult from column definitions and data rows */
function fakeResult(
  columns: Array<{ name: string; type: string }>,
  data: unknown[][]
): TrinoQueryResult {
  return { columns, data, rowCount: data.length };
}

const PROJECT_COLUMNS = [
  { name: "id", type: "varchar" },
  { name: "code", type: "varchar" },
  { name: "name", type: "varchar" },
  { name: "type", type: "varchar" },
  { name: "status", type: "varchar" },
  { name: "frame_rate", type: "double" },
  { name: "color_space", type: "varchar" },
  { name: "resolution_w", type: "integer" },
  { name: "resolution_h", type: "integer" },
  { name: "start_date", type: "timestamp" },
  { name: "delivery_date", type: "timestamp" },
  { name: "owner", type: "varchar" },
  { name: "created_at", type: "timestamp" },
  { name: "updated_at", type: "timestamp" }
];

const VERSION_COLUMNS = [
  { name: "id", type: "varchar" },
  { name: "shot_id", type: "varchar" },
  { name: "project_id", type: "varchar" },
  { name: "sequence_id", type: "varchar" },
  { name: "version_label", type: "varchar" },
  { name: "version_number", type: "integer" },
  { name: "parent_version_id", type: "varchar" },
  { name: "status", type: "varchar" },
  { name: "media_type", type: "varchar" },
  { name: "codec", type: "varchar" },
  { name: "resolution_w", type: "integer" },
  { name: "resolution_h", type: "integer" },
  { name: "frame_rate", type: "double" },
  { name: "frame_range_start", type: "integer" },
  { name: "frame_range_end", type: "integer" },
  { name: "pixel_aspect_ratio", type: "double" },
  { name: "display_window", type: "row" },
  { name: "data_window", type: "row" },
  { name: "compression_type", type: "varchar" },
  { name: "color_space", type: "varchar" },
  { name: "bit_depth", type: "integer" },
  { name: "channel_count", type: "integer" },
  { name: "file_size_bytes", type: "bigint" },
  { name: "md5_checksum", type: "varchar" },
  { name: "vast_element_handle", type: "varchar" },
  { name: "vast_path", type: "varchar" },
  { name: "created_by", type: "varchar" },
  { name: "created_at", type: "timestamp" },
  { name: "published_at", type: "timestamp" },
  { name: "notes", type: "varchar" },
  // Companion table columns from LEFT JOINs
  { name: "review_status", type: "varchar" },
  { name: "head_handle", type: "integer" },
  { name: "tail_handle", type: "integer" }
];

// ---------------------------------------------------------------------------
// Row mapper tests
// ---------------------------------------------------------------------------

test("mapRowToProject: maps all fields correctly", () => {
  const row = [
    "p1", "PROJ", "My Project", "feature", "active",
    24.0, "ACEScg", 1920, 1080,
    "2026-01-01T00:00:00", "2026-12-31T00:00:00",
    "jdoe", "2026-01-01T00:00:00", "2026-01-02T00:00:00"
  ];
  const r = fakeResult(PROJECT_COLUMNS, [row]);
  const project = tq.mapRowToProject(row, r);

  assert.equal(project.id, "p1");
  assert.equal(project.code, "PROJ");
  assert.equal(project.type, "feature");
  assert.equal(project.frameRate, 24.0);
  assert.equal(project.owner, "jdoe");
});

test("mapRowToProject: handles null optional fields", () => {
  const row = [
    "p2", "PROJ2", "Project 2", "episodic", "archived",
    null, null, null, null, null, null, null,
    "2026-01-01T00:00:00", "2026-01-01T00:00:00"
  ];
  const r = fakeResult(PROJECT_COLUMNS, [row]);
  const project = tq.mapRowToProject(row, r);

  assert.equal(project.frameRate, null);
  assert.equal(project.colorSpace, null);
  assert.equal(project.owner, null);
});

test("mapRowToVersion: includes companion table fields", () => {
  const row = [
    "v1", "s1", "p1", "sq1", "v001", 1, null,
    "draft", "exr_sequence", "ZIP", 4096, 2160,
    24.0, 1001, 1100, 1.0,
    { x: 0, y: 0, w: 4096, h: 2160 },
    { x: 0, y: 0, w: 4096, h: 2160 },
    "ZIP", "ACEScg", 16, 4, 1234567, "abc123",
    "handle1", "/vfx/v1", "artist1",
    "2026-01-01T00:00:00", null, "test notes",
    "internal_review", 8, 8
  ];
  const r = fakeResult(VERSION_COLUMNS, [row]);
  const version = tq.mapRowToVersion(row, r);

  assert.equal(version.id, "v1");
  assert.equal(version.reviewStatus, "internal_review");
  assert.equal(version.headHandle, 8);
  assert.equal(version.tailHandle, 8);
  assert.deepEqual(version.displayWindow, { x: 0, y: 0, w: 4096, h: 2160 });
});

test("mapRowToVersion: defaults reviewStatus to wip when null", () => {
  const row = [
    "v2", "s1", "p1", "sq1", "v002", 2, "v1",
    "draft", "exr_sequence", null, null, null,
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    null, null, "artist1",
    "2026-01-01T00:00:00", null, null,
    null, null, null
  ];
  const r = fakeResult(VERSION_COLUMNS, [row]);
  const version = tq.mapRowToVersion(row, r);

  assert.equal(version.reviewStatus, "wip");
  assert.equal(version.headHandle, null);
  assert.equal(version.tailHandle, null);
});

// ---------------------------------------------------------------------------
// SQL escaping
// ---------------------------------------------------------------------------

test("esc: escapes single quotes", () => {
  assert.equal(tq.esc("it's"), "'it''s'");
  assert.equal(tq.esc(null), "NULL");
  assert.equal(tq.esc("hello"), "'hello'");
});

test("escNum: handles numbers and null", () => {
  assert.equal(tq.escNum(42), "42");
  assert.equal(tq.escNum(null), "NULL");
});

// ---------------------------------------------------------------------------
// Query function tests (verify correct SQL and mapping)
// ---------------------------------------------------------------------------

test("queryProjectById: returns project when found", () =>
  withMockFetch(
    async (_url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      // Verify the SQL contains the correct WHERE clause
      if (body.includes("WHERE id = 'p1'")) {
        return jsonResponse({
          columns: PROJECT_COLUMNS,
          data: [[
            "p1", "PROJ", "My Project", "feature", "active",
            24.0, "ACEScg", 1920, 1080, null, null, "jdoe",
            "2026-01-01", "2026-01-02"
          ]],
          stats: { state: "FINISHED" }
        });
      }
      return jsonResponse({ columns: [], data: [], stats: { state: "FINISHED" } });
    },
    async () => {
      const client = new TrinoClient({ endpoint: "http://trino:8080", accessKey: "a", secretKey: "b" });
      const project = await tq.queryProjectById(client, "p1");
      assert.ok(project);
      assert.equal(project.id, "p1");
      assert.equal(project.code, "PROJ");
    }
  ));

test("queryProjectById: returns null when not found", () =>
  withMockFetch(
    async () => jsonResponse({ columns: PROJECT_COLUMNS, data: [], stats: { state: "FINISHED" } }),
    async () => {
      const client = new TrinoClient({ endpoint: "http://trino:8080", accessKey: "a", secretKey: "b" });
      const project = await tq.queryProjectById(client, "nonexistent");
      assert.equal(project, null);
    }
  ));

test("queryProjects: adds WHERE clause for status filter", () => {
  let capturedSql = "";

  return withMockFetch(
    async (_url, init) => {
      capturedSql = typeof init?.body === "string" ? init.body : "";
      return jsonResponse({ columns: PROJECT_COLUMNS, data: [], stats: { state: "FINISHED" } });
    },
    async () => {
      const client = new TrinoClient({ endpoint: "http://trino:8080", accessKey: "a", secretKey: "b" });
      await tq.queryProjects(client, "active");
      assert.ok(capturedSql.includes("WHERE status = 'active'"));
    }
  );
});

test("queryVersionById: generates LEFT JOIN SQL with companion tables", () => {
  let capturedSql = "";

  return withMockFetch(
    async (_url, init) => {
      capturedSql = typeof init?.body === "string" ? init.body : "";
      return jsonResponse({
        columns: VERSION_COLUMNS,
        data: [[
          "v1", "s1", "p1", "sq1", "v001", 1, null,
          "draft", "exr_sequence", null, null, null,
          null, null, null, null, null, null,
          null, null, null, null, null, null,
          null, null, "artist1",
          "2026-01-01", null, null,
          "wip", null, null
        ]],
        stats: { state: "FINISHED" }
      });
    },
    async () => {
      const client = new TrinoClient({ endpoint: "http://trino:8080", accessKey: "a", secretKey: "b" });
      const version = await tq.queryVersionById(client, "v1");
      assert.ok(version);
      assert.equal(version.id, "v1");
      // Verify the SQL uses LEFT JOINs
      assert.ok(capturedSql.includes("LEFT JOIN"), "Should use LEFT JOIN");
      assert.ok(capturedSql.includes("version_review_status"), "Should join review_status");
      assert.ok(capturedSql.includes("version_frame_handles"), "Should join frame_handles");
    }
  );
});

test("queryVersionsByShot: orders by version_number DESC", () => {
  let capturedSql = "";

  return withMockFetch(
    async (_url, init) => {
      capturedSql = typeof init?.body === "string" ? init.body : "";
      return jsonResponse({ columns: VERSION_COLUMNS, data: [], stats: { state: "FINISHED" } });
    },
    async () => {
      const client = new TrinoClient({ endpoint: "http://trino:8080", accessKey: "a", secretKey: "b" });
      await tq.queryVersionsByShot(client, "s1");
      assert.ok(capturedSql.includes("ORDER BY v.version_number DESC"));
      assert.ok(capturedSql.includes("v.shot_id = 's1'"));
    }
  );
});

// ---------------------------------------------------------------------------
// VastPersistenceAdapter fallback tests
// ---------------------------------------------------------------------------

test("VastPersistenceAdapter: falls back to localAdapter when no databaseUrl", async () => {
  const adapter = new VastPersistenceAdapter({
    databaseUrl: undefined,
    eventBrokerUrl: undefined,
    dataEngineUrl: undefined,
    strict: false,
    fallbackToLocal: true
  });

  // These should use localFallback (no trinoClient), and return null since no data
  const project = await adapter.getProjectById("p1");
  assert.equal(project, null);

  const shots = await adapter.listShotsBySequence("sq1");
  assert.deepEqual(shots, []);
});

test("VastPersistenceAdapter: uses trinoClient when databaseUrl is set", () =>
  withMockFetch(
    async (_url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("SELECT") && body.includes("projects")) {
        return jsonResponse({
          columns: PROJECT_COLUMNS,
          data: [[
            "p1", "PROJ", "Test", "feature", "active",
            24.0, null, null, null, null, null, null,
            "2026-01-01", "2026-01-01"
          ]],
          stats: { state: "FINISHED" }
        });
      }
      // health/info checks
      if (_url.includes("/v1/info")) {
        return jsonResponse({ nodeVersion: { version: "442" } });
      }
      return jsonResponse({ columns: [], data: [], stats: { state: "FINISHED" } });
    },
    async () => {
      const adapter = new VastPersistenceAdapter({
        databaseUrl: "http://testkey:testsecret@trino:8080",
        eventBrokerUrl: undefined,
        dataEngineUrl: undefined,
        strict: false,
        fallbackToLocal: true
      });

      const project = await adapter.getProjectById("p1");
      assert.ok(project);
      assert.equal(project.id, "p1");
      assert.equal(project.code, "PROJ");
    }
  ));
