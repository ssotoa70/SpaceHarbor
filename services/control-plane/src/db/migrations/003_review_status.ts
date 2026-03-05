/**
 * Migration 003: VFX ReviewStatus field (SERGIO-138)
 *
 * VAST does not support ALTER TABLE ADD COLUMN. The versions table was created
 * in migration 001 without review_status. This migration creates a companion
 * table (version_review_status) that is JOINed on version reads.
 *
 * Decision: Option B chosen because migrations 001 and 002 were already applied.
 * Amending 001 (Option A) would require re-creating the versions table on existing
 * clusters, which is destructive. The companion table approach is additive.
 *
 * Default value: "wip" — applied at the application layer (LocalPersistenceAdapter
 * and VastPersistenceAdapter default to "wip" when reviewStatus is absent).
 *
 * Run with: npx tsx src/db/migrations/003_review_status.ts
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
  console.log("Running migration 003: VFX ReviewStatus");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.version_review_status (
      version_id    VARCHAR(36)   NOT NULL,
      review_status VARCHAR(32)   NOT NULL,
      updated_at    TIMESTAMP(6)  NOT NULL
    )
  `);
  console.log("  ✓ version_review_status companion table");

  await query(`
    INSERT INTO ${CATALOG}.schema_version (version, applied_at, description)
    VALUES (3, CURRENT_TIMESTAMP, 'VFX ReviewStatus field (SERGIO-138)')
  `);
  console.log("  ✓ schema_version updated to 3");

  console.log("Migration 003 complete.");
}

run().catch((err: unknown) => {
  console.error("Migration 003 failed:", err);
  process.exit(1);
});
