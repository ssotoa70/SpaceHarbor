/**
 * Migration 012: Audit Trail — Authorization Decision Persistence
 *
 * Creates the persistence layer for auth decision audit logging.
 * Part of Phase 3.1 — Audit Trail Persistence.
 *
 * Tables:
 *   - auth_decisions: every authorization decision (allow/deny) with context
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
  version: 12,
  description: "Audit trail: auth_decisions table for authorization decision persistence",
  statements: [
    // -----------------------------------------------------------------------
    // Auth Decisions — authorization audit log
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.auth_decisions (
  id                VARCHAR(36)    NOT NULL,
  timestamp         TIMESTAMP(6)   NOT NULL,
  actor_id          VARCHAR(36),
  actor_email       VARCHAR(255),
  auth_strategy     VARCHAR(20),
  permission        VARCHAR(100)   NOT NULL,
  resource_type     VARCHAR(50),
  resource_id       VARCHAR(255),
  decision          VARCHAR(10)    NOT NULL,
  denial_reason     VARCHAR(500),
  shadow_mode       BOOLEAN        NOT NULL,
  ip_address        VARCHAR(45),
  user_agent        VARCHAR(500),
  request_method    VARCHAR(10),
  request_path      VARCHAR(500)
)`,

    `ALTER TABLE ${S}.auth_decisions SET PROPERTIES sorted_by = ARRAY['timestamp', 'actor_id']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (12, CURRENT_TIMESTAMP, 'Audit trail: auth_decisions table')`
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
  console.log("Migration 012 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 012 failed:", err);
    process.exit(1);
  });
}
