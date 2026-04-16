/**
 * Migration 020: Triggers + Webhooks — automation hooks.
 *
 * Background:
 *   The MAM readiness review called out "automation hooks" as SpaceHarbor's
 *   largest gap (score 0 vs TACTIC 5). This migration lands the schema for
 *   three related primitives:
 *
 *   1. `triggers` — admin-editable rules that fire on internal events.
 *      Pattern: `(event_selector, condition_json, action_kind, action_config)`.
 *   2. `webhook_endpoints` — registered outbound targets. Inbound webhooks
 *      (POST /webhooks/:id) verify HMAC against the same table.
 *   3. `webhook_delivery_log` — every attempted delivery for auditability
 *      + retry tracking.
 *
 * Event-selector pattern:
 *   Dotted strings matched against event.type at trigger time.
 *   Examples:
 *     asset.created        — fires for any asset.created event
 *     version.approved     — fires when a version transitions to qc_approved
 *     workflow.failed      — fires on any workflow instance failure
 *     checkin.committed    — fires when atomic check-in succeeds
 *
 * Action kinds (triggers.action_kind):
 *   http_call      — calls an external URL (optionally signed with HMAC)
 *   enqueue_job    — drops a job onto the workflow queue
 *   run_workflow   — starts a named workflow instance
 *   run_script     — executes a sandboxed JS snippet (isolated-vm, Phase 3)
 *   post_event     — emits another event onto the bus (cascade triggers)
 *
 * Webhook direction:
 *   - OUTBOUND: triggers with action_kind='http_call' dispatch to external
 *     services (Slack, Frame.io, Airtable, etc.). HMAC signing + retry.
 *   - INBOUND: POST /webhooks/:id accepts external events, verifies HMAC,
 *     then emits a synthetic event (type='webhook.inbound.{endpoint_name}')
 *     that triggers can subscribe to.
 *
 * Lifecycle:
 *   triggers.enabled=false disables without deleting.
 *   webhook_endpoints.revoked_at soft-deletes.
 *   webhook_delivery_log is append-only (retention runner sweeps old rows).
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase2.md (TBD)
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 20,
  description: "Triggers + Webhooks — automation hooks",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.triggers (
  id                 VARCHAR(36)    NOT NULL,
  name               VARCHAR(128)   NOT NULL,
  description        VARCHAR(1000),
  event_selector     VARCHAR(255)   NOT NULL,
  condition_json     VARCHAR(4000),
  action_kind        VARCHAR(32)    NOT NULL,
  action_config_json VARCHAR(8000)  NOT NULL,
  enabled            BOOLEAN        NOT NULL,
  created_by         VARCHAR(255)   NOT NULL,
  created_at         TIMESTAMP(6)   NOT NULL,
  updated_at         TIMESTAMP(6)   NOT NULL,
  last_fired_at      TIMESTAMP(6),
  fire_count         INTEGER        NOT NULL
)`,

    `ALTER TABLE ${S}.triggers SET PROPERTIES sorted_by = ARRAY['enabled', 'event_selector']`,

    `CREATE TABLE IF NOT EXISTS ${S}.webhook_endpoints (
  id                   VARCHAR(36)    NOT NULL,
  name                 VARCHAR(128)   NOT NULL,
  direction            VARCHAR(16)    NOT NULL,
  url                  VARCHAR(2048),
  secret_hash          VARCHAR(128)   NOT NULL,
  secret_prefix        VARCHAR(16)    NOT NULL,
  signing_algorithm    VARCHAR(32)    NOT NULL,
  allowed_event_types  VARCHAR(2000),
  description          VARCHAR(1000),
  created_by           VARCHAR(255)   NOT NULL,
  created_at           TIMESTAMP(6)   NOT NULL,
  last_used_at         TIMESTAMP(6),
  revoked_at           TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.webhook_endpoints SET PROPERTIES sorted_by = ARRAY['direction', 'created_at']`,

    `CREATE TABLE IF NOT EXISTS ${S}.webhook_delivery_log (
  id                VARCHAR(36)    NOT NULL,
  webhook_id        VARCHAR(36)    NOT NULL,
  trigger_id        VARCHAR(36),
  event_type        VARCHAR(128)   NOT NULL,
  event_payload     VARCHAR(8000),
  request_url       VARCHAR(2048),
  request_headers   VARCHAR(2000),
  response_status   INTEGER,
  response_body     VARCHAR(2000),
  status            VARCHAR(16)    NOT NULL,
  attempt_number    INTEGER        NOT NULL,
  last_error        VARCHAR(2000),
  started_at        TIMESTAMP(6)   NOT NULL,
  completed_at      TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.webhook_delivery_log SET PROPERTIES sorted_by = ARRAY['status', 'started_at']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (20, CURRENT_TIMESTAMP, 'Triggers + Webhooks')`
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
