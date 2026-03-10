# Phase 1: Database Installer & Trino Client

**Duration:** 2 weeks (March 7-20, 2026)
**Goal:** Build a production-grade CLI installer for VAST Database schema setup and fix the Trino REST client so all migrations execute correctly against a real cluster.

---

## Why This Phase Is First

Everything downstream depends on durable persistence. Without a working Trino client and schema installer, the VAST Database adapter can never be real. This phase unblocks Phases 2-4.

---

## Deliverables

1. **Shared Trino REST client** (`src/db/trino-client.ts`) with proper `nextUri` polling and auth
2. **CLI installer** (`src/db/installer.ts`) with pre-flight checks, dry-run mode, and ordered migration execution
3. **Fixed migrations 002-005** — use shared Trino client, consistent auth, schema creation
4. **VastPersistenceAdapter Trino SQL** — write the actual SQL queries for all VFX hierarchy methods (unit-testable without a cluster)
5. **Tests** for Trino client, installer, and SQL query generation

---

## Task Breakdown

### Task 1.1: Shared Trino REST Client (~200 lines)

**Agent:** python-specialist or general-purpose
**Commit checkpoint:** After this task

**Prompt:**
```
Read services/control-plane/src/db/migrations/001_vfx_hierarchy.ts — it has a working
Trino REST client with proper nextUri polling. Extract and generalize this into a shared
module at services/control-plane/src/db/trino-client.ts.

Requirements:
- Export a TrinoClient class with constructor(endpoint, accessKey, secretKey)
- Method: async query(sql: string): Promise<TrinoQueryResult>
  - POST to /v1/statement with Basic auth (base64 of accessKey:secretKey)
  - Follow nextUri chain until state is FINISHED or FAILED
  - Return { columns, data, rowCount } on success
  - Throw TrinoQueryError with message + queryId on failure
- Method: async healthCheck(): Promise<{ reachable: boolean; version?: string }>
  - GET /v1/info — parse version from response
- Set X-Trino-User header to configurable user (default: "assetharbor")
- Set X-Trino-Schema to configurable schema (default: 'vast."assetharbor/production"')
- Timeout: configurable, default 30s per query
- Export types: TrinoQueryResult, TrinoQueryError, TrinoClientConfig

Write tests in services/control-plane/test/trino-client.test.ts:
- Mock fetch to simulate nextUri polling chain (3 hops)
- Test auth header is correct Base64
- Test error propagation from FAILED state
- Test healthCheck parsing
- Test timeout behavior

Do NOT import any external HTTP libraries — use native fetch.
```

**Validation:** Tests pass. No TS errors. Under 200 lines for client + under 150 lines for tests.

---

### Task 1.2: Fix Migrations 002-005 (~150 lines changed)

**Agent:** general-purpose
**Commit checkpoint:** After this task

**Prompt:**
```
Read all 5 migration files in services/control-plane/src/db/migrations/.
Also read the new shared Trino client at services/control-plane/src/db/trino-client.ts.

Problems to fix in migrations 002-005:
1. They do NOT follow nextUri — they fire POST and only check HTTP status.
   Trino returns 200 immediately even for failing queries. Actual errors surface
   in the nextUri polling chain. Migration 001 does this correctly.
2. Auth inconsistency — 001 uses Basic auth (correct for VAST), 002-005 use
   X-Trino-User header only (fails on secured clusters).
3. No CREATE SCHEMA step — none create vast."assetharbor/production" first.

Fix:
- Refactor all 5 migrations to import and use the shared TrinoClient
- Each migration should: instantiate TrinoClient from env vars, run its DDL statements
  via client.query(), insert schema_version row, log results
- Migration 001 should add: CREATE SCHEMA IF NOT EXISTS vast."assetharbor/production"
  as its first statement
- Keep CREATE TABLE IF NOT EXISTS for idempotency
- Remove the inline trinoQuery/fetch implementations from each migration
- Keep env vars: VAST_TRINO_ENDPOINT, VAST_ACCESS_KEY, VAST_SECRET_KEY

Test: existing behavior preserved — each migration is still runnable standalone via
npx tsx src/db/migrations/NNN_*.ts

Do NOT change the SQL DDL statements themselves — only the execution infrastructure.
```

**Validation:** Each migration imports shared client. Auth is consistent. Schema creation happens first.

---

### Task 1.3: CLI Installer (~250 lines)

**Agent:** general-purpose
**Commit checkpoint:** After this task

