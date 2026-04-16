/**
 * Migration 018: Checkins — in-flight atomic check-in state.
 *
 * Background:
 *   The atomic check-in endpoint (routes/checkin.ts) is a two-call protocol:
 *   reserve → commit. Between those calls we need durable state so the
 *   commit endpoint can look up the multipart upload, the reaper can
 *   identify abandoned checkins, and the audit trail can cite a stable
 *   checkin_id. This table is that state.
 *
 *   The s3_compensation_log (migration 015) records the S3 side-effects;
 *   this `checkins` table tracks the higher-level workflow state and
 *   pointers into the compensation log.
 *
 * Lifecycle:
 *   state: reserved → committed | compensating → aborted
 *     - reserved     — /checkin succeeded, waiting for /commit
 *     - committed    — /commit succeeded, version published, sentinels updated
 *     - compensating — /commit failed mid-transaction, rollback in progress
 *     - aborted      — /abort issued (by client OR reaper), S3 AbortMultipartUpload
 *                      called, reserved version soft-deleted
 *
 * Tables:
 *   - checkins: one row per check-in attempt; carries state machine +
 *     references to version, shot, s3 upload, and the originating compensation tx
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
  version: 18,
  description: "Atomic check-in state table (reserved → committed | aborted)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.checkins (
  id                VARCHAR(36)    NOT NULL,
  tx_id             VARCHAR(64)    NOT NULL,
  version_id        VARCHAR(36)    NOT NULL,
  shot_id           VARCHAR(36)    NOT NULL,
  project_id        VARCHAR(36)    NOT NULL,
  sequence_id       VARCHAR(36)    NOT NULL,
  context           VARCHAR(64)    NOT NULL,
  state             VARCHAR(16)    NOT NULL,
  s3_bucket         VARCHAR(255)   NOT NULL,
  s3_key            VARCHAR(2048)  NOT NULL,
  s3_upload_id      VARCHAR(1024)  NOT NULL,
  part_plan_json    VARCHAR(8000)  NOT NULL,
  correlation_id    VARCHAR(64),
  actor             VARCHAR(255),
  deadline_at       TIMESTAMP(6)   NOT NULL,
  created_at        TIMESTAMP(6)   NOT NULL,
  updated_at        TIMESTAMP(6)   NOT NULL,
  committed_at      TIMESTAMP(6),
  aborted_at        TIMESTAMP(6),
  last_error        VARCHAR(2000)
)`,

    `ALTER TABLE ${S}.checkins SET PROPERTIES sorted_by = ARRAY['state', 'deadline_at']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (18, CURRENT_TIMESTAMP, 'Atomic check-in state table')`
  ]
};

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
