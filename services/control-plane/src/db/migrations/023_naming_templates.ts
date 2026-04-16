/**
 * Migration 023: Naming Templates — studio file/version naming conventions.
 *
 * Background
 * ----------
 * Studios enforce naming conventions for incoming asset filenames, version
 * labels, and exported delivery files. The naming-template engine
 * (src/domain/naming-template.ts) renders templates like
 *   {project}_{shot}_v{version:03d}_{date:YYYYMMDD}
 * against a context object. This table persists named templates so admins
 * can manage them through the UI; downstream code (check-in, export, version
 * label generation) reads them by scope+enabled at runtime.
 *
 * Soft-delete via deleted_at preserves audit trail; the route layer filters
 * deleted rows from default reads.
 *
 * VAST Database constraints:
 *   - Sort keys permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase5.md (TBD)
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 23,
  description: "Naming templates — studio file/version naming conventions",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.naming_templates (
  id                  VARCHAR(36)    NOT NULL,
  name                VARCHAR(128)   NOT NULL,
  description         VARCHAR(1000),
  scope               VARCHAR(32)    NOT NULL,
  template            VARCHAR(2048)  NOT NULL,
  sample_context_json VARCHAR(4000),
  enabled             BOOLEAN        NOT NULL,
  created_by          VARCHAR(255)   NOT NULL,
  created_at          TIMESTAMP(6)   NOT NULL,
  updated_at          TIMESTAMP(6)   NOT NULL,
  deleted_at          TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.naming_templates SET PROPERTIES sorted_by = ARRAY['scope', 'name']`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (23, CURRENT_TIMESTAMP, 'Naming templates')`,
  ],
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
