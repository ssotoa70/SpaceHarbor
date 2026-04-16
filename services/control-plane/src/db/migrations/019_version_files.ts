/**
 * Migration 019: Version Files — multi-file version manifests.
 *
 * Background:
 *   Real VFX versions are rarely a single file. An EXR shot version is a
 *   1000-frame image sequence + a sidecar .json + maybe an audio WAV. A ProRes
 *   version might carry a .mov + a timecode .txt + a proxy .h264. TACTIC's
 *   Snapshot model embeds a `<snapshot>` XML referencing child `<file>` nodes
 *   for exactly this reason.
 *
 *   We adopt the same capability via a `version_files` child table keyed on
 *   `version_id`. Each row names a physical file, its role in the version
 *   (primary, sidecar, proxy, etc.), optional frame range for sequences,
 *   and its S3 location. Check-in commits write N rows atomically.
 *
 * Roles:
 *   primary      — the main deliverable (required, exactly one per version)
 *   sidecar      — metadata JSON, EDL, LUT, etc.
 *   proxy        — thumbnail/preview/ladder output
 *   frame_range  — one row per frame chunk in a sequence (OR one row with
 *                  frame_range_start/end if the sequence is stored as a
 *                  single multi-file prefix)
 *   audio        — detached audio track
 *   reference    — reference / bumper / slate
 *
 * Tables:
 *   - version_files: one row per physical file bound to a version
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 19,
  description: "Version files — multi-file manifests per version",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.version_files (
  id                 VARCHAR(36)    NOT NULL,
  version_id         VARCHAR(36)    NOT NULL,
  role               VARCHAR(32)    NOT NULL,
  filename           VARCHAR(512)   NOT NULL,
  s3_bucket          VARCHAR(255)   NOT NULL,
  s3_key             VARCHAR(2048)  NOT NULL,
  content_type       VARCHAR(128),
  size_bytes         BIGINT,
  checksum           VARCHAR(128),
  checksum_algorithm VARCHAR(16),
  frame_range_start  INTEGER,
  frame_range_end    INTEGER,
  frame_padding      INTEGER,
  checkin_id         VARCHAR(36),
  created_at         TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.version_files SET PROPERTIES sorted_by = ARRAY['version_id', 'role']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (19, CURRENT_TIMESTAMP, 'Version files — multi-file manifests')`
  ]
};

async function run(): Promise<void> {
  const endpoint = process.env.VAST_DB_ENDPOINT ?? process.env.VAST_TRINO_ENDPOINT;
  if (!endpoint) {
    console.error("ERROR: VAST_DB_ENDPOINT is not set");
    process.exit(1);
  }
  const client = new TrinoClient({
    endpoint,
    accessKey: process.env.VAST_ACCESS_KEY ?? "",
    secretKey: process.env.VAST_SECRET_KEY ?? "",
  });
  console.log(`Running migration ${migration.version}: ${migration.description}`);
  for (const sql of migration.statements) {
    const label = sql.trim().split("\n")[0].slice(0, 60);
    process.stdout.write(`  ${label}... `);
    try {
      await client.query(sql);
      console.log("done");
    } catch (err) {
      console.log(`(${(err instanceof Error ? err.message : String(err)).split("\n")[0]})`);
    }
  }
  console.log(`Migration ${migration.version} complete.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error(`Migration ${migration.version} failed:`, err);
    process.exit(1);
  });
}
