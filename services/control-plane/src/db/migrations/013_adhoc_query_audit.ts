/**
 * Migration 013: Ad-hoc Query Audit — tracks all SQL queries executed via the Query Console.
 *
 * Tables:
 *   - adhoc_query_audit: every ad-hoc query attempt with results metadata
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *   - Batch INSERTs preferred
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 13,
  description: "Ad-hoc query audit table for SQL Query Console",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.adhoc_query_audit (
  id                VARCHAR(36)    NOT NULL,
  user_id           VARCHAR(36)    NOT NULL,
  sql_text          VARCHAR(10240) NOT NULL,
  sql_hash          VARCHAR(64)    NOT NULL,
  row_count         INTEGER,
  duration_ms       INTEGER,
  status            VARCHAR(20)    NOT NULL,
  error_message     VARCHAR(2048),
  created_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.adhoc_query_audit SET PROPERTIES sorted_by = ARRAY['created_at', 'user_id']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (13, CURRENT_TIMESTAMP, 'Ad-hoc query audit table')`
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
  console.log("Migration 013 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 013 failed:", err);
    process.exit(1);
  });
}
