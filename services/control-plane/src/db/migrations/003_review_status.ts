/**
 * Migration 003: VFX ReviewStatus field (SERGIO-138)
 *
 * VAST has no ALTER TABLE ADD COLUMN. Creates a companion table
 * (version_review_status) that is LEFT JOINed on version reads.
 *
 * Run standalone: npx tsx src/db/migrations/003_review_status.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 3,
  description: "VFX ReviewStatus field (SERGIO-138)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.version_review_status (
  version_id    VARCHAR(36)   NOT NULL,
  review_status VARCHAR(32)   NOT NULL,
  updated_at    TIMESTAMP(6)  NOT NULL
)`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (3, CURRENT_TIMESTAMP, 'VFX ReviewStatus field (SERGIO-138)')`
  ]
};

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const endpoint = process.env.VAST_DB_ENDPOINT ?? process.env.VAST_TRINO_ENDPOINT;
  if (process.env.VAST_TRINO_ENDPOINT && !process.env.VAST_DB_ENDPOINT) {
    console.warn("DEPRECATED: VAST_TRINO_ENDPOINT will be removed in a future release. Use VAST_DB_ENDPOINT instead.");
  }
  if (!endpoint) {
    console.error("ERROR: VAST_DB_ENDPOINT is not set");
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
  console.log("Migration 003 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 003 failed:", err);
    process.exit(1);
  });
}
