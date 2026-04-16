/**
 * Migration 017: Version Context + Sentinels — parallel version streams per shot.
 *
 * Background:
 *   SpaceHarbor's version model is single-linear per shot: `versionNumber`
 *   increments globally across every publish. Real VFX pipelines run parallel
 *   review/approval streams (`comp`, `anim`, `lighting`, `client`) per shot
 *   and need independent version histories.
 *
 *   TACTIC models this with `(sobject, context, version)` triples. We adopt
 *   the same capability by adding a `context` column to `versions` defaulting
 *   to "main", plus `latest`/`current`/`approved` sentinel pointers resolved
 *   through a central helper at fetch time.
 *
 * Columns added to `versions`:
 *   - context         VARCHAR(64)  NOT NULL DEFAULT 'main'
 *                     e.g. 'main', 'comp', 'anim', 'client'
 *   - is_sentinel     BOOLEAN      NOT NULL DEFAULT false
 *                     Marks a synthetic "pointer" row (latest/current/approved)
 *   - sentinel_name   VARCHAR(32)
 *                     Populated only when is_sentinel=true; one of
 *                     'latest' | 'current' | 'approved'
 *   - manifest_id     VARCHAR(36)
 *                     FK to version_manifests (Phase 2, multi-file versions)
 *
 * Uniqueness contract (enforced application-side since VAST lacks unique
 * constraints):
 *   - (shot_id, context, version_number) must be unique for non-sentinel rows
 *   - (shot_id, context, sentinel_name) must be unique for sentinel rows
 *
 * The application enforces uniqueness via a pre-insert SELECT inside a
 * serializable transaction; see persistence.insertVersion for the race fix.
 *
 * VAST Database behavior (verified with vast-platform-engineer 2026-04-16):
 *   - ALTER TABLE ADD COLUMN is supported, implemented as a metadata-only
 *     operation (no row rewrite on populated tables).
 *   - `IF NOT EXISTS` is NOT guaranteed on the VAST Trino connector — the
 *     statements below omit it. Re-running the migration on an already-
 *     migrated cluster will raise a "column already exists" error for each
 *     ALTER; the installer/vast-migrate.py pattern is to catch per-statement
 *     errors and continue, making re-runs idempotent in practice.
 *   - Server-side DEFAULT and NOT NULL are NOT enforced on new columns
 *     against populated tables. The application defaults `context` to
 *     `"main"` and `is_sentinel` to `false` when reading back NULL.
 *
 * Plan reference: docs/plans/2026-04-16-mam-readiness-phase1.md
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 17,
  description: "Version context + sentinels (parallel version streams per shot)",
  statements: [
    // Each ALTER is its own transaction in VAST. Per-statement failures
    // are caught by the installer runner below and logged without
    // aborting the migration.
    `ALTER TABLE ${S}.versions ADD COLUMN context VARCHAR(64)`,
    `ALTER TABLE ${S}.versions ADD COLUMN is_sentinel BOOLEAN`,
    `ALTER TABLE ${S}.versions ADD COLUMN sentinel_name VARCHAR(32)`,
    `ALTER TABLE ${S}.versions ADD COLUMN manifest_id VARCHAR(36)`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (17, CURRENT_TIMESTAMP, 'Version context + sentinels')`
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
