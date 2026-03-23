/**
 * Migration 001: VFX Hierarchy Schema
 *
 * Creates the Project -> Sequence -> Shot -> Version -> VersionApproval hierarchy
 * in VAST Database (spaceharbor/production schema).
 *
 * Run standalone: npx tsx src/db/migrations/001_vfx_hierarchy.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 1,
  description: "initial VFX hierarchy schema",
  statements: [
    // Ensure schema exists first
    `CREATE SCHEMA IF NOT EXISTS ${S}`,

    // Core VFX hierarchy tables
    `CREATE TABLE IF NOT EXISTS ${S}.projects (
  id              VARCHAR(36)   NOT NULL,
  code            VARCHAR(64)   NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  type            VARCHAR(32)   NOT NULL,
  status          VARCHAR(32)   NOT NULL,
  frame_rate      DOUBLE,
  color_space     VARCHAR(64),
  resolution_w    INTEGER,
  resolution_h    INTEGER,
  start_date      TIMESTAMP(6),
  delivery_date   TIMESTAMP(6),
  owner           VARCHAR(100),
  created_at      TIMESTAMP(6)  NOT NULL,
  updated_at      TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.sequences (
  id                VARCHAR(36)   NOT NULL,
  project_id        VARCHAR(36)   NOT NULL,
  code              VARCHAR(64)   NOT NULL,
  episode           VARCHAR(64),
  name              VARCHAR(255),
  status            VARCHAR(32)   NOT NULL,
  shot_count        INTEGER       NOT NULL,
  frame_range_start INTEGER,
  frame_range_end   INTEGER,
  created_at        TIMESTAMP(6)  NOT NULL,
  updated_at        TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.shots (
  id                VARCHAR(36)   NOT NULL,
  project_id        VARCHAR(36)   NOT NULL,
  sequence_id       VARCHAR(36)   NOT NULL,
  code              VARCHAR(64)   NOT NULL,
  name              VARCHAR(255),
  status            VARCHAR(32)   NOT NULL,
  frame_range_start INTEGER       NOT NULL,
  frame_range_end   INTEGER       NOT NULL,
  frame_count       INTEGER       NOT NULL,
  frame_rate        DOUBLE,
  vendor            VARCHAR(100),
  lead              VARCHAR(100),
  priority          VARCHAR(16),
  due_date          TIMESTAMP(6),
  notes             VARCHAR(2000),
  latest_version_id VARCHAR(36),
  created_at        TIMESTAMP(6)  NOT NULL,
  updated_at        TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.versions (
  id                  VARCHAR(36)   NOT NULL,
  shot_id             VARCHAR(36)   NOT NULL,
  project_id          VARCHAR(36)   NOT NULL,
  sequence_id         VARCHAR(36)   NOT NULL,
  version_label       VARCHAR(32)   NOT NULL,
  version_number      INTEGER       NOT NULL,
  parent_version_id   VARCHAR(36),
  status              VARCHAR(32)   NOT NULL,
  media_type          VARCHAR(32)   NOT NULL,
  codec               VARCHAR(64),
  resolution_w        INTEGER,
  resolution_h        INTEGER,
  frame_rate          DOUBLE,
  frame_range_start   INTEGER,
  frame_range_end     INTEGER,
  pixel_aspect_ratio  DOUBLE,
  display_window      ROW(x INTEGER, y INTEGER, w INTEGER, h INTEGER),
  data_window         ROW(x INTEGER, y INTEGER, w INTEGER, h INTEGER),
  compression_type    VARCHAR(64),
  color_space         VARCHAR(64),
  bit_depth           INTEGER,
  channel_count       INTEGER,
  file_size_bytes     BIGINT,
  md5_checksum        VARCHAR(32),
  vast_element_handle VARCHAR(255),
  vast_path           VARCHAR(1024),
  created_by          VARCHAR(100)  NOT NULL,
  created_at          TIMESTAMP(6)  NOT NULL,
  published_at        TIMESTAMP(6),
  notes               VARCHAR(2000)
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.version_assets (
  id         VARCHAR(36)   NOT NULL,
  version_id VARCHAR(36)   NOT NULL,
  asset_id   VARCHAR(36)   NOT NULL,
  role       VARCHAR(32)   NOT NULL,
  created_at TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.version_approvals (
  id           VARCHAR(36)   NOT NULL,
  version_id   VARCHAR(36)   NOT NULL,
  shot_id      VARCHAR(36)   NOT NULL,
  project_id   VARCHAR(36)   NOT NULL,
  action       VARCHAR(32)   NOT NULL,
  performed_by VARCHAR(100)  NOT NULL,
  role         VARCHAR(64),
  note         VARCHAR(2000),
  at           TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.schema_version (
  version     INTEGER       NOT NULL,
  applied_at  TIMESTAMP(6)  NOT NULL,
  description VARCHAR(255)  NOT NULL
)`,

    // Sort keys (non-fatal if they fail)
    `ALTER TABLE ${S}.shots SET PROPERTIES sorted_by = ARRAY['project_id', 'sequence_id']`,
    `ALTER TABLE ${S}.versions SET PROPERTIES sorted_by = ARRAY['shot_id', 'version_number']`,

    // Version record
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (1, CURRENT_TIMESTAMP, 'initial VFX hierarchy schema')`
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

  console.log(`=== Migration ${migration.version}: ${migration.description} ===`);
  for (const sql of migration.statements) {
    const label = sql.trim().slice(0, 60).replace(/\n/g, " ");
    process.stdout.write(`  ${label}... `);
    try {
      await client.query(sql);
      console.log("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`(${msg.split("\n")[0]})`);
    }
  }
  console.log("Migration 001 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
