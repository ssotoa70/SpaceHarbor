# External Functions Architecture

SpaceHarbor is extensible through **External Functions** -- independent, containerized processing units that run on VAST DataEngine and own their own database schemas. The core MAM platform does not need to be modified when new functions are added.

## How It Works

```
                          VAST Cluster
 ┌──────────────────────────────────────────────────┐
 │  spaceharbor-db (View: S3 + DATABASE protocols)  │
 │  ┌──────────────┐ ┌──────────────┐ ┌───────────┐ │
 │  │ spaceharbor/  │ │ exr_metadata/│ │ proxy_gen/│ │
 │  │ production    │ │              │ │           │ │
 │  │ (MAM core)   │ │ (EXR Insp.)  │ │ (future)  │ │
 │  └──────┬───────┘ └──────┬───────┘ └─────┬─────┘ │
 │         │                │               │        │
 │         └────────────────┴───────────────┘        │
 │                    Trino SQL                      │
 │            (cross-schema JOINs work)              │
 └───────────────────────┬──────────────────────────-┘
                         │
              ┌──────────┴──────────┐
              │  SpaceHarbor        │
              │  Control-Plane      │
              │  (query bridge)     │
              └─────────────────────┘
```

### Schema Isolation: One Bucket, Many Schemas

All structured data lives in a single VAST Database bucket (`spaceharbor-db`) with the `S3,DATABASE` protocols enabled. Each application or function gets its own schema namespace:

| Schema | Owner | Tables |
|--------|-------|--------|
| `spaceharbor/production` | MAM core (control-plane) | ~57 tables: assets, versions, jobs, projects, sequences, shots, IAM, audit, etc. |
| `exr_metadata` | exr-inspector function | 6 tables: files, parts, channels, attributes, stats, validation_results |
| `proxy_gen` | oiio-proxy function (future) | TBD |
| `_migrations` | shared | Schema version tracking across all functions |

**No overlap exists** between schemas. The MAM tracks assets by `source_uri`; the EXR inspector tracks files by `file_path`. These are the join keys for cross-schema queries:

```sql
-- Join MAM assets with EXR metadata
SELECT a.title, a.source_uri, e.width, e.height, e.compression
FROM vast."spaceharbor-db/spaceharbor/production".assets a
JOIN vast."spaceharbor-db/exr_metadata".files e
  ON a.source_uri = e.file_path;
```

### Database Deployment

External functions deploy their own schemas via the **vastdb Python SDK** (not Trino DDL):

```python
import vastdb
import pyarrow as pa

session = vastdb.connect(
    endpoint='http://queryengine.vast.local',  # Query Engine VIP
    access=os.environ['VAST_ACCESS_KEY'],
    secret=os.environ['VAST_SECRET_KEY'],
)

with session.transaction() as tx:
    bucket = tx.bucket("spaceharbor-db")
    schema = bucket.create_schema("my_function_schema", fail_if_exists=False)
    try:
        schema.create_table("results", my_pyarrow_schema)
    except Exception:
        pass  # Table already exists -- idempotent
```

The SDK uses a get-or-create pattern -- safe for concurrent invocations.

## Anatomy of an External Function

Each function is an independent container that follows a standard contract:

```
my-function/
├── Dockerfile
├── requirements.txt
├── src/
│   └── function.py          # Entry point: main()
├── vast_schemas.py           # PyArrow schema definitions (canonical)
└── tests/
    └── test_function.py
```

### Contract

1. **Input**: Environment variables (`VAST_SOURCE_PATH`, `VAST_ASSET_ID`, `KAFKA_BROKER`, VAST credentials)
2. **Processing**: Read source file(s), extract/transform data
3. **DB Write**: Bootstrap own schema (idempotent), write results via vastdb SDK
4. **Output**: Publish CloudEvent to Kafka topic `spaceharbor.dataengine.completed`
5. **Exit**: Exit code 0 (success) or 1 (failure)

### Registration

Functions register with SpaceHarbor in two ways:

