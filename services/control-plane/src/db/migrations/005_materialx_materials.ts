/**
 * Migration 005: MaterialX Material Library
 *
 * Creates 5 tables for MaterialX integration:
 * - materials: project-scoped material library entities
 * - material_versions: standalone versioning (separate from versions table)
 * - look_variants: extracted <look> elements from .mtlx XML
 * - version_material_bindings: "Where Used?" edge table (UNSORTED for DR replication)
 * - material_dependencies: texture dependencies with content-hash dedup
 *
 * Design doc: docs/plans/2026-03-05-materialx-integration-design.md
 *
 * Run with: npx tsx src/db/migrations/005_materialx_materials.ts
 */

const TRINO_URL = process.env.VAST_TRINO_ENDPOINT ?? "http://localhost:8080";
const CATALOG = 'vast."assetharbor/production"';

async function query(sql: string): Promise<void> {
  const res = await fetch(`${TRINO_URL}/v1/statement`, {
    method: "POST",
    headers: { "X-Trino-User": "migration", "Content-Type": "text/plain" },
    body: sql
  });
  if (!res.ok) {
    throw new Error(`Trino query failed (${res.status}): ${await res.text()}`);
  }
}

async function run(): Promise<void> {
  console.log("Running migration 005: MaterialX material library");

  // Table 1: materials
  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.materials (
      id              VARCHAR(36)    NOT NULL,
      project_id      VARCHAR(36)    NOT NULL,
      name            VARCHAR(255)   NOT NULL,
      description     VARCHAR(2000),
      status          VARCHAR(32)    NOT NULL,
      created_by      VARCHAR(100)   NOT NULL,
      created_at      TIMESTAMP(6)   NOT NULL,
      updated_at      TIMESTAMP(6)   NOT NULL
    )
  `);
  console.log("  ✓ materials");

  await query(`
    ALTER TABLE ${CATALOG}.materials
      SET PROPERTIES sorted_by = ARRAY['project_id']
  `);
  console.log("  ✓ materials sort key [project_id]");

  // Table 2: material_versions
  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.material_versions (
      id                    VARCHAR(36)    NOT NULL,
      material_id           VARCHAR(36)    NOT NULL,
      version_number        INTEGER        NOT NULL,
      version_label         VARCHAR(32)    NOT NULL,
      parent_version_id     VARCHAR(36),
      status                VARCHAR(32)    NOT NULL,
      source_path           VARCHAR(1024)  NOT NULL,
      content_hash          VARCHAR(64)    NOT NULL,
      usd_material_path     VARCHAR(1024),
      render_contexts       ARRAY(VARCHAR),
      colorspace_config     VARCHAR(64),
      mtlx_spec_version     VARCHAR(16),
      look_names            ARRAY(VARCHAR),
      vast_element_handle   VARCHAR(255),
      vast_path             VARCHAR(1024),
      created_by            VARCHAR(100)   NOT NULL,
      created_at            TIMESTAMP(6)   NOT NULL,
      published_at          TIMESTAMP(6)
    )
  `);
  console.log("  ✓ material_versions");

  await query(`
    ALTER TABLE ${CATALOG}.material_versions
      SET PROPERTIES sorted_by = ARRAY['material_id', 'version_number']
  `);
  console.log("  ✓ material_versions sort key [material_id, version_number]");

  // Table 3: look_variants
  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.look_variants (
      id                    VARCHAR(36)    NOT NULL,
      material_version_id   VARCHAR(36)    NOT NULL,
      look_name             VARCHAR(255)   NOT NULL,
      description           VARCHAR(2000),
      material_assigns      VARCHAR(8000),
      created_at            TIMESTAMP(6)   NOT NULL
    )
  `);
  console.log("  ✓ look_variants");

  await query(`
    ALTER TABLE ${CATALOG}.look_variants
      SET PROPERTIES sorted_by = ARRAY['material_version_id']
  `);
  console.log("  ✓ look_variants sort key [material_version_id]");

  // Table 4: version_material_bindings (INTENTIONALLY UNSORTED for DR replication)
  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.version_material_bindings (
      id              VARCHAR(36)    NOT NULL,
      look_variant_id VARCHAR(36)    NOT NULL,
      version_id      VARCHAR(36)    NOT NULL,
      bound_by        VARCHAR(100)   NOT NULL,
      bound_at        TIMESTAMP(6)   NOT NULL
    )
  `);
  console.log("  ✓ version_material_bindings (unsorted — DR replication)");

  // Table 5: material_dependencies
  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.material_dependencies (
      id                    VARCHAR(36)    NOT NULL,
      material_version_id   VARCHAR(36)    NOT NULL,
      texture_path          VARCHAR(1024)  NOT NULL,
      content_hash          VARCHAR(64)    NOT NULL,
      texture_type          VARCHAR(32),
      colorspace            VARCHAR(64),
      dependency_depth      INTEGER        NOT NULL,
      created_at            TIMESTAMP(6)   NOT NULL
    )
  `);
  console.log("  ✓ material_dependencies");

  await query(`
    ALTER TABLE ${CATALOG}.material_dependencies
      SET PROPERTIES sorted_by = ARRAY['material_version_id', 'texture_path']
  `);
  console.log("  ✓ material_dependencies sort key [material_version_id, texture_path]");

  // Schema version
  await query(`
    INSERT INTO ${CATALOG}.schema_version (version, applied_at, description)
    VALUES (5, CURRENT_TIMESTAMP, 'MaterialX material library (5 tables)')
  `);
  console.log("  ✓ schema_version updated to 5");

  console.log("Migration 005 complete.");
}

run().catch((err: unknown) => {
  console.error("Migration 005 failed:", err);
  process.exit(1);
});
