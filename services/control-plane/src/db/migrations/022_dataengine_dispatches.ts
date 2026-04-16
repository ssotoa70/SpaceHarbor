/**
 * Migration 022: DataEngine Dispatches — observability + feedback loop for
 * the ingest → proxy-gen → metadata-extract pipeline.
 *
 * Background
 * ----------
 * VAST element triggers on `ObjectCreated:CompleteMultipartUpload` already
 * fire DataEngine functions automatically after an atomic check-in commits.
 * The proxy appears in `.proxies/`, metadata lands in the function's target
 * table. SpaceHarbor historically had no record of "which files have a
 * pipeline expected to run, what stage are they in, and where did the
 * output end up".
 *
 * This table is that ledger. One row per (version_file × expected
 * DataEngine function). Populated by the dispatch service when
 * `checkin.committed` fires. Flipped to `completed` by either:
 *   (a) the Kafka subscriber matching a `vast.dataengine.pipeline.completed`
 *       event, or
 *   (b) a background poller that HEADs the expected artifact paths.
 *
 * Lifecycle:
 *   pending   → completed          (happy path)
 *   pending   → failed             (function errored OR artifact HEAD 404 past SLA)
 *   pending   → abandoned          (poller gives up after deadline)
 *   completed → (terminal)
 *
 * VAST Database constraints:
 *   - Sort keys permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md (P2.6)
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 22,
  description: "DataEngine dispatches — observability for auto-triggered pipelines",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.dataengine_dispatches (
  id                      VARCHAR(36)    NOT NULL,
  checkin_id              VARCHAR(36),
  version_id              VARCHAR(36)    NOT NULL,
  file_role               VARCHAR(32)    NOT NULL,
  file_kind               VARCHAR(32)    NOT NULL,
  source_s3_bucket        VARCHAR(255)   NOT NULL,
  source_s3_key           VARCHAR(2048)  NOT NULL,
  expected_function       VARCHAR(128)   NOT NULL,
  status                  VARCHAR(16)    NOT NULL,
  proxy_url               VARCHAR(2048),
  thumbnail_url           VARCHAR(2048),
  metadata_target_schema  VARCHAR(64),
  metadata_target_table   VARCHAR(64),
  metadata_row_id         VARCHAR(255),
  last_error              VARCHAR(2000),
  deadline_at             TIMESTAMP(6)   NOT NULL,
  created_at              TIMESTAMP(6)   NOT NULL,
  updated_at              TIMESTAMP(6)   NOT NULL,
  completed_at            TIMESTAMP(6),
  poll_attempts           INTEGER        NOT NULL,
  last_polled_at          TIMESTAMP(6),
  correlation_id          VARCHAR(64)
)`,

    `ALTER TABLE ${S}.dataengine_dispatches SET PROPERTIES sorted_by = ARRAY['status', 'deadline_at']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (22, CURRENT_TIMESTAMP, 'DataEngine dispatches ledger')`
  ]
};

async function run(): Promise<void> {
  const endpoint = process.env.VAST_DB_ENDPOINT ?? process.env.VAST_TRINO_ENDPOINT;
  if (!endpoint) { console.error("ERROR: VAST_DB_ENDPOINT is not set"); process.exit(1); }
  const client = new TrinoClient({ endpoint, accessKey: process.env.VAST_ACCESS_KEY ?? "", secretKey: process.env.VAST_SECRET_KEY ?? "" });
  console.log(`Running migration ${migration.version}: ${migration.description}`);
  for (const sql of migration.statements) {
    const label = sql.trim().split("\n")[0].slice(0, 60);
    process.stdout.write(`  ${label}... `);
    try { await client.query(sql); console.log("done"); }
    catch (err) { console.log(`(${(err instanceof Error ? err.message : String(err)).split("\n")[0]})`); }
  }
  console.log(`Migration ${migration.version} complete.`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => { console.error(`Migration ${migration.version} failed:`, err); process.exit(1); });
}
