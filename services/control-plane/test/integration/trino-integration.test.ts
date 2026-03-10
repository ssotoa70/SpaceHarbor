/**
 * Integration tests for Trino client, installer, and VastPersistenceAdapter.
 *
 * Requires a running Trino instance with a memory-backed "vast" catalog.
 * Start it with: docker compose -f docker-compose.test.yml up -d --wait
 *
 * Skipped unless TRINO_INTEGRATION=true (default: skip in CI and local).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { TrinoClient } from "../../src/db/trino-client.js";
import { migrations } from "../../src/db/migrations/index.js";
import { install, parseArgs } from "../../src/db/installer.js";

const SKIP = process.env.TRINO_INTEGRATION !== "true";
const TRINO_ENDPOINT = process.env.TRINO_ENDPOINT ?? "http://localhost:8080";
const SCHEMA = "assetharbor/production";

describe("Trino integration tests", { skip: SKIP }, () => {
  let client: TrinoClient;

  before(async () => {
    client = new TrinoClient({
      endpoint: TRINO_ENDPOINT,
      accessKey: "test",
      secretKey: "test",
      catalog: "vast",
      schema: SCHEMA
    });

    const health = await client.healthCheck();
    assert.ok(health.reachable, "Trino should be reachable");

    // Ensure clean state — drop schema if leftover from a previous run
    try {
      await client.query(`DROP SCHEMA IF EXISTS vast."${SCHEMA}" CASCADE`);
    } catch {
      // schema may not exist yet
    }
  });

  after(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS vast."${SCHEMA}" CASCADE`);
    } catch {
      // best-effort cleanup
    }
  });

  // -------------------------------------------------------------------------
  // 1. Run all migration DDL against real Trino (memory catalog)
  // -------------------------------------------------------------------------

  it("should run migrations against real Trino", async () => {
    for (const mig of migrations) {
      for (const sql of mig.statements) {
        try {
          await client.query(sql);
        } catch (err) {
          // ALTER TABLE SET PROPERTIES is VAST-specific — expected to fail on memory
          if (sql.includes("ALTER TABLE") && sql.includes("SET PROPERTIES")) {
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Migration ${mig.version} failed:\n  SQL: ${sql.trim().slice(0, 120)}\n  Error: ${msg}`
          );
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 2. Verify all expected tables were created
  // -------------------------------------------------------------------------

  it("should have all expected tables after migrations", async () => {
    const result = await client.query(`SHOW TABLES FROM vast."${SCHEMA}"`);
    const tables = result.data.map((row) => row[0] as string);

    const expected = [
      "projects",
      "sequences",
      "shots",
      "versions",
      "version_assets",
      "version_approvals",
      "schema_version",
      "episodes",
      "tasks",
      "version_review_status",
      "version_frame_handles",
      "materials",
      "material_versions",
      "look_variants",
      "version_material_bindings",
      "material_dependencies"
    ];

    for (const table of expected) {
      assert.ok(tables.includes(table), `Table '${table}' should exist, got: [${tables.join(", ")}]`);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Installer dry-run against real endpoint
  // -------------------------------------------------------------------------

  it("should complete installer dry-run against real endpoint", async () => {
    const args = parseArgs([
      "--trino-endpoint",
      TRINO_ENDPOINT,
      "--access-key",
      "test",
      "--secret-key",
      "test",
      "--dry-run"
    ]);

    // dry-run skips schema version check → prints all 5 migrations
    const result = await install(args);
    assert.equal(result.applied, 5);
    assert.equal(result.currentVersion, 5);
  });

  // -------------------------------------------------------------------------
  // 4. Basic CRUD via TrinoClient
  // -------------------------------------------------------------------------

  it("should perform CRUD on projects via raw SQL", async () => {
    const S = `vast."${SCHEMA}"`;
    const id = "integ-proj-001";
    const ts = "2026-03-10 12:00:00.000";

    // INSERT
    await client.query(
      `INSERT INTO ${S}.projects (id, code, name, type, status, created_at, updated_at)
       VALUES ('${id}', 'TST', 'Test Project', 'vfx_only', 'active',
               TIMESTAMP '${ts}', TIMESTAMP '${ts}')`
    );

    // SELECT
    const read = await client.query(`SELECT id, code, name FROM ${S}.projects WHERE id = '${id}'`);
    assert.equal(read.rowCount, 1);
    assert.equal(read.data[0][0], id);
    assert.equal(read.data[0][1], "TST");
    assert.equal(read.data[0][2], "Test Project");

    // UPDATE
    await client.query(`UPDATE ${S}.projects SET status = 'archived' WHERE id = '${id}'`);
    const updated = await client.query(`SELECT status FROM ${S}.projects WHERE id = '${id}'`);
    assert.equal(updated.data[0][0], "archived");

    // DELETE
    await client.query(`DELETE FROM ${S}.projects WHERE id = '${id}'`);
    const deleted = await client.query(`SELECT id FROM ${S}.projects WHERE id = '${id}'`);
    assert.equal(deleted.rowCount, 0);
  });

  // -------------------------------------------------------------------------
  // 5. VastPersistenceAdapter CRUD via domain methods
  // -------------------------------------------------------------------------

  it("should create and read entities via VastPersistenceAdapter", async () => {
    const { VastPersistenceAdapter } = await import(
      "../../src/persistence/adapters/vast-persistence.js"
    );

    const adapter = new VastPersistenceAdapter({
      databaseUrl: `http://test:test@${TRINO_ENDPOINT.replace("http://", "")}`,
      eventBrokerUrl: undefined,
      dataEngineUrl: undefined,
      strict: false,
      fallbackToLocal: false
    });

    const now = "2026-03-10 12:00:00.000000";
    const ctx = { correlationId: "integ-test-1", now };

    // Create project
    const project = await adapter.createProject(
      { code: "INTG", name: "Integration", type: "vfx_only", status: "active" },
      ctx
    );
    assert.ok(project.id);
    assert.equal(project.code, "INTG");

    // Get by ID
    const fetched = await adapter.getProjectById(project.id);
    assert.ok(fetched);
    assert.equal(fetched.id, project.id);

    // List projects
    const all = await adapter.listProjects();
    assert.ok(all.some((p) => p.id === project.id));

    // Create sequence (tests referential integrity check)
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SQ010", status: "active" },
      ctx
    );
    assert.ok(seq.id);
    assert.equal(seq.projectId, project.id);

    // Create shot
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH0010",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1100,
        frameCount: 100
      },
      ctx
    );
    assert.ok(shot.id);

    // Create version (auto-increments version number)
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "integration-test"
      },
      ctx
    );
    assert.equal(version.versionNumber, 1);
    assert.equal(version.reviewStatus, "wip");

    // Read version with companion table JOINs
    const fetchedVersion = await adapter.getVersionById(version.id);
    assert.ok(fetchedVersion);
    assert.equal(fetchedVersion.reviewStatus, "wip");
  });
});
