/**
 * Migration 014: Processed Events — idempotency guard for event broker consumers.
 *
 * Tables:
 *   - processed_events: tracks event IDs that have already been handled to prevent
 *     duplicate processing under at-least-once delivery semantics.
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
  version: 14,
  description: "Processed events idempotency table for event broker consumers",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.processed_events (
  event_id       VARCHAR        PRIMARY KEY,
  processed_at   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
)`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (14, CURRENT_TIMESTAMP, 'Processed events idempotency table')`
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
  console.log("Migration 014 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 014 failed:", err);
    process.exit(1);
  });
}