1. **Catalogue metadata** in `app.ts` -- declares the function's existence, DB schema, and capabilities:
   ```typescript
   registry.registerMetadata({
     id: "exr_inspector",
     name: "EXR Inspector",
     description: "Extract OpenEXR header metadata and channel structure",
     category: "Metadata Extraction",
     language: "Python",
     trigger: "on:ingest",
     inputs: ["*.exr"],
     outputs: ["metadata", "thumbnails"],
     status: "active",
     dbSchema: "exr_metadata",       // <-- schema this function owns
     queryBridge: "vastdb-query:8070" // <-- optional query microservice
   });
   ```

2. **Docker Compose** entry (for local dev) or **Kubernetes Job** template (for production)

### Query Bridges

When an external function creates rich queryable data (e.g., EXR metadata with 6 normalized tables), it can expose a **query bridge** microservice. The control-plane routes queries to the bridge based on the function's `dbSchema` field:

```
GET /api/v1/dataengine/schemas/exr_metadata/query?file_path=...
  → vastdb-query:8070 (Python, talks to vastdb SDK)
  → Returns structured metadata from exr_metadata schema
```

This keeps the control-plane lightweight (TypeScript, Trino for MAM queries) while external functions handle their own specialized queries.

## Adding a New External Function

1. **Create the function container** under `services/dataengine-functions/my-function/`
2. **Define PyArrow schemas** in `vast_schemas.py` with the function's schema name
3. **Add to docker-compose.yml** using the `x-dataengine-function` anchor:
   ```yaml
   my-function:
     profiles: ["dataengine"]
     <<: *dataengine-function
     build:
       context: ./services/dataengine-functions
       dockerfile: my-function/Dockerfile
     environment:
       <<: *vast-credentials
       VASTDB_ENDPOINT: ${VASTDB_ENDPOINT:-}
       VASTDB_BUCKET: ${VASTDB_BUCKET:-}
       VAST_SOURCE_PATH: ${VAST_SOURCE_PATH:-}
       VAST_ASSET_ID: ${VAST_ASSET_ID:-}
       KAFKA_BROKER: ${KAFKA_BROKER:-}
     deploy:
       resources:
         limits:
           memory: 1G
           cpus: '2.0'
   ```
4. **Register metadata** in `app.ts` with `dbSchema` pointing to the function's schema
5. **Optional**: Add a query bridge microservice if the function produces rich queryable data
6. **Add pipeline config** in `dataengine.ts` to wire the function into ingest pipelines

## Open Problems

### Bulk Ingest

The current ingest endpoint (`POST /api/v1/assets/ingest`) handles one asset at a time. For EXR sequences with thousands of frames, this is impractical. Planned solutions:

- **Batch ingest endpoint**: `POST /api/v1/assets/ingest/batch` accepts a glob pattern or folder URI, discovers all matching files via S3 ListObjects, and creates assets in bulk
- **Sequence grouping**: EXR sequences (e.g., `beauty.1001.exr` through `beauty.1500.exr`) should be grouped as a single logical asset with frame range metadata, not 500 individual assets
- **VAST Element Triggers**: Instead of HTTP-driven ingest, VAST DataEngine can trigger functions automatically when new files appear in a watched path -- this is the production-grade solution

### Dynamic Function Registration

Currently, functions and pipelines are hardcoded in `app.ts` and `dataengine.ts`. Future work:

- **Function manifest file** (`function.yaml`) bundled with each function container, auto-discovered at startup
- **Runtime registration API**: `POST /api/v1/dataengine/functions` to register functions dynamically
- **Pipeline builder UI**: Operators compose pipelines from registered functions in the web UI

### Schema Discovery

The control-plane needs a way to discover what schemas external functions have created:

- **Convention**: Each function declares its `dbSchema` in metadata
- **Introspection**: Query `SHOW SCHEMAS FROM vast."spaceharbor-db"` via Trino to discover all schemas
- **Catalog API**: `GET /api/v1/dataengine/schemas` returns all known function schemas and their tables
