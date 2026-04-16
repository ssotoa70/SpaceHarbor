/**
 * Migration 021: Workflow Engine — declarative DAG workflows.
 *
 * Background:
 *   SpaceHarbor's workflow engine today is a 3-transition approval FSM.
 *   Phase 2 of the MAM readiness roadmap delivers a real engine: JSON DAG
 *   definitions, typed handler registry, engine driver, canvas editor.
 *
 *   This migration lands the persistence schema. The engine + handlers land
 *   in src/workflow/*.ts in the accompanying PR.
 *
 * DSL shape (stored in workflow_definitions.dsl_json):
 *   {
 *     "nodes": [
 *       {"id": "start", "kind": "start"},
 *       {"id": "approve", "kind": "approval", "config": {"approvers": ["user:sup@..."]}},
 *       {"id": "notify", "kind": "http", "config": {"url": "...", "method": "POST"}},
 *       {"id": "end", "kind": "end"}
 *     ],
 *     "edges": [
 *       {"from": "start", "to": "approve"},
 *       {"from": "approve", "to": "notify", "when": "state == 'approved'"},
 *       {"from": "notify", "to": "end"}
 *     ]
 *   }
 *
 * Node kinds (handler registry):
 *   start, end, approval, http, script, branch, wait_for_event, enqueue_job
 *
 * Instance lifecycle:
 *   pending → running → completed | failed | cancelled
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
  version: 21,
  description: "Workflow engine — definitions, instances, transitions",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.workflow_definitions (
  id             VARCHAR(36)    NOT NULL,
  name           VARCHAR(128)   NOT NULL,
  version        INTEGER        NOT NULL,
  description    VARCHAR(1000),
  dsl_json       VARCHAR(16000) NOT NULL,
  enabled        BOOLEAN        NOT NULL,
  created_by     VARCHAR(255)   NOT NULL,
  created_at     TIMESTAMP(6)   NOT NULL,
  updated_at     TIMESTAMP(6)   NOT NULL,
  deleted_at     TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.workflow_definitions SET PROPERTIES sorted_by = ARRAY['name', 'version']`,

    `CREATE TABLE IF NOT EXISTS ${S}.workflow_instances (
  id              VARCHAR(36)    NOT NULL,
  definition_id   VARCHAR(36)    NOT NULL,
  definition_version INTEGER     NOT NULL,
  current_node_id VARCHAR(64)    NOT NULL,
  state           VARCHAR(16)    NOT NULL,
  context_json    VARCHAR(16000) NOT NULL,
  started_by      VARCHAR(255)   NOT NULL,
  started_at      TIMESTAMP(6)   NOT NULL,
  updated_at      TIMESTAMP(6)   NOT NULL,
  completed_at    TIMESTAMP(6),
  last_error      VARCHAR(2000),
  parent_entity_type VARCHAR(32),
  parent_entity_id   VARCHAR(36)
)`,

    `ALTER TABLE ${S}.workflow_instances SET PROPERTIES sorted_by = ARRAY['state', 'started_at']`,

    `CREATE TABLE IF NOT EXISTS ${S}.workflow_transitions (
  id             VARCHAR(36)    NOT NULL,
  instance_id    VARCHAR(36)    NOT NULL,
  from_node_id   VARCHAR(64)    NOT NULL,
  to_node_id     VARCHAR(64)    NOT NULL,
  event_type     VARCHAR(64),
  actor          VARCHAR(255),
  payload_json   VARCHAR(4000),
  at             TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.workflow_transitions SET PROPERTIES sorted_by = ARRAY['instance_id', 'at']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (21, CURRENT_TIMESTAMP, 'Workflow engine')`
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
