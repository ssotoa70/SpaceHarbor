/**
 * Migration 002: Episode and Task entities (SERGIO-136)
 *
 * Adds: episodes, tasks, episode_sequences (join), version_tasks (join) tables.
 *
 * Run standalone: npx tsx src/db/migrations/002_episode_task.ts
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."assetharbor/production"';

export const migration: Migration = {
  version: 2,
  description: "Episode and Task entities",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.episodes (
  id              VARCHAR(36)   NOT NULL,
  project_id      VARCHAR(36)   NOT NULL,
  code            VARCHAR(64)   NOT NULL,
  name            VARCHAR(255),
  status          VARCHAR(32)   NOT NULL,
  sequence_count  INTEGER       NOT NULL,
  created_at      TIMESTAMP(6)  NOT NULL,
  updated_at      TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.tasks (
  id          VARCHAR(36)   NOT NULL,
  shot_id     VARCHAR(36)   NOT NULL,
  project_id  VARCHAR(36)   NOT NULL,
  sequence_id VARCHAR(36)   NOT NULL,
  code        VARCHAR(64)   NOT NULL,
  type        VARCHAR(32)   NOT NULL,
  status      VARCHAR(32)   NOT NULL,
  assignee    VARCHAR(100),
  due_date    TIMESTAMP(6),
  task_number INTEGER       NOT NULL,
  notes       VARCHAR(2000),
  created_at  TIMESTAMP(6)  NOT NULL,
  updated_at  TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.episode_sequences (
  episode_id  VARCHAR(36)   NOT NULL,
  sequence_id VARCHAR(36)   NOT NULL,
  created_at  TIMESTAMP(6)  NOT NULL
)`,

    `CREATE TABLE IF NOT EXISTS ${S}.version_tasks (
  task_id    VARCHAR(36)   NOT NULL,
  version_id VARCHAR(36)   NOT NULL,
  created_at TIMESTAMP(6)  NOT NULL
)`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (2, CURRENT_TIMESTAMP, 'Episode and Task entities')`
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
    await client.query(sql);
    const label = sql.trim().split("\n")[0].slice(0, 60);
    console.log(`  done: ${label}`);
  }
  console.log("Migration 002 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err) => {
    console.error("Migration 002 failed:", err);
    process.exit(1);
  });
}
