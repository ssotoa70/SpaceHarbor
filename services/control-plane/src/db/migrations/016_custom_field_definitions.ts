/**
 * Migration 016: Custom Field Definitions — runtime-extensible entity schema.
 *
 * Background:
 *   Studios demand per-show custom metadata (LUT names, client codes, vendor
 *   tags, retake reasons) on day one. Fixed TypeScript `interface`s in
 *   `domain/models.ts` force a code deploy for every new field. TACTIC solves
 *   this with `CustomProperty` that ALTERs the parent table at runtime.
 *
 *   We take a less invasive approach: store a **definition registry** that
 *   lists every custom field per entity type, and persist field values in a
 *   single narrow table (`custom_field_values`). Values are read at fetch
 *   time and projected onto the entity as a `customFields: Record<string,
 *   unknown>` map. No ALTER TABLE is ever needed — adding a field is a
 *   single INSERT into `custom_field_definitions` + client reload.
 *
 * Data types supported:
 *   string | number | boolean | date | enum | ref
 *     - enum stores allowed values in `validation_json.allowed_values`
 *     - ref stores target entity_type in `validation_json.ref_entity_type`
 *
 * Entity types supported (initially):
 *   asset | version | shot | sequence | project | material
 *
 * Lifecycle:
 *   - Soft-delete via `deleted_at` — existing values remain readable but
 *     cannot be written. Hard-delete requires a separate admin op that
 *     also drops `custom_field_values` rows for that definition.
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 16,
  description: "Custom field definitions registry + values table (runtime entity extension)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.custom_field_definitions (
  id                 VARCHAR(36)    NOT NULL,
  entity_type        VARCHAR(32)    NOT NULL,
  name               VARCHAR(64)    NOT NULL,
  display_label      VARCHAR(128)   NOT NULL,
  data_type          VARCHAR(16)    NOT NULL,
  required           BOOLEAN        NOT NULL,
  validation_json    VARCHAR(4000),
  display_config_json VARCHAR(4000),
  description        VARCHAR(1000),
  created_by         VARCHAR(255)   NOT NULL,
  created_at         TIMESTAMP(6)   NOT NULL,
  updated_at         TIMESTAMP(6)   NOT NULL,
  deleted_at         TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.custom_field_definitions SET PROPERTIES sorted_by = ARRAY['entity_type', 'name']`,

    `CREATE TABLE IF NOT EXISTS ${S}.custom_field_values (
  id            VARCHAR(36)    NOT NULL,
  definition_id VARCHAR(36)    NOT NULL,
  entity_type   VARCHAR(32)    NOT NULL,
  entity_id     VARCHAR(36)    NOT NULL,
  value_text    VARCHAR(8000),
  value_number  DOUBLE,
  value_bool    BOOLEAN,
  value_date    TIMESTAMP(6),
  created_by    VARCHAR(255)   NOT NULL,
  created_at    TIMESTAMP(6)   NOT NULL,
  updated_at    TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.custom_field_values SET PROPERTIES sorted_by = ARRAY['entity_type', 'entity_id']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (16, CURRENT_TIMESTAMP, 'Custom field definitions + values')`
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