**Prompt:**
```
Create a CLI database installer at services/control-plane/src/db/installer.ts.

This tool connects to a VAST cluster's Trino endpoint and runs all schema migrations
in order, with safety checks.

Requirements:
- Parse CLI args (no external lib — use process.argv):
  --trino-endpoint <url>     (required)
  --access-key <key>         (required)
  --secret-key <key>         (required)
  --target-version <N>       (optional: stop at this migration version)
  --dry-run                  (optional: print SQL without executing)
  --schema <name>            (optional: default "assetharbor/production")
  --help                     (print usage)

- Pre-flight checks:
  1. Verify Trino endpoint is reachable (client.healthCheck())
  2. Verify auth works (client.query("SELECT 1"))
  3. Check current schema_version (SELECT MAX(version) FROM schema_version)
     - If table doesn't exist, assume version 0

- Migration execution:
  1. Import migrations 001-005 as modules (each exports { version, description, statements[] })
  2. Filter to migrations where version > current schema version
  3. If --target-version set, also filter to version <= target
  4. For each migration in order:
     a. Print "Running migration {version}: {description}..."
     b. If --dry-run: print each SQL statement and skip execution
     c. Execute each statement via client.query()
     d. Insert schema_version row
     e. Print checkmark on success
  5. Print summary: "Applied {N} migrations. Current version: {M}"

- Error handling:
  - If any statement fails, print error and EXIT (do not continue to next migration)
  - Print the failing SQL statement and Trino error message
  - Suggest: "Re-run the installer to resume from where it left off"

- Add to package.json scripts: "db:install": "tsx src/db/installer.ts"

Write tests in services/control-plane/test/installer.test.ts:
- Test arg parsing (missing required args → error)
- Test dry-run mode (no queries executed, SQL printed)
- Test version gating (skip already-applied migrations)
- Test error handling (migration failure stops execution)
- Mock TrinoClient for all tests

This will require refactoring migrations to export their DDL statements as arrays
rather than executing them directly. Each migration file should export:
  { version: number, description: string, statements: string[] }
and keep the standalone execution as: if (require.main === module) { run() }
```

**Validation:** `npm run db:install -- --help` prints usage. Tests pass. Dry-run mode works.

---

### Task 1.4: VastPersistenceAdapter Trino SQL (~400 lines)

**Agent:** db-sql-specialist
**Commit checkpoint:** Split into TWO commits (1.4a and 1.4b) to stay under 1200 lines

**Task 1.4a — Read operations (~200 lines):**

**Prompt:**
```
Read services/control-plane/src/persistence/types.ts for the full PersistenceAdapter interface.
Read services/control-plane/src/persistence/adapters/vast-persistence.ts for current implementation.
Read services/control-plane/src/db/migrations/ to understand the table schemas.

The VastPersistenceAdapter currently delegates ALL VFX hierarchy methods to LocalPersistenceAdapter.
Your job: implement the Trino SQL queries for READ operations.

Replace the LocalAdapter delegation in these methods with real Trino SQL:
- getProjectById(id) → SELECT * FROM vast."assetharbor/production".projects WHERE id = ?
- listProjects(status?) → SELECT with optional WHERE status = ?
- getSequenceById(id) → SELECT from sequences
- listSequencesByProject(projectId) → SELECT WHERE project_id = ?
- getShotById(id) → SELECT from shots
- listShotsBySequence(sequenceId) → SELECT WHERE sequence_id = ?
- getVersionById(id) → SELECT from versions LEFT JOIN version_review_status LEFT JOIN version_frame_handles
- listVersionsByShot(shotId) → SELECT with same JOINs, ORDER BY version_number DESC
- getEpisodeById(id) → SELECT from episodes
- listEpisodesByProject(projectId) → SELECT WHERE project_id = ?
- getTaskById(id) → SELECT from tasks
- listTasksByShot(shotId) → SELECT WHERE shot_id = ?
- getMaterialById(id) → SELECT from materials
- listMaterialsByProject(projectId) → SELECT WHERE project_id = ?

IMPORTANT:
- Use parameterized queries via the TrinoClient (pass values, not string interpolation)
- If TrinoClient is not available (no VAST_DATABASE_URL), fall back to localAdapter
- versions queries must LEFT JOIN version_review_status and version_frame_handles (companion tables)
- Map Trino row results to TypeScript domain model types
- Add a private method: mapRowToProject(), mapRowToVersion(), etc.

Write tests in services/control-plane/test/vast-persistence-sql.test.ts:
- Mock TrinoClient responses
- Verify correct SQL generated for each method
- Verify companion table JOINs for versions
- Verify fallback to localAdapter when no TrinoClient
```

