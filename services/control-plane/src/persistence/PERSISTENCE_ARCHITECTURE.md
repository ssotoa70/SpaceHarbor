# Persistence Layer Architecture

## Overview

The persistence layer provides an abstraction for asset and workflow storage with multiple implementation strategies:

- **LocalAdapter**: In-memory storage for tests
- **MockVastAdapter**: Deterministic mock data for feature development
- **VastDbAdapter**: Real VAST Database integration (planned)

All adapters implement a common interface ensuring compatibility and enabling seamless switching between implementations.

## Async Interface Design

The `AsyncPersistenceAdapter` interface defines all persistence operations as async (Promise-based), enabling:

1. **Real Database Calls**: VastDbAdapter can make actual I/O calls without blocking
2. **Mock Responses**: MockVastAdapter returns fixtures for testing without network overhead
3. **In-Memory Tests**: LocalAdapter provides fast unit test performance

## Contract Guarantees

Each adapter must implement these guarantees:

### Atomicity

Operations like `updateJobStatus()` must use compare-and-swap (CAS) semantics:

```typescript
// Only update if current status matches expected
const success = await adapter.updateJobStatus(
  jobId,
  'pending',    // expectedStatus
  'processing', // newStatus
  context
);
// Returns true if CAS succeeded, false if status didn't match
```

### Durability

Data persists across process restarts (except LocalAdapter, which is ephemeral).

### Consistency

No duplicate events via idempotency tracking:

```typescript
const hasProcessed = await adapter.hasProcessedEvent(eventId);
if (!hasProcessed) {
  await adapter.recordAsset(asset);
  await adapter.markProcessedEvent(eventId);
}
```

### Isolation

Concurrent operations don't interfere. Workers can safely claim jobs simultaneously:

```typescript
// Multiple workers try to claim same job
const results = await Promise.all([
  adapter.updateJobStatus(jobId, 'pending', 'claimed'),
  adapter.updateJobStatus(jobId, 'pending', 'claimed'),
  adapter.updateJobStatus(jobId, 'pending', 'claimed'),
]);
// Exactly one succeeds, others fail gracefully
```

## Usage Example

```typescript
import { createPersistenceAdapter } from './factory';

const adapter = createPersistenceAdapter('local');

// Create an asset and job
const { asset, job } = await adapter.createIngestAsset(
  { title: 'shot_001', sourceUri: 'file:///path/to/file.exr' },
  { correlationId: 'corr-123' }
);

// Get pending jobs
const pending = await adapter.getPendingJobs();

// Try to claim a job (CAS semantics)
const success = await adapter.updateJobStatus(
  job.id,
  'pending',
  'processing',
  { correlationId: 'corr-456' }
);

if (success) {
  console.log('Job claimed successfully');
}
```

## Implementation Strategy

### Phase 2 (Current)

- Define `AsyncPersistenceAdapter` interface
- Refactor `LocalAdapter` to async (for consistency)
- Implement `MockVastAdapter` for Team C feature development
- Add Kafka event broker

### Phase 3

- Implement `VastDbAdapter` for real VAST Database integration
- Switch production to use VastDbAdapter
- Remove MockVastAdapter (retire after Team C completes features)

## Adapter Selection

Via environment variables:

```bash
# Use local adapter (default, for tests)
ASSETHARBOR_PERSISTENCE_BACKEND=local

# Use VAST database (production)
ASSETHARBOR_PERSISTENCE_BACKEND=vast
VAST_DATABASE_URL=http://vast-database:8000
VAST_EVENT_BROKER_URL=http://event-broker:9092
```

## Testing

All adapters should pass contract tests to ensure feature parity:

```typescript
import { LocalAdapter } from './adapters/local-persistence';
import { MockVastAdapter } from './adapters/mock-vast-persistence';

describe('Persistence Adapter Contract', () => {
  for (const AdapterClass of [LocalAdapter, MockVastAdapter]) {
    test(`${AdapterClass.name} implements atomic job claiming`, async () => {
      const adapter = new AdapterClass();
      // CAS test
      const success = await adapter.updateJobStatus(...);
      expect(success).toBe(true);
    });
  }
});
```
