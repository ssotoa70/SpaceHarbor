# Phase 2A: VAST Database Integration - Detailed Implementation Plan

**Duration:** Weeks 1-2
**Status:** Ready to kick off
**Approach:** Test-Driven Development (TDD) at every step
**Team Size:** 1-2 developers

---

## Confirmed Requirements Summary

| Requirement | Value |
|---|---|
| **Element Store** | NFS, SMB, S3 (protocol-agnostic via VAST) |
| **DCC Plugins** | Maya, Nuke, Houdini (Phase 2C+) |
| **Approval Workflow** | Single-level, extensible for multi-approval |
| **QC Validation** | Auto-checks + optional manual review |
| **Retention Policy** | 90 days post-finalization, adjustable |
| **Scalability** | 10-200 concurrent users |

---

## Phase 2A Goals

1. ✅ Replace in-memory Asset storage with VAST Database
2. ✅ Implement Element Handle binding
3. ✅ Query assets from VAST Catalog
4. ✅ Basic job state persistence
5. ✅ All 56 existing tests pass + new VAST tests

---

## Epic 1: VAST Database Connection & Asset Storage

### Task 1.1: Set Up VAST Database Client

**TDD: RED**
```typescript
// test/vast-database.test.ts - Write failing test first
test("VAST Database client can connect and execute queries", async () => {
  const client = new VastDatabaseClient({
    trino_url: "https://vast.example.com/api/v1/trino",
    api_token: "token-123"
  });

  const result = await client.query("SELECT 1 as test");
  assert.deepStrictEqual(result.rows[0].test, 1);
});

test("Can create assets table in VAST Database", async () => {
  const client = new VastDatabaseClient(config);

  const created = await client.execute(CREATE_ASSETS_TABLE_SQL);
  assert(created.success);
});
```

**TDD: GREEN**
```typescript
// src/vast/database/client.ts - Implement minimum to pass tests
import fetch from "node-fetch";

export class VastDatabaseClient {
  constructor(private config: VastDatabaseConfig) {}

  async query(sql: string): Promise<QueryResult> {
    const response = await fetch(`${this.config.trino_url}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.api_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: sql })
    });

    const data = await response.json();
    return {
      rows: data.results,
      success: !data.error
    };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    return this.query(sql);
  }
}
```

**TDD: REFACTOR**
- Extract connection pooling
- Add retry logic with exponential backoff
- Add query timeout handling
- Add logging via pino

**Files to Create:**
```
src/vast/
├── database/
│   ├── client.ts           # Trino REST client
│   ├── schema.ts           # SQL schema definitions
│   ├── connection-pool.ts  # Connection pooling
│   └── config.ts           # Configuration management
│
test/
├── vast-database.test.ts   # Client tests
├── vast-schema.test.ts     # Schema validation tests
└── fixtures/
    └── vast-config.json    # Test configuration