**Task 1.4b — Write operations (~200 lines):**

**Prompt:**
```
Continue from Task 1.4a. Now implement WRITE operations in VastPersistenceAdapter:

- createProject(input) → INSERT INTO projects VALUES (...)
- createSequence(input) → INSERT with FK check (project exists)
- createShot(input) → INSERT with FK check (project + sequence exist)
- createVersion(input) → INSERT into versions + version_review_status + version_frame_handles
- updateShotStatus(id, status) → UPDATE shots SET status = ? WHERE id = ?
- publishVersion(id) → UPDATE versions SET status = 'published', published_at = NOW()
- updateVersionReviewStatus(id, status) → UPDATE version_review_status
- updateVersionTechnicalMetadata(id, metadata) → UPDATE versions SET codec = ?, resolution_w = ?, ...
- createEpisode(input) → INSERT
- createTask(input) → INSERT
- updateTaskStatus(id, status) → UPDATE
- createMaterial(input) → INSERT
- createMaterialVersion(input) → INSERT into material_versions
- createLookVariant(input) → INSERT
- createVersionMaterialBinding(input) → INSERT
- createMaterialDependency(input) → INSERT
- createVersionApproval(input) → INSERT into version_approvals

IMPORTANT:
- VAST Database has NO foreign key constraints — enforce referential integrity in code
  (check parent exists before INSERT, throw ReferentialIntegrityError if not)
- Sort key columns CANNOT be updated via UPDATE — only DELETE + re-INSERT
  (shots sorted by [project_id, sequence_id]; versions sorted by [shot_id, version_number])
- No transactions — each statement is independent. Design for crash recovery.
- Use the same fallback pattern as read operations

Add tests to the existing test file from 1.4a.
```

**Validation:** All SQL queries are correct for VAST/Trino dialect. Tests pass. No TS errors.

---

### Task 1.5: Integration Test Harness (~150 lines)

**Agent:** general-purpose
**Commit checkpoint:** After this task (final Phase 1 commit)

**Prompt:**
```
Create a docker-compose.test.yml that spins up an open-source Trino container with
the memory catalog for integration testing of the Trino client and installer.

File: services/control-plane/docker-compose.test.yml
- trino service: trinodb/trino:latest, port 8080
- Volume mount a catalog config that enables the "memory" catalog
- Health check: curl http://localhost:8080/v1/info

File: services/control-plane/test/integration/trino-integration.test.ts
- Skip if TRINO_INTEGRATION=false (default: skip in CI)
- Connect to local Trino
- Run installer in non-dry-run mode
- Verify tables exist via SHOW TABLES
- Run a few CRUD operations via VastPersistenceAdapter
- Clean up: DROP SCHEMA

Add to package.json scripts:
  "test:integration": "docker compose -f docker-compose.test.yml up -d && sleep 5 && TRINO_INTEGRATION=true vitest run test/integration/ && docker compose -f docker-compose.test.yml down"

NOTE: The memory catalog won't support VAST-specific features (sort keys, element handles),
but it validates Trino REST API client correctness, SQL syntax, and migration ordering.
```

**Validation:** `npm run test:integration` passes on a machine with Docker.

---

## Commit Strategy (Stay Under 1200 Lines Per Commit)

| Commit | Files | Est. Lines | Message |
|--------|-------|-----------|---------|
| 1 | trino-client.ts + test | ~350 | `feat(P1): shared Trino REST client with nextUri polling` |
| 2 | migrations 001-005 refactored | ~150 changed | `fix(P1): fix migrations to use shared Trino client + auth` |
| 3 | installer.ts + test | ~400 | `feat(P1): CLI database installer with dry-run and version gating` |
| 4 | vast-persistence.ts reads + test | ~400 | `feat(P1): VastPersistenceAdapter Trino SQL read operations` |
| 5 | vast-persistence.ts writes + test | ~400 | `feat(P1): VastPersistenceAdapter Trino SQL write operations` |
| 6 | docker-compose.test.yml + integration test | ~200 | `test(P1): Trino integration test harness` |

---

## Validation Checklist

- [ ] `npm test` — all existing 207 control-plane tests still pass
- [ ] `npm run db:install -- --dry-run --trino-endpoint http://fake` prints SQL without error
- [ ] New tests for trino-client, installer, SQL queries all pass
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Each commit under 1200 lines changed
- [ ] VastPersistenceAdapter falls back to LocalAdapter when VAST_DATABASE_URL is not set
