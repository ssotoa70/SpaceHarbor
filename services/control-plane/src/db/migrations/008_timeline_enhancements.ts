/**
 * Migration 008: Timeline Enhancements
 *
 * Adds companion tables for expanded timeline clip fields, approval audit links,
 * and version media URLs. Also creates the timeline_change_sets table.
 *
 * VAST Database cannot ALTER TABLE ADD COLUMN — we use companion tables with
 * LEFT JOINs (same pattern as version_review_status, version_frame_handles).
 *
 * Run standalone: npx tsx src/db/migrations/008_timeline_enhancements.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 8,
  description: "timeline clip details, change sets, approval audit links, version media URLs",
  statements: [
    // -----------------------------------------------------------------------
    // Timeline clip details (companion to timeline_clips)
    // Fields: vfx_cut_in, vfx_cut_out, handle_head, handle_tail,
    //         delivery_in, delivery_out, source_timecode
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.timeline_clip_details (
  clip_id           VARCHAR(36)    NOT NULL,
  vfx_cut_in        INTEGER,
  vfx_cut_out       INTEGER,
  handle_head       INTEGER,
  handle_tail       INTEGER,
  delivery_in       INTEGER,
  delivery_out      INTEGER,
  source_timecode   VARCHAR(32)
)`,

    `ALTER TABLE ${S}.timeline_clip_details SET PROPERTIES sorted_by = ARRAY['clip_id']`,

    // -----------------------------------------------------------------------
    // Timeline change sets (OTIO diff tracking)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.timeline_change_sets (
  id                    VARCHAR(36)    NOT NULL,
  timeline_id           VARCHAR(36)    NOT NULL,
  previous_timeline_id  VARCHAR(36)    NOT NULL,
  changes               VARCHAR(8000)  NOT NULL,
  created_at            TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.timeline_change_sets SET PROPERTIES sorted_by = ARRAY['timeline_id']`,

    // -----------------------------------------------------------------------
    // Approval audit links (companion to approval_audit)
    // Fields: version_id, session_id
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.approval_audit_links (
  audit_id    VARCHAR(36)    NOT NULL,
  version_id  VARCHAR(36),
  session_id  VARCHAR(36)
)`,

    `ALTER TABLE ${S}.approval_audit_links SET PROPERTIES sorted_by = ARRAY['audit_id']`,

    // -----------------------------------------------------------------------
    // Version media URLs (companion to versions)
    // Fields: thumbnail_url, proxy_url
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.version_media_urls (
  version_id      VARCHAR(36)    NOT NULL,
  thumbnail_url   VARCHAR(2048),
  proxy_url       VARCHAR(2048),
  updated_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.version_media_urls SET PROPERTIES sorted_by = ARRAY['version_id']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (8, CURRENT_TIMESTAMP, 'timeline clip details, change sets, approval audit links, version media URLs')`
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
  console.log("Migration 008 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 008 failed:", err);
    process.exit(1);
  });
}
