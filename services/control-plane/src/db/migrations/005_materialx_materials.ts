/**
 * Migration 005: MaterialX Material Library
 *
 * Creates 5 tables for MaterialX integration:
 * - materials, material_versions, look_variants
 * - version_material_bindings (unsorted for DR replication)
 * - material_dependencies (texture deps with content-hash dedup)
 *
 * Run standalone: npx tsx src/db/migrations/005_materialx_materials.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 5,
  description: "MaterialX material library (5 tables)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.materials (
  id              VARCHAR(36)    NOT NULL,
  project_id      VARCHAR(36)    NOT NULL,
  name            VARCHAR(255)   NOT NULL,
  description     VARCHAR(2000),
  status          VARCHAR(32)    NOT NULL,
  created_by      VARCHAR(100)   NOT NULL,
  created_at      TIMESTAMP(6)   NOT NULL,
  updated_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.materials SET PROPERTIES sorted_by = ARRAY['project_id']`,

    `CREATE TABLE IF NOT EXISTS ${S}.material_versions (
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
)`,

    `ALTER TABLE ${S}.material_versions SET PROPERTIES sorted_by = ARRAY['material_id', 'version_number']`,

    `CREATE TABLE IF NOT EXISTS ${S}.look_variants (
  id                    VARCHAR(36)    NOT NULL,
  material_version_id   VARCHAR(36)    NOT NULL,
  look_name             VARCHAR(255)   NOT NULL,
  description           VARCHAR(2000),
  material_assigns      VARCHAR(8000),
  created_at            TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.look_variants SET PROPERTIES sorted_by = ARRAY['material_version_id']`,

    // Intentionally unsorted for DR replication
    `CREATE TABLE IF NOT EXISTS ${S}.version_material_bindings (
  id              VARCHAR(36)    NOT NULL,
  look_variant_id VARCHAR(36)    NOT NULL,
  version_id      VARCHAR(36)    NOT NULL,
  bound_by        VARCHAR(100)   NOT NULL,
  bound_at        TIMESTAMP(6)   NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.material_dependencies (
  id                    VARCHAR(36)    NOT NULL,
  material_version_id   VARCHAR(36)    NOT NULL,
  texture_path          VARCHAR(1024)  NOT NULL,
  content_hash          VARCHAR(64)    NOT NULL,
  texture_type          VARCHAR(32),
  colorspace            VARCHAR(64),
  dependency_depth      INTEGER        NOT NULL,
  created_at            TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.material_dependencies SET PROPERTIES sorted_by = ARRAY['material_version_id', 'texture_path']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (5, CURRENT_TIMESTAMP, 'MaterialX material library (5 tables)')`
  ]
};

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const endpoint = process.env.VAST_TRINO_ENDPOINT;
  if (!endpoint) {
    console.error("ERROR: VAST_TRINO_ENDPOINT is not set");
    process.exit(1);
  }

  const client = new TrinoClient({
    endpoint,
    accessKey: process.env.VAST_ACCESS_KEY ?? "",
    secretKey: process.env.VAST_SECRET_KEY ?? ""
  });

  console.log(`Running migration ${migration.version}: ${migration.description}`);
  for (const sql of migration.statements) {
    await client.query(sql);
    const label = sql.trim().split("\n")[0].slice(0, 60);
    console.log(`  done: ${label}`);
  }
  console.log("Migration 005 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 005 failed:", err);
    process.exit(1);
  });
}
