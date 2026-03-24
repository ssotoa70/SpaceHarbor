# Control-Plane Architecture Guide

## Overview

SpaceHarbor's control-plane is a **Fastify server** that manages media asset workflows in VAST-native environments. It runs TypeScript directly via `tsx` (no build step) and provides:

- **Asset lifecycle**: ingest, metadata extraction, job tracking, approval workflows
- **VAST integration**: VAST Database (via Trino), VAST Event Broker (Kafka), DataEngine function invocation
- **IAM**: local auth, JWT/OIDC, API keys, SCIM, RBAC with shadow/enforcement modes
- **Async persistence**: abstracted adapter pattern for local/mock/VAST backends
- **Event-driven architecture**: inbound events from VAST Event Broker + HTTP webhooks

## Directory Structure

```
services/control-plane/src/
├── app.ts                 # buildApp() — main Fastify instance factory
├── server.ts              # CLI entry point
├── routes/                # 30+ route modules (assets, jobs, queue, etc.)
├── persistence/
│   ├── adapters/          # LocalAdapter, VastAdapter, MockAdapter implementations
│   ├── vast/              # VAST-specific clients (VAST Database, workflow ops)
│   ├── factory.ts         # createPersistenceAdapter() — factory pattern
│   └── types.ts           # PersistenceAdapter interface
├── iam/                   # 15+ auth/authz modules
│   ├── auth-plugin.ts     # JWT/API key/local auth resolution
│   ├── authz-engine.ts    # RBAC enforcement rules
│   ├── feature-flags.ts   # IAM rollout rings, shadow mode
│   └── role-binding.ts    # User/role/permission persistence
├── events/                # Kafka integration
│   ├── confluent-kafka.js # Confluent client wrapper
│   └── vast-event-subscriber.ts
├── data-engine/           # Function registry & TypeScript wrappers
│   ├── index.ts           # FunctionRegistry, built-in functions
│   ├── exr-inspector.ts   # EXR metadata extraction
│   └── oiio-proxy.ts      # OIIO thumbnail generation
├── db/                    # VAST Database client
│   ├── trino-client.ts    # REST API wrapper
│   └── installer.ts       # Schema initialization (CLI)
├── http/                  # Middleware & utilities
│   ├── correlation.ts     # Request ID propagation
│   └── openapi.ts         # Swagger/OpenAPI registration
├── reaping/               # Background tasks
│   └── lease-reaping.ts   # Job lease TTL enforcement
└── retention/
    └── audit-retention.ts # Audit log cleanup
```

## How to Add a New Route

1. **Create the route module** at `src/routes/{feature}.ts`:
   ```typescript
   import { FastifyInstance } from "fastify";
   import type { PersistenceAdapter } from "../persistence/types.js";

   export async function registerMyFeatureRoute(
     app: FastifyInstance,
     persistence: PersistenceAdapter,
     prefixes: string[]
   ) {
     for (const prefix of prefixes) {
       app.get(`${prefix}/my-feature`, async (req, reply) => {
         const data = await persistence.fetch("my_table", { id: "123" });
         reply.send(data);
       });
     }
   }
   ```

2. **Register it in `app.ts`** within the `app.after()` block (line ~278):
   ```typescript
   void registerMyFeatureRoute(app, persistence, prefixes);
   ```

3. **If writing, require identity or API key** (see `app.ts:223-264` for legacy enforcement or IAM checks at line ~134).

4. **Add OpenAPI schema** via `@fastify/swagger`:
   ```typescript
   app.get(`${prefix}/my-feature`,
     { schema: { tags: ["features"], operationId: "getMyFeature" } },
     handler
   );
   ```

## How to Add a New Migration

Migrations are SQL initialization scripts that run during cluster setup. They are **not part of the Node.js app**—they are run separately via:

```bash
npm run db:install
```

This executes `src/db/installer.ts`, which reads `.sql` files from a migrations directory (referenced but not implemented in current codebase).

**To add a migration:**
1. Create `src/db/migrations/001-tables.sql` (or next sequence number)
2. Include CREATE TABLE, CREATE INDEX, and any GRANT statements
3. Update `installer.ts` to load and execute migrations in order
4. Test with `npm run test:integration` against the docker-compose stack

## Persistence Adapter Pattern

SpaceHarbor abstracts all data storage behind a **PersistenceAdapter** interface (`src/persistence/types.ts`). This enables:

- **Local in-memory dev** (LocalAdapter)
- **Testing with mocks** (MockAdapter)
- **VAST production** (VastAdapter)

### Creating a New Adapter

1. Implement `PersistenceAdapter` interface (fetch, upsert, markIfNotProcessed, etc.)
2. Place at `src/persistence/adapters/{name}-adapter.ts`
3. Export from `src/persistence/adapters/index.ts`
4. Add selection logic to `factory.ts:createPersistenceAdapter()`

### Example: Querying a Table

