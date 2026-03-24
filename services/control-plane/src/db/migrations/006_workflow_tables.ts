/**
 * Migration 006: Workflow Tables
 *
 * Creates tables for workflow operations that were previously in-memory only:
 * - assets, jobs, queue (core ingest workflow)
 * - dlq (dead letter queue)
 * - outbox (transactional outbox pattern)
 * - audit_log (audit trail)
 * - processed_events (event dedup with TTL)
 * - incident_coordination, incident_notes (incident management)
 * - approval_audit (approval audit trail)
 * - dcc_audit (DCC session audit trail)
 * - timelines, timeline_clips (OTIO timeline data)
 *
 * Run standalone: npx tsx src/db/migrations/006_workflow_tables.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 6,
  description: "workflow tables (assets, jobs, queue, dlq, outbox, audit, events, incidents, timelines)",
  statements: [
    // -----------------------------------------------------------------------
    // Core workflow: assets
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.assets (
  id              VARCHAR(36)    NOT NULL,
  title           VARCHAR(255)   NOT NULL,
  source_uri      VARCHAR(2048)  NOT NULL,
  shot_id         VARCHAR(36),
  project_id      VARCHAR(36),
  version_label   VARCHAR(32),
  review_uri      VARCHAR(2048),
  metadata        VARCHAR(8000),
  version_info    VARCHAR(2000),
  integrity       VARCHAR(2000),
  created_at      TIMESTAMP(6)   NOT NULL,
  updated_at      TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.assets SET PROPERTIES sorted_by = ARRAY['created_at']`,

    // -----------------------------------------------------------------------
    // Core workflow: jobs
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.jobs (
  id                VARCHAR(36)    NOT NULL,
  asset_id          VARCHAR(36)    NOT NULL,
  source_uri        VARCHAR(2048)  NOT NULL,
  status            VARCHAR(32)    NOT NULL,
  attempt_count     INTEGER        NOT NULL,
  max_attempts      INTEGER        NOT NULL,
  last_error        VARCHAR(4000),
  next_attempt_at   TIMESTAMP(6),
  lease_owner       VARCHAR(100),
  lease_expires_at  TIMESTAMP(6),
  thumbnail         VARCHAR(2000),
  proxy             VARCHAR(2000),
  annotation_hook   VARCHAR(1000),
  handoff_checklist VARCHAR(1000),
  handoff           VARCHAR(1000),
  created_at        TIMESTAMP(6)   NOT NULL,
  updated_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.jobs SET PROPERTIES sorted_by = ARRAY['status', 'created_at']`,

    // -----------------------------------------------------------------------
    // Job queue (for claim/lease operations)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.queue (
  job_id            VARCHAR(36)    NOT NULL,
  asset_id          VARCHAR(36)    NOT NULL,
  available_at      TIMESTAMP(6)   NOT NULL,
  lease_owner       VARCHAR(100),
  lease_expires_at  TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.queue SET PROPERTIES sorted_by = ARRAY['available_at']`,

    // -----------------------------------------------------------------------
    // Dead letter queue
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.dlq (
  id              VARCHAR(36)    NOT NULL,
  job_id          VARCHAR(36)    NOT NULL,
  asset_id        VARCHAR(36)    NOT NULL,
  error           VARCHAR(4000)  NOT NULL,
  attempt_count   INTEGER        NOT NULL,
  failed_at       TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.dlq SET PROPERTIES sorted_by = ARRAY['failed_at']`,

    // -----------------------------------------------------------------------
    // Transactional outbox
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.outbox (
  id              VARCHAR(36)    NOT NULL,
  event_type      VARCHAR(128)   NOT NULL,
  correlation_id  VARCHAR(100)   NOT NULL,
  payload         VARCHAR(8000)  NOT NULL,
  created_at      TIMESTAMP(6)   NOT NULL,
  published_at    TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.outbox SET PROPERTIES sorted_by = ARRAY['created_at']`,

    // -----------------------------------------------------------------------
    // Audit log
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.audit_log (
  id        VARCHAR(36)    NOT NULL,
  message   VARCHAR(4000)  NOT NULL,
  at        TIMESTAMP(6)   NOT NULL,
  signal    VARCHAR(1000)
)`,

    `ALTER TABLE ${S}.audit_log SET PROPERTIES sorted_by = ARRAY['at']`,

    // -----------------------------------------------------------------------
    // Processed events (dedup with TTL cleanup)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.processed_events (
  event_id      VARCHAR(255)   NOT NULL,
  processed_at  TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.processed_events SET PROPERTIES sorted_by = ARRAY['processed_at']`,

    // -----------------------------------------------------------------------
    // Incident coordination (singleton row per cluster)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.incident_coordination (
  id                VARCHAR(36)    NOT NULL,
  acknowledged      BOOLEAN        NOT NULL,
  owner             VARCHAR(100)   NOT NULL,
  escalated         BOOLEAN        NOT NULL,
  next_update_eta   TIMESTAMP(6),
  guided_updated_at TIMESTAMP(6),
  handoff_state     VARCHAR(32)    NOT NULL,
  handoff_from      VARCHAR(100)   NOT NULL,
  handoff_to        VARCHAR(100)   NOT NULL,
  handoff_summary   VARCHAR(4000)  NOT NULL,
  handoff_updated_at TIMESTAMP(6)
)`,

    // -----------------------------------------------------------------------
    // Incident notes
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.incident_notes (
  id              VARCHAR(36)    NOT NULL,
  message         VARCHAR(4000)  NOT NULL,
  correlation_id  VARCHAR(100)   NOT NULL,
  author          VARCHAR(100)   NOT NULL,
  at              TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.incident_notes SET PROPERTIES sorted_by = ARRAY['at']`,

    // -----------------------------------------------------------------------
    // Approval audit trail
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.approval_audit (
  id            VARCHAR(36)    NOT NULL,
  asset_id      VARCHAR(36)    NOT NULL,
  action        VARCHAR(32)    NOT NULL,
  performed_by  VARCHAR(100)   NOT NULL,
  note          VARCHAR(2000),
  at            TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.approval_audit SET PROPERTIES sorted_by = ARRAY['at']`,

    // -----------------------------------------------------------------------
    // DCC audit trail
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.dcc_audit (
  id                VARCHAR(36)    NOT NULL,
  session_id        VARCHAR(36)    NOT NULL,
  operation         VARCHAR(64)    NOT NULL,
  entity_ref        VARCHAR(512),
  trait_set         VARCHAR(2000),
  result            VARCHAR(8000),
  duration_ms       INTEGER,
  at                TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.dcc_audit SET PROPERTIES sorted_by = ARRAY['session_id', 'at']`,

    // -----------------------------------------------------------------------
    // Timelines (OTIO)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.timelines (
  id              VARCHAR(36)    NOT NULL,
  name            VARCHAR(255)   NOT NULL,
  project_id      VARCHAR(36)    NOT NULL,
  frame_rate      DOUBLE         NOT NULL,
  duration_frames INTEGER        NOT NULL,
  source_uri      VARCHAR(2048)  NOT NULL,
  status          VARCHAR(32)    NOT NULL,
  created_at      TIMESTAMP(6)   NOT NULL,
  updated_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.timelines SET PROPERTIES sorted_by = ARRAY['project_id']`,

    // -----------------------------------------------------------------------
    // Timeline clips
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.timeline_clips (
  id              VARCHAR(36)    NOT NULL,
  timeline_id     VARCHAR(36)    NOT NULL,
  track_name      VARCHAR(128)   NOT NULL,
  clip_name       VARCHAR(255)   NOT NULL,
  source_uri      VARCHAR(2048),
  in_frame        INTEGER        NOT NULL,
  out_frame       INTEGER        NOT NULL,
  duration_frames INTEGER        NOT NULL,
  shot_name       VARCHAR(128),
  conform_status  VARCHAR(32)    NOT NULL,
  matched_shot_id VARCHAR(36),
  matched_asset_id VARCHAR(36),
  created_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.timeline_clips SET PROPERTIES sorted_by = ARRAY['timeline_id', 'in_frame']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (6, CURRENT_TIMESTAMP, 'workflow tables (assets, jobs, queue, dlq, outbox, audit, events, incidents, timelines)')`
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
  console.log("Migration 006 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 006 failed:", err);
    process.exit(1);
  });
}