```

**Acceptance Criteria:**
- ✅ Can connect to Trino REST API
- ✅ Can execute CREATE TABLE statements
- ✅ Can handle authentication errors
- ✅ Connection pool prevents exhaustion
- ✅ Query timeout protects against hanging queries
- ✅ All tests pass

---

### Task 1.2: Create VAST Catalog Schema

**TDD: RED**
```typescript
// test/vast-schema.test.ts
test("Assets table schema matches VAST-native design", async () => {
  const client = new VastDatabaseClient(config);

  const created = await client.execute(ASSETS_TABLE_SQL);
  assert(created.success);

  // Verify columns exist
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'assets'`
  );

  const columnNames = columns.rows.map(r => r.column_name);
  assert(columnNames.includes("id"));
  assert(columnNames.includes("element_handle"));
  assert(columnNames.includes("title"));
  assert(columnNames.includes("status"));
  assert(columnNames.includes("metadata"));
});

test("Can insert asset into VAST Database", async () => {
  const client = new VastDatabaseClient(config);

  const result = await client.execute(
    `INSERT INTO assets (id, element_handle, title, status)
     VALUES ('asset-123', 'elem-abc', 'Shot 001', 'ingest')`
  );

  assert(result.success);
});

test("Can query assets by element_handle", async () => {
  const client = new VastDatabaseClient(config);

  const result = await client.query(
    `SELECT * FROM assets WHERE element_handle = 'elem-abc'`
  );

  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].title, "Shot 001");
});
```

**TDD: GREEN**
```typescript
// src/vast/database/schema.ts
export const ASSETS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS assets (
  id VARCHAR(36) PRIMARY KEY,
  element_handle VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Technical metadata
  media_type VARCHAR(20),
  mime_type VARCHAR(100),
  duration_ms BIGINT,
  file_size_bytes BIGINT,
  resolution VARCHAR(20),
  frame_rate FLOAT,
  video_codec VARCHAR(50),
  color_space VARCHAR(50),

  -- Status
  status VARCHAR(20) DEFAULT 'ingest',
  approval_status VARCHAR(20) DEFAULT 'pending',
  qc_status VARCHAR(20) DEFAULT 'pending',

  -- Tracking
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ingest_started_at TIMESTAMP,
  ingest_completed_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(100),

  -- Links
  thumbnail_element_handle VARCHAR(100),
  proxy_element_handle VARCHAR(100),
  metadata TEXT,

  -- Indexes
  INDEX idx_element_handle (element_handle),
  INDEX idx_status (status),
  INDEX idx_approval_status (approval_status),
  INDEX idx_created_at (created_at)
);
`;

export const WORKFLOW_JOBS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workflow_jobs (
  id VARCHAR(36) PRIMARY KEY,
  asset_id VARCHAR(36) NOT NULL,

  stage VARCHAR(50),
  status VARCHAR(20),

  processing_started_at TIMESTAMP,
  processing_completed_at TIMESTAMP,
  duration_seconds INT,

  dataengine_job_id VARCHAR(100),
  dataengine_status VARCHAR(50),

  output_element_handle VARCHAR(100),
  error_message TEXT,

  parameters TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (asset_id) REFERENCES assets(id),
  INDEX idx_asset_id (asset_id),
  INDEX idx_status (status),
  INDEX idx_stage (stage)
);
`;
```

**TDD: REFACTOR**
- Extract index definitions
- Add comments documenting table purposes
- Verify all required columns present
- Test constraint enforcement

**Acceptance Criteria:**
- ✅ Assets table created with all columns
- ✅ Workflow_jobs table created with foreign key
- ✅ Indexes optimize query performance
- ✅ Unique constraints on element_handle
- ✅ Default values work correctly
- ✅ All schema tests pass

---

### Task 1.3: Implement Asset Repository Layer

**TDD: RED**
```typescript
// test/asset-repository.test.ts
test("AssetRepository.create stores asset in VAST Database", async () => {
  const repo = new AssetRepository(vastDbClient);

  const asset = await repo.create({
    elementHandle: "elem-xyz",
    title: "Shot 001 - Master",
    description: "Opening shot"
  });

  assert(asset.id);
  assert.strictEqual(asset.elementHandle, "elem-xyz");
  assert.strictEqual(asset.title, "Shot 001 - Master");
  assert.strictEqual(asset.status, "ingest");
});

test("AssetRepository.findByElementHandle retrieves asset", async () => {
  const repo = new AssetRepository(vastDbClient);

  const created = await repo.create({
    elementHandle: "elem-abc",
    title: "Test Asset"
  });

  const found = await repo.findByElementHandle("elem-abc");
  assert.strictEqual(found?.id, created.id);
});

test("AssetRepository.updateStatus transitions asset state", async () => {
  const repo = new AssetRepository(vastDbClient);

  const asset = await repo.create({
    elementHandle: "elem-123",
    title: "Test"
  });

  const updated = await repo.updateStatus(
    asset.id,
    "ingest",
    "processing"
  );

  assert.strictEqual(updated.status, "processing");
});

test("Element handle remains constant across updates", async () => {
  const repo = new AssetRepository(vastDbClient);

  const asset = await repo.create({
    elementHandle: "elem-permanent",
    title: "Initial"
  });

  // Update various fields
  await repo.update(asset.id, {
    title: "Updated Title",
    status: "approved"
  });

  const retrieved = await repo.findByElementHandle("elem-permanent");
  assert.strictEqual(retrieved?.elementHandle, "elem-permanent");
});
```

**TDD: GREEN**
```typescript
// src/vast/repository/asset-repository.ts
export class AssetRepository {
  constructor(private db: VastDatabaseClient) {}

  async create(input: CreateAssetInput): Promise<Asset> {
    const id = generateUUID();
    const now = new Date().toISOString();

    await this.db.execute(`
      INSERT INTO assets (id, element_handle, title, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, input.elementHandle, input.title, input.description, "ingest", now]);

    return this.findById(id) as Promise<Asset>;
  }

  async findByElementHandle(handle: string): Promise<Asset | null> {
    const result = await this.db.query(`
      SELECT * FROM assets WHERE element_handle = ?
    `, [handle]);

    return result.rows[0] ? this.mapRowToAsset(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Asset | null> {
    const result = await this.db.query(`
      SELECT * FROM assets WHERE id = ?
    `, [id]);

    return result.rows[0] ? this.mapRowToAsset(result.rows[0]) : null;
  }

  async updateStatus(
    id: string,
    currentStatus: string,
    newStatus: string
  ): Promise<Asset> {
    await this.db.execute(`
      UPDATE assets SET status = ?, updated_at = NOW()
      WHERE id = ? AND status = ?
    `, [newStatus, id, currentStatus]);

    return this.findById(id) as Promise<Asset>;
  }

  async update(id: string, updates: Partial<Asset>): Promise<Asset> {
    const sets: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key !== "id" && key !== "elementHandle") {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    values.push(id);

    if (sets.length > 0) {
      await this.db.execute(`
        UPDATE assets SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = ?
      `, values);
    }

    return this.findById(id) as Promise<Asset>;
  }

  private mapRowToAsset(row: any): Asset {
    return {
      id: row.id,
      elementHandle: row.element_handle,
      title: row.title,
      description: row.description,
      status: row.status,
      approvalStatus: row.approval_status,
      qcStatus: row.qc_status,
      createdAt: row.created_at,
      // ... other fields
    };
  }
}
```

**TDD: REFACTOR**
- Extract query builder
- Add caching for frequently accessed assets
- Add validation before insert/update
- Add error handling for constraint violations

**Acceptance Criteria:**
- ✅ Can create assets in VAST Database
- ✅ Can retrieve assets by element handle
- ✅ Can update asset status with CAS (Compare-And-Swap)
- ✅ Element handle is immutable
- ✅ All repository tests pass
- ✅ No data loss on concurrent updates

---

## Epic 2: Element Handle Binding

### Task 2.1: Element Handle Lifecycle

**TDD: RED**
```typescript
// test/element-handle.test.ts
test("Element handle persists across asset mutations", async () => {
  const repo = new AssetRepository(vastDbClient);

  // Initial creation
  const asset = await repo.create({
    elementHandle: "elem-abc123",
    title: "Original Title"
  });

  const handle1 = asset.elementHandle;

  // Multiple updates
  await repo.update(asset.id, { title: "Updated Title" });
  await repo.update(asset.id, { status: "approved" });
  await repo.update(asset.id, { approvalStatus: "approved" });

  // Retrieve and verify
  const updated = await repo.findById(asset.id);
  assert.strictEqual(updated.elementHandle, handle1);
});

test("Asset lookup works by element handle after any update", async () => {
  const repo = new AssetRepository(vastDbClient);

  const asset = await repo.create({
    elementHandle: "elem-stable",
    title: "Test Asset"
  });

  // Make many updates
  for (let i = 0; i < 10; i++) {
    await repo.update(asset.id, { title: `Update ${i}` });
  }

  // Element handle lookup still works
  const found = await repo.findByElementHandle("elem-stable");
  assert(found);
  assert.strictEqual(found.id, asset.id);
});

test("File moved in VAST Element Store maintains same element handle", async () => {
  // This is a conceptual test showing how VAST handles file movement
  // The element handle never changes even if the file path changes

  const repo = new AssetRepository(vastDbClient);

  const asset = await repo.create({
    elementHandle: "elem-xyz",
    title: "Shot 001"
  });

  // Simulate file being moved in Element Store (path changes, handle stays same)
  // In real usage, VAST Element Store manages this
  const moved = await repo.findByElementHandle("elem-xyz");

  // Element handle is unchanged
  assert.strictEqual(moved.elementHandle, "elem-xyz");
  // This handle will resolve to the new file path in VAST Element Store
});
```

**Acceptance Criteria:**
- ✅ Element handles never change
- ✅ Assets always findable by element handle
- ✅ Element handle is primary lookup key
- ✅ File path can change, handle remains constant

---

## Integration: Replace In-Memory with VAST Database

### Task 3.1: Update PersistenceAdapter to Use VAST DB

**Current State (Phase 1):**
```typescript
// LocalPersistenceAdapter still used for tests
private assets = new Map<string, Asset>();
```

**Target State (Phase 2):**
```typescript
// VastPersistenceAdapter uses VAST Database
class VastPersistenceAdapter {
  private assetRepo = new AssetRepository(vastDbClient);

  async createIngestAsset(input, context): Promise<IngestResult> {
    const asset = await this.assetRepo.create({
      elementHandle: input.sourceUri, // Element handle from VAST
      title: input.title
    });

    const job = await this.jobRepo.create({
      assetId: asset.id,
      stage: "probe"
    });

    return { asset, job };
  }
}
```

**Migration Strategy:**
1. Keep LocalPersistenceAdapter for testing
2. Implement VastPersistenceAdapter with VAST DB
3. Run same contract tests against both adapters
4. Verify no behavioral differences

**Test Strategy:**
```typescript
// test/persistence-contract.test.ts
describe("Persistence Adapter Contract", () => {
  const adapters = [
    { name: "Local", factory: () => new LocalPersistenceAdapter() },
    { name: "VAST", factory: () => new VastPersistenceAdapter(config) }
  ];

  for (const { name, factory } of adapters) {
    describe(name, () => {
      let adapter;

      beforeEach(() => {
        adapter = factory();
      });

      test("createIngestAsset creates pending job", async () => {
        const result = await adapter.createIngestAsset(
          { title: "Test", sourceUri: "s3://bucket/test.mov" },
          { correlationId: "corr-123" }
        );

        assert(result.asset.id);
        assert.strictEqual(result.job.status, "pending");
      });

      // ... more contract tests
    });
  }
});
```

---

## Deliverables for Phase 2A

### Week 1
- ✅ VAST Database client fully functional
- ✅ Assets table created and populated
- ✅ Asset repository layer working
- ✅ 20+ new tests, all passing
- ✅ VastPersistenceAdapter partially implemented

### Week 2
- ✅ Element handle binding proven
- ✅ Workflow jobs table created
- ✅ All 56 original tests still passing
- ✅ All new VAST tests passing
- ✅ Documentation updated
- ✅ Ready for Phase 2B (Event Broker)

---

## Success Criteria

- ✅ Can create assets in VAST Database
- ✅ Can query assets by element handle
- ✅ Can update asset state with CAS safety
- ✅ Element handles are immutable
- ✅ No data loss on concurrent updates
- ✅ All tests passing (56+ total)
- ✅ Ready to scale to 10-200 users
- ✅ Zero production data loss from MVP migration

---

## Estimated Effort

| Task | Effort | TDD Phases |
|---|---|---|
| 1.1: VAST DB Client | 6 hours | RED (1h) GREEN (2h) REFACTOR (3h) |
| 1.2: Schema Design | 4 hours | RED (1h) GREEN (1h) REFACTOR (2h) |
| 1.3: Asset Repository | 8 hours | RED (2h) GREEN (3h) REFACTOR (3h) |
| 2.1: Element Handles | 4 hours | RED (1h) GREEN (2h) REFACTOR (1h) |
| 3.1: Integration | 6 hours | RED (1h) GREEN (3h) REFACTOR (2h) |
| Testing & Fixes | 6 hours | Writing/fixing tests |
| **Total** | **34 hours** | **~1.7 weeks for 1 person** |

---

## Next: Phase 2B

After Phase 2A completes:
- Event Broker Integration (Kafka)
- VAST DataEngine Integration
- Multi-stage workflow orchestration

**Phase 2 Ready to Kick Off!** 🚀
