/**
 * Migration 007: Review Sessions
 *
 * Creates tables for dailies-oriented review sessions:
 * - review_sessions (scheduled review batches per project/department)
 * - review_session_submissions (assets submitted to a session)
 *
 * Run standalone: npx tsx src/db/migrations/007_review_sessions.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 7,
  description: "review sessions and submissions",
  statements: [
    // -----------------------------------------------------------------------
    // Review sessions (dailies, client reviews, finals)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.review_sessions (
  id              VARCHAR(36)    NOT NULL,
  project_id      VARCHAR(255)   NOT NULL,
  department      VARCHAR(100),
  session_date    DATE           NOT NULL,
  session_type    VARCHAR(50)    NOT NULL,
  supervisor_id   VARCHAR(255),
  status          VARCHAR(20)    NOT NULL,
  created_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.review_sessions SET PROPERTIES sorted_by = ARRAY['project_id', 'session_date']`,

    // -----------------------------------------------------------------------
    // Review session submissions (assets queued for review in a session)
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.review_session_submissions (
  id                VARCHAR(36)    NOT NULL,
  session_id        VARCHAR(36)    NOT NULL,
  asset_id          VARCHAR(36)    NOT NULL,
  version_id        VARCHAR(36),
  submission_order  INTEGER        NOT NULL,
  status            VARCHAR(20)    NOT NULL,
  submitted_at      TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.review_session_submissions SET PROPERTIES sorted_by = ARRAY['session_id', 'submission_order']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (7, CURRENT_TIMESTAMP, 'review sessions and submissions')`
  ]
};

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const endpoint = process.env.VAST_TRINO_ENDPOINT;
  if (!endpoint) {
    console.error("ERROR: VAST_TRINO_ENDPOINT is not set");
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
  console.log("Migration 007 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 007 failed:", err);
    process.exit(1);
  });
}
