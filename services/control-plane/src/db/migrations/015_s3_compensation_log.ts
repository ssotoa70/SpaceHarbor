/**
 * Migration 015: S3 Compensation Log — FileUndo equivalent for S3 side-effects.
 *
 * Background:
 *   Every S3 side-effect performed by the control-plane (PutObject, CopyObject,
 *   DeleteObject, InitiateMultipartUpload) must be reversible if the owning
 *   transaction fails. TACTIC's `FileUndo` pattern logs the inverse of every
 *   filesystem op so a DB rollback can be paired with a FS rollback.
 *
 *   We emulate the same primitive for S3 by recording the inverse operation
 *   alongside the forward operation. A reaper worker (to land in a follow-up
 *   phase) consumes `status = 'pending'` rows whose parent `tx_id` has been
 *   marked failed and executes the stored inverse.
 *
 * Lifecycle:
 *   status: pending → committed | compensated | failed
 *     - pending     — forward op succeeded, parent txn not yet resolved
 *     - committed   — parent txn committed; no compensation needed
 *     - compensated — parent txn failed; inverse op executed successfully
 *     - failed      — parent txn failed AND inverse op also failed (operator action required)
 *
 * Tables:
 *   - s3_compensation_log: one row per S3 side-effect with its inverse op
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *   - Batch INSERTs preferred
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 15,
  description: "S3 compensation log for transactional S3 side-effects",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.s3_compensation_log (
  id                 VARCHAR(36)    NOT NULL,
  tx_id              VARCHAR(64)    NOT NULL,
  correlation_id     VARCHAR(64),
  s3_bucket          VARCHAR(255)   NOT NULL,
  s3_key             VARCHAR(2048)  NOT NULL,
  operation          VARCHAR(32)    NOT NULL,
  inverse_operation  VARCHAR(32)    NOT NULL,
  inverse_payload    VARCHAR(8000),
  status             VARCHAR(16)    NOT NULL,
  actor              VARCHAR(255),
  created_at         TIMESTAMP(6)   NOT NULL,
  committed_at       TIMESTAMP(6),
  compensated_at     TIMESTAMP(6),
  last_error         VARCHAR(2000),
  attempts           INTEGER        NOT NULL
)`,

    `ALTER TABLE ${S}.s3_compensation_log SET PROPERTIES sorted_by = ARRAY['status', 'created_at']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (15, CURRENT_TIMESTAMP, 'S3 compensation log for transactional S3 side-effects')`
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
  console.log(`Migration ${migration.version} complete.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error(`Migration ${migration.version} failed:`, err);
    process.exit(1);
  });
}