```typescript
// Adapter method
async fetch(table: string, filters: Record<string, any>): Promise<any[]> {
  // LocalAdapter: query in-memory map
  // VastAdapter: execute VAST Database SELECT + WHERE
}

// Route usage
const assets = await persistence.fetch("assets", { status: "approved" });
```

## IAM / Authentication Flow

### When IAM is Enabled (`SPACEHARBOR_IAM_ENABLED=true`)

1. **onRequest hook** (`app.ts:108-265`):
   - Resolve `x-user-identity` header (always available for audit)
   - Public endpoints bypass auth (health, login, stream, etc.)
   - Private endpoints require credentials: JWT bearer, API key, or service token
   - Call `resolveAuth()` to validate credentials
   - If auth fails, return 401/403 (fail-closed)

2. **Authorization layer** (`app.ts:189-207`):
   - Call `evaluateRouteAuthz()` with auth context + request path/method
   - Shadow mode: log decision, allow request
   - Enforcement mode: deny if permission missing, return 403

3. **Feature flags** (`src/iam/feature-flags.ts`):
   - `iamEnabled`: master switch
   - `shadowMode`: log decisions without enforcing
   - `enforceWriteScope`: block write operations without tenant header
   - `rolloutRing`: gradual rollout per tenant/user

### Legacy Mode (IAM Disabled)

- Identity enforcement: strict mode requires `x-user-identity` header on writes
- API key enforcement: if keys configured, required for all writes
- No RBAC—all authenticated users have same permissions

## Event System

### VAST Event Broker (Kafka) Consumer

SpaceHarbor subscribes to VAST Event Broker topics for **DataEngine completion events**:

```typescript
// app.ts:391-416
const brokerUrl = process.env.VAST_EVENT_BROKER_URL;
if (brokerUrl) {
  subscriber = new VastEventSubscriber(persistence, kafkaClient, topic, groupId);
}

// onReady hook: start subscriber
if (subscriber) await subscriber.start();
```

The subscriber:
- Receives completion events from VAST DataEngine
- Updates job status in VastDB via `persistence` adapter
- Emits events to client via HTTP streaming (`/events/stream`)

### HTTP Webhook Events

Routes emit events via `persistence.publishEvent()` — in-memory for LocalAdapter, Kafka for VastAdapter.

## DataEngine Function Registry

Functions are registered at startup and invoked via HTTP or events:

```typescript
// app.ts:375-384
const functionRegistry = new FunctionRegistry();
functionRegistry.register(new ExrInspectorFunction());
functionRegistry.register(new OiioProxyFunction());
```

**To add a new function:**

1. Create `src/data-engine/my-function.ts`:
   ```typescript
   export class MyFunction implements DataEngineFunction {
     id = "my-function";
     async invoke(context: FunctionContext, payload: any) {
       // Call VAST DataEngine endpoint or run locally
     }
   }
   ```

2. Register in `app.ts`:
   ```typescript
   functionRegistry.register(new MyFunction());
   ```

3. Invoke from route or pipeline orchestrator via `functionRegistry.invoke(id, context)`.

## Testing Patterns

### Build App for Tests

All tests use `buildApp()` factory with optional mock adapter:

```typescript
import { buildApp } from "../src/app.js";
import { LocalPersistenceAdapter } from "../src/persistence/adapters/local.js";

describe("my route", () => {
  let app: FastifyInstance;

  before(async () => {
    app = buildApp({ persistenceAdapter: new LocalPersistenceAdapter() });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("fetches assets", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/assets" });
    assert.equal(res.statusCode, 200);
  });
});
```

### Run Tests

```bash
# All unit tests
npm test

# Contract tests only
npm run test:contracts

# Integration tests (requires docker-compose.test.yml running)
npm run test:integration
```

## Configuration via Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | HTTP server port | 3000 |
| `NODE_ENV` | production/development | development |
| `LOG_LEVEL` | Fastify logger level | info |
| `SPACEHARBOR_PERSISTENCE_BACKEND` | local/vast | local |
| `SPACEHARBOR_IAM_ENABLED` | Enable IAM system | false |
| `SPACEHARBOR_IAM_SHADOW_MODE` | Enforce RBAC or log only | true |
| `VAST_DATABASE_URL` | VAST Database SQL endpoint | (none) |
| `VAST_EVENT_BROKER_URL` | Kafka broker for events | (none) |
| `SPACEHARBOR_JWT_SECRET` | Sign JWTs (required if IAM enabled) | dev-secret-change-me |
| `SPACEHARBOR_ADMIN_EMAIL` | Bootstrap super_admin at startup | (none) |

See `app.ts:418-488` for startup validation gates.

## Key Files to Review

- **Startup sequence**: `app.ts` (buildApp, hooks, registration)
- **Route additions**: `routes/*.ts` (pattern repeats across all 30+ files)
- **Persistence contract**: `src/persistence/types.ts` (interface all adapters must implement)
- **IAM policy**: `src/iam/permissions.ts` (defines RBAC rules)
- **Events**: `src/events/vast-event-subscriber.ts` (Kafka consumer lifecycle)
