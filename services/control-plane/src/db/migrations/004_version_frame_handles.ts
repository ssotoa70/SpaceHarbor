/**
 * Migration 004: Version Frame Handles (SERGIO-139)
 *
 * VAST has no ALTER TABLE ADD COLUMN. The versions table was created in
 * migration 001 without head/tail handle columns. This migration creates a
 * companion table (version_frame_handles) that is LEFT JOINed on version reads.
 *
 * JOIN pattern for VastDbAdapter (future implementation):
 *   SELECT v.*, vfh.head_handle, vfh.tail_handle
 *   FROM vast."assetharbor/production".versions v
 *   LEFT JOIN vast."assetharbor/production".version_frame_handles vfh
 *     ON v.id = vfh.version_id
 *   WHERE v.id = ?
 *
 * Default: NULL (no handles recorded). Application layer (LocalPersistenceAdapter,
 * VastPersistenceAdapter) initializes to null when headHandle/tailHandle absent.
 *
 * Run with: npx tsx src/db/migrations/004_version_frame_handles.ts
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
  console.log("Running migration 004: Version frame handles");

  await query(`
    CREATE TABLE IF NOT EXISTS ${CATALOG}.version_frame_handles (
      version_id   VARCHAR(36)   NOT NULL,
      head_handle  INTEGER       NOT NULL,
      tail_handle  INTEGER       NOT NULL,
      updated_at   TIMESTAMP(6)  NOT NULL
    )
  `);
  console.log("  ✓ version_frame_handles companion table");

  await query(`
    INSERT INTO ${CATALOG}.schema_version (version, applied_at, description)
    VALUES (4, CURRENT_TIMESTAMP, 'Version frame handles companion table (SERGIO-139)')
  `);
  console.log("  ✓ schema_version updated to 4");

  console.log("Migration 004 complete.");
}

run().catch((err: unknown) => {
  console.error("Migration 004 failed:", err);
  process.exit(1);
});
