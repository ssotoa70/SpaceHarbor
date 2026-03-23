/**
 * Migration 009: Review Workflow
 *
 * Creates tables for timecoded review comments and spatial annotations.
 * Part of Phase B — Review Workflow Parity (Frame.io Level).
 *
 * VAST Database cannot ALTER TABLE ADD COLUMN — companion tables used where needed.
 *
 * Run standalone: npx tsx src/db/migrations/009_review_workflow.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 9,
  description: "review comments and comment annotations for timecoded review workflow",
  statements: [
    // -----------------------------------------------------------------------
    // Review comments (timecoded, threaded, per-session/submission/version)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.review_comments (
  id                VARCHAR(36)    NOT NULL,
  session_id        VARCHAR(36),
  submission_id     VARCHAR(36),
  version_id        VARCHAR(36),
  parent_comment_id VARCHAR(36),
  author_id         VARCHAR(255)   NOT NULL,
  author_role       VARCHAR(100),
  body              VARCHAR(4000)  NOT NULL,
  frame_number      INTEGER,
  timecode          VARCHAR(32),
  annotation_type   VARCHAR(50),
  status            VARCHAR(20)    NOT NULL,
  created_at        TIMESTAMP(6)   NOT NULL,
  updated_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.review_comments SET PROPERTIES sorted_by = ARRAY['session_id', 'created_at']`,

    // -----------------------------------------------------------------------
    // Comment annotations (spatial/drawing data per frame)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.comment_annotations (
  id                VARCHAR(36)    NOT NULL,
  comment_id        VARCHAR(36)    NOT NULL,
  annotation_data   VARCHAR(8000)  NOT NULL,
  frame_number      INTEGER        NOT NULL
)`,

    `ALTER TABLE ${S}.comment_annotations SET PROPERTIES sorted_by = ARRAY['comment_id']`,

    // -----------------------------------------------------------------------
    // Version comparisons (A/B comparison metadata for review workflow)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.version_comparisons (
  id                    VARCHAR(36)    NOT NULL,
  version_a_id          VARCHAR(36)    NOT NULL,
  version_b_id          VARCHAR(36)    NOT NULL,
  comparison_type       VARCHAR(20)    NOT NULL,
  diff_metadata         VARCHAR(8000),
  pixel_diff_percentage DOUBLE,
  frame_diff_count      INTEGER,
  resolution_match      BOOLEAN        NOT NULL,
  colorspace_match      BOOLEAN        NOT NULL,
  created_at            TIMESTAMP(6)   NOT NULL,
  created_by            VARCHAR(255)   NOT NULL
)`,

    `ALTER TABLE ${S}.version_comparisons SET PROPERTIES sorted_by = ARRAY['version_a_id', 'version_b_id']`,

    // -----------------------------------------------------------------------
    // Collections (playlists, selections, deliverables)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.collections (
  id                VARCHAR(36)    NOT NULL,
  project_id        VARCHAR(36)    NOT NULL,
  name              VARCHAR(255)   NOT NULL,
  description       VARCHAR(2000),
  collection_type   VARCHAR(20)    NOT NULL,
  owner_id          VARCHAR(255)   NOT NULL,
  status            VARCHAR(20)    NOT NULL,
  created_at        TIMESTAMP(6)   NOT NULL,
  updated_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.collections SET PROPERTIES sorted_by = ARRAY['project_id', 'collection_type']`,

    // -----------------------------------------------------------------------
    // Collection items (membership of entities in collections)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.collection_items (
  id                VARCHAR(36)    NOT NULL,
  collection_id     VARCHAR(36)    NOT NULL,
  entity_type       VARCHAR(20)    NOT NULL,
  entity_id         VARCHAR(36)    NOT NULL,
  sort_order        INTEGER        NOT NULL,
  added_by          VARCHAR(255)   NOT NULL,
  added_at          TIMESTAMP(6)   NOT NULL,
  notes             VARCHAR(2000)
)`,

    `ALTER TABLE ${S}.collection_items SET PROPERTIES sorted_by = ARRAY['collection_id', 'sort_order']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (9, CURRENT_TIMESTAMP, 'review comments, comment annotations, version comparisons, collections, and collection items')`
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
  console.log("Migration 009 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 009 failed:", err);
    process.exit(1);
  });
}
