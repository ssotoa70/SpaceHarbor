/**
 * Migration 002: Episode and Task entities (SERGIO-136)
 *
 * Adds: episodes, tasks, episode_sequences (join), version_tasks (join) tables.
 * Cannot ALTER existing sequences or versions tables in VAST (no ADD COLUMN support).
 * Uses join tables instead.
 *
 * Run with: npx tsx src/db/migrations/002_episode_task.ts
 */

const TRINO_URL = process.env.VAST_TRINO_ENDPOINT ?? "http://localhost:8080";
const CATALOG = 'vast."assetharbor/production"';

async function query(sql: string): Promise<void> {
  const res = await fetch(`${TRINO_URL}/v1/statement`, {
    method: "POST",
    headers: { "X-Trino-User": "migration", "Content-Type": "text/plain" },
    body: sql
  });
  if (!res.ok) {
    throw new Error(`Trino query failed (${res.status}): ${await res.text()}`);
  }
}

async function run(): Promise<void> {
  console.log("Running migration 002: Episode + Task entities");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.episodes (
      id              VARCHAR(36)   NOT NULL,
      project_id      VARCHAR(36)   NOT NULL,
      code            VARCHAR(64)   NOT NULL,
      name            VARCHAR(255),
      status          VARCHAR(32)   NOT NULL,
      sequence_count  INTEGER       NOT NULL,
      created_at      TIMESTAMP(6)  NOT NULL,
      updated_at      TIMESTAMP(6)  NOT NULL
    )
  `);
  console.log("  ✓ episodes table");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.tasks (
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
    )
  `);
  console.log("  ✓ tasks table");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.episode_sequences (
      episode_id  VARCHAR(36)   NOT NULL,
      sequence_id VARCHAR(36)   NOT NULL,
      created_at  TIMESTAMP(6)  NOT NULL
    )
  `);
  console.log("  ✓ episode_sequences join table");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.version_tasks (
      task_id    VARCHAR(36)   NOT NULL,
      version_id VARCHAR(36)   NOT NULL,
      created_at TIMESTAMP(6)  NOT NULL
    )
  `);
  console.log("  ✓ version_tasks join table");

  await query(`
    INSERT INTO ${CATALOG}.schema_version (version, applied_at, description)
    VALUES (2, CURRENT_TIMESTAMP, 'Episode and Task entities')
  `);
  console.log("  ✓ schema_version updated to 2");

  console.log("Migration 002 complete.");
}

run().catch((err) => {
  console.error("Migration 002 failed:", err);
  process.exit(1);
});
