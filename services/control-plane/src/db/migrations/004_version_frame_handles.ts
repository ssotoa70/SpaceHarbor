/**
 * Migration 004: Version Frame Handles (SERGIO-139)
 *
 * VAST has no ALTER TABLE ADD COLUMN. Creates a companion table
 * (version_frame_handles) that is LEFT JOINed on version reads.
 *
 * Run standalone: npx tsx src/db/migrations/004_version_frame_handles.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 4,
  description: "Version frame handles companion table (SERGIO-139)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.version_frame_handles (
  version_id   VARCHAR(36)   NOT NULL,
  head_handle  INTEGER       NOT NULL,
  tail_handle  INTEGER       NOT NULL,
  updated_at   TIMESTAMP(6)  NOT NULL
)`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (4, CURRENT_TIMESTAMP, 'Version frame handles companion table (SERGIO-139)')`
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
  console.log("Migration 004 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 004 failed:", err);
    process.exit(1);
  });
}
