/**
 * Migration 001: VFX Hierarchy Schema
 *
 * Creates the Project → Sequence → Shot → Version → VersionApproval hierarchy
 * in VAST Database (assetharbor/production schema).
 *
 * Run with: npx tsx src/db/migrations/001_vfx_hierarchy.ts
 *
 * Required env vars:
 *   VAST_TRINO_ENDPOINT   — e.g. https://trino.vast.example.com:8443
 *   VAST_ACCESS_KEY       — S3 access key (used as Trino user)
 *   VAST_SECRET_KEY       — S3 secret key (used as Trino password)
 */

const TRINO_ENDPOINT = process.env.VAST_TRINO_ENDPOINT;
const ACCESS_KEY = process.env.VAST_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.VAST_SECRET_KEY ?? "";
const SCHEMA = `vast."assetharbor/production"`;

if (!TRINO_ENDPOINT) {
  console.error("ERROR: VAST_TRINO_ENDPOINT is not set");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Trino REST client (minimal — no external deps)
// ---------------------------------------------------------------------------

async function trinoQuery(sql: string): Promise<void> {
  const url = `${TRINO_ENDPOINT}/v1/statement`;
  const auth = Buffer.from(`${ACCESS_KEY}:${SECRET_KEY}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      "X-Trino-Catalog": "vast",
      "X-Trino-Schema": "assetharbor/production"
    },
    body: sql
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trino query failed (${response.status}): ${body}`);
  }

  // Follow nextUri until query completes
  let data: Record<string, unknown> = (await response.json()) as Record<string, unknown>;
  while (data.nextUri) {
    const next = await fetch(data.nextUri as string, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });
    data = (await next.json()) as Record<string, unknown>;
    if ((data as { error?: unknown }).error) {
      const err = (data as { error: { message: string } }).error;
      throw new Error(`Trino error: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CREATE TABLE statements
// ---------------------------------------------------------------------------

const DDL_STATEMENTS: Array<{ name: string; sql: string }> = [
  {
    name: "projects",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.projects (
  id              VARCHAR(36)   NOT NULL,
  code            VARCHAR(64)   NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  type            VARCHAR(32)   NOT NULL,
  status          VARCHAR(32)   NOT NULL,
  frame_rate      DOUBLE,
  color_space     VARCHAR(64),
  resolution_w    INTEGER,
  resolution_h    INTEGER,
  start_date      TIMESTAMP(6),
  delivery_date   TIMESTAMP(6),
  owner           VARCHAR(100),
  created_at      TIMESTAMP(6)  NOT NULL,
  updated_at      TIMESTAMP(6)  NOT NULL
)`
  },
  {
    name: "sequences",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.sequences (
  id                VARCHAR(36)   NOT NULL,
  project_id        VARCHAR(36)   NOT NULL,
  code              VARCHAR(64)   NOT NULL,
  episode           VARCHAR(64),
  name              VARCHAR(255),
  status            VARCHAR(32)   NOT NULL,
  shot_count        INTEGER       NOT NULL,
  frame_range_start INTEGER,
  frame_range_end   INTEGER,
  created_at        TIMESTAMP(6)  NOT NULL,
  updated_at        TIMESTAMP(6)  NOT NULL
)`
  },
  {
    name: "shots",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.shots (
  id                VARCHAR(36)   NOT NULL,
  project_id        VARCHAR(36)   NOT NULL,
  sequence_id       VARCHAR(36)   NOT NULL,
  code              VARCHAR(64)   NOT NULL,
  name              VARCHAR(255),
  status            VARCHAR(32)   NOT NULL,
  frame_range_start INTEGER       NOT NULL,
  frame_range_end   INTEGER       NOT NULL,
  frame_count       INTEGER       NOT NULL,
  frame_rate        DOUBLE,
  vendor            VARCHAR(100),
  lead              VARCHAR(100),
  priority          VARCHAR(16),
  due_date          TIMESTAMP(6),
  notes             VARCHAR(2000),
  latest_version_id VARCHAR(36),
  created_at        TIMESTAMP(6)  NOT NULL,
  updated_at        TIMESTAMP(6)  NOT NULL
)`
  },
  {
    name: "versions",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.versions (
  id                  VARCHAR(36)   NOT NULL,
  shot_id             VARCHAR(36)   NOT NULL,
  project_id          VARCHAR(36)   NOT NULL,
  sequence_id         VARCHAR(36)   NOT NULL,
  version_label       VARCHAR(32)   NOT NULL,
  version_number      INTEGER       NOT NULL,
  parent_version_id   VARCHAR(36),
  status              VARCHAR(32)   NOT NULL,
  media_type          VARCHAR(32)   NOT NULL,
  codec               VARCHAR(64),
  resolution_w        INTEGER,
  resolution_h        INTEGER,
  frame_rate          DOUBLE,
  frame_range_start   INTEGER,
  frame_range_end     INTEGER,
  pixel_aspect_ratio  DOUBLE,
  display_window      ROW(x INTEGER, y INTEGER, w INTEGER, h INTEGER),
  data_window         ROW(x INTEGER, y INTEGER, w INTEGER, h INTEGER),
  compression_type    VARCHAR(64),
  color_space         VARCHAR(64),
  bit_depth           INTEGER,
  channel_count       INTEGER,
  file_size_bytes     BIGINT,
  md5_checksum        VARCHAR(32),
  vast_element_handle VARCHAR(255),
  vast_path           VARCHAR(1024),
  created_by          VARCHAR(100)  NOT NULL,
  created_at          TIMESTAMP(6)  NOT NULL,
  published_at        TIMESTAMP(6),
  notes               VARCHAR(2000)
)`
  },
  {
    name: "version_assets",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.version_assets (
  id         VARCHAR(36)   NOT NULL,
  version_id VARCHAR(36)   NOT NULL,
  asset_id   VARCHAR(36)   NOT NULL,
  role       VARCHAR(32)   NOT NULL,
  created_at TIMESTAMP(6)  NOT NULL
)`
  },
  {
    name: "version_approvals",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.version_approvals (
  id           VARCHAR(36)   NOT NULL,
  version_id   VARCHAR(36)   NOT NULL,
  shot_id      VARCHAR(36)   NOT NULL,
  project_id   VARCHAR(36)   NOT NULL,
  action       VARCHAR(32)   NOT NULL,
  performed_by VARCHAR(100)  NOT NULL,
  role         VARCHAR(64),
  note         VARCHAR(2000),
  at           TIMESTAMP(6)  NOT NULL
)`
  },
  {
    name: "schema_version",
    sql: `CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_version (
  version     INTEGER       NOT NULL,
  applied_at  TIMESTAMP(6)  NOT NULL,
  description VARCHAR(255)  NOT NULL
)`
  }
];

// ---------------------------------------------------------------------------
// Sort key configuration (run after table creation)
// Caveat: requires 512k+ rows to activate; no-op on small datasets
// ---------------------------------------------------------------------------

const SORT_KEY_STATEMENTS: Array<{ table: string; columns: string[] }> = [
  { table: "shots", columns: ["project_id", "sequence_id"] },
  { table: "versions", columns: ["shot_id", "version_number"] }
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  console.log("=== Migration 001: VFX Hierarchy Schema ===");
  console.log(`Target: ${TRINO_ENDPOINT}`);
  console.log(`Schema: ${SCHEMA}`);
  console.log("");

  // Create tables
  for (const { name, sql } of DDL_STATEMENTS) {
    process.stdout.write(`  Creating ${name}... `);
    try {
      await trinoQuery(sql);
      created.push(name);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("already exists")) {
        skipped.push(name);
        console.log("(already exists, skipped)");
      } else {
        failed.push(name);
        console.log(`✗ ${msg}`);
      }
    }
  }

  // Set sort keys
  console.log("");
  for (const { table, columns } of SORT_KEY_STATEMENTS) {
    const colList = columns.map((c) => `'${c}'`).join(", ");
    const sql = `ALTER TABLE ${SCHEMA}.${table} SET PROPERTIES sorted_by = ARRAY[${colList}]`;
    process.stdout.write(`  Setting sort key on ${table} [${columns.join(", ")}]... `);
    try {
      await trinoQuery(sql);
      console.log("✓");
    } catch (err) {
      // Non-fatal: sort keys cannot be reset if already set
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`(skipped: ${msg.split("\n")[0]})`);
    }
  }

  // Insert schema_version row
  console.log("");
  process.stdout.write("  Inserting schema_version row... ");
  try {
    await trinoQuery(
      `INSERT INTO ${SCHEMA}.schema_version (version, applied_at, description) VALUES (1, CURRENT_TIMESTAMP, 'initial VFX hierarchy schema')`
    );
    console.log("✓");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`(skipped: ${msg.split("\n")[0]})`);
  }

  // Summary
  console.log("");
  console.log("=== Summary ===");
  if (created.length > 0) console.log(`  Created:  ${created.join(", ")}`);
  if (skipped.length > 0) console.log(`  Skipped:  ${skipped.join(", ")}`);
  if (failed.length > 0) {
    console.log(`  Failed:   ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log("  Done.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
