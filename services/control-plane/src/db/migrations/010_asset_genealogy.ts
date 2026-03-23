/**
 * Migration 010: Asset Genealogy & Capacity Planning
 *
 * Creates tables for asset provenance tracking, version lineage,
 * dependency intelligence, and capacity planning signals.
 * Part of Phase C — Asset Genealogy & Pipeline Intelligence.
 *
 * Tables:
 *   - asset_provenance: creation context (DCC, render job, pipeline stage)
 *   - version_lineage: ancestor/descendant relationships with depth
 *   - asset_dependencies: cross-entity dependency graph (C.4)
 *   - shot_asset_usage: version usage within shots (C.4)
 *   - storage_metrics: per-entity storage accounting (C.7)
 *   - render_farm_metrics: render job cost/time tracking (C.7)
 *   - downstream_usage_counts: pre-computed dependency fan-out (C.7)
 *
 * VAST Database constraints:
 *   - No recursive CTEs — lineage queries use bounded-depth self-joins (max 10)
 *   - Sort keys are permanent — chosen for query access patterns
 *   - TIMESTAMP(6) throughout — VAST native precision
 *
 * Run standalone: npx tsx src/db/migrations/010_asset_genealogy.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 10,
  description: "asset provenance, version lineage, dependency intelligence, capacity planning for pipeline",
  statements: [
    // -----------------------------------------------------------------------
    // Asset provenance — creation context per version
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.asset_provenance (
  id                  VARCHAR(36)    NOT NULL,
  version_id          VARCHAR(36)    NOT NULL,
  creator             VARCHAR(255),
  software_used       VARCHAR(255),
  software_version    VARCHAR(100),
  render_job_id       VARCHAR(255),
  pipeline_stage      VARCHAR(100),
  vast_storage_path   VARCHAR(1024),
  vast_element_handle VARCHAR(255),
  source_host         VARCHAR(255),
  source_process_id   VARCHAR(100),
  created_at          TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.asset_provenance SET PROPERTIES sorted_by = ARRAY['version_id', 'created_at']`,

    // -----------------------------------------------------------------------
    // Version lineage — DAG edges with relationship type and pre-computed depth
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.version_lineage (
  id                      VARCHAR(36)    NOT NULL,
  ancestor_version_id     VARCHAR(36)    NOT NULL,
  descendant_version_id   VARCHAR(36)    NOT NULL,
  relationship_type       VARCHAR(50)    NOT NULL,
  depth                   INTEGER        NOT NULL,
  created_at              TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.version_lineage SET PROPERTIES sorted_by = ARRAY['ancestor_version_id', 'depth']`,

    // -----------------------------------------------------------------------
    // Asset dependencies — cross-entity dependency graph (Phase C.4)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.asset_dependencies (
  id                  VARCHAR(36)    NOT NULL,
  source_entity_type  VARCHAR(50)    NOT NULL,
  source_entity_id    VARCHAR(36)    NOT NULL,
  target_entity_type  VARCHAR(50)    NOT NULL,
  target_entity_id    VARCHAR(36)    NOT NULL,
  dependency_type     VARCHAR(50)    NOT NULL,
  dependency_strength VARCHAR(20)    NOT NULL,
  discovered_by       VARCHAR(100),
  discovered_at       TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.asset_dependencies SET PROPERTIES sorted_by = ARRAY['source_entity_type', 'source_entity_id']`,

    // -----------------------------------------------------------------------
    // Shot-asset usage — which versions are used in which shots and how
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.shot_asset_usage (
  id                  VARCHAR(36)    NOT NULL,
  shot_id             VARCHAR(36)    NOT NULL,
  version_id          VARCHAR(36)    NOT NULL,
  usage_type          VARCHAR(50)    NOT NULL,
  layer_name          VARCHAR(255),
  is_active           BOOLEAN        NOT NULL,
  added_at            TIMESTAMP(6)   NOT NULL,
  removed_at          TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.shot_asset_usage SET PROPERTIES sorted_by = ARRAY['shot_id', 'usage_type']`,

    // -----------------------------------------------------------------------
    // Storage metrics — per-entity storage accounting (Phase C.7)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.storage_metrics (
  id                  VARCHAR(36)    NOT NULL,
  entity_type         VARCHAR(50)    NOT NULL,
  entity_id           VARCHAR(36)    NOT NULL,
  total_bytes         BIGINT         NOT NULL,
  file_count          INTEGER        NOT NULL,
  proxy_bytes         BIGINT         NOT NULL,
  thumbnail_bytes     BIGINT         NOT NULL,
  storage_tier        VARCHAR(50)    NOT NULL,
  measured_at         TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.storage_metrics SET PROPERTIES sorted_by = ARRAY['entity_type', 'entity_id']`,

    // -----------------------------------------------------------------------
    // Render farm metrics — job cost and time tracking (Phase C.7)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.render_farm_metrics (
  id                  VARCHAR(36)    NOT NULL,
  project_id          VARCHAR(36)    NOT NULL,
  shot_id             VARCHAR(36),
  version_id          VARCHAR(36),
  render_engine       VARCHAR(100),
  render_time_seconds DOUBLE,
  core_hours          DOUBLE,
  peak_memory_gb      DOUBLE,
  frame_count         INTEGER,
  submitted_at        TIMESTAMP(6),
  completed_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.render_farm_metrics SET PROPERTIES sorted_by = ARRAY['project_id', 'completed_at']`,

    // -----------------------------------------------------------------------
    // Downstream usage counts — pre-computed dependency fan-out (Phase C.7)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.downstream_usage_counts (
  entity_type         VARCHAR(50)    NOT NULL,
  entity_id           VARCHAR(36)    NOT NULL,
  direct_dependents   INTEGER        NOT NULL,
  transitive_dependents INTEGER      NOT NULL,
  shot_count          INTEGER        NOT NULL,
  last_computed_at    TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.downstream_usage_counts SET PROPERTIES sorted_by = ARRAY['entity_type', 'entity_id']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (10, CURRENT_TIMESTAMP, 'asset provenance, version lineage, dependency intelligence, capacity planning for pipeline')`
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
    const label = sql.trim().split("\n")[0].slice(0, 60);
    process.stdout.write(`  ${label}... `);
    try {
      await client.query(sql);
      console.log("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`(${msg.split("\n")[0]})`);
    }
  }
  console.log("Migration 010 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 010 failed:", err);
    process.exit(1);
  });
}
