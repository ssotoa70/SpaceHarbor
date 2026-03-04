# SERGIO-131 Design: Event Broker Subscriber — Wiring VAST DataEngine into AssetHarbor

**Date:** March 4, 2026
**Ticket:** SERGIO-131
**Branch:** `phase-4-production-integration`
**Status:** Approved
**Last Updated:** 2026-03-04 — Architecture correction: VAST-native processing model

---

## Context & Correction

Previous design iterations incorrectly assumed a Python media worker would execute pipeline functions. This has been corrected and validated against VAST documentation.

**AssetHarbor is VAST-native.** All media processing (EXR inspection, ASR transcription, transcoding, QC validation, etc.) is handled by **VAST DataEngine** — a serverless compute platform running containerized functions on Kubernetes, co-located with VAST storage.

**The `services/media-worker/` process is dev-mode simulation only.** It is not used in production VAST environments.

---

## VAST Platform Foundation (Validated vs VAST 5.4 Docs)

| VAST Service | Role | AssetHarbor integration |
|---|---|---|
| **VAST DataEngine** | Serverless function execution. Functions are containerized Python images on Kubernetes. Triggered via element events or schedule. | Functions registered in AssetHarbor's `DataEnginePipeline` registry mirror what's deployed on VAST. |
| **VAST Database (VastDB/Trino)** | All persistent state | `VastDbAdapter` via Trino REST API |
| **VAST Event Broker** | Kafka-compatible (Confluent Kafka Python 2.4–2.8). Producer/Consumer API, consumer groups, SSL. | Control-plane subscribes as Kafka consumer for DataEngine completion events. |

**Key VAST DataEngine facts (from docs):**
- Element triggers fire on `ElementCreated`, `ElementDeleted`, `ElementTagCreated`, `ElementTagDeleted` in a VAST view
- Triggers can be scoped by S3 object key prefix/suffix (e.g., `*.exr`, `renders/*`)
- Functions are containerized images stored in an external container registry, deployed on Kubernetes
- Pipelines: Trigger → Function → Function → … (chained)
- Functions can invoke other functions (multi-stage pipelines)

---

## Architecture

### Production Flow (VAST Environment)

```
Artist/Operator
    ↓
Web UI → POST /api/v1/assets/ingest
    ↓
Control-plane creates asset record in VastDB
    ↓ places file reference in VAST view (S3 path)
VAST element trigger fires automatically
    (ElementCreated on *.exr / *.mov / *.wav etc.)
    ↓
VAST DataEngine runs registered pipeline
    (exr_inspector, ASR, transcode, QC — whatever is deployed)
    ↓
Function has direct VAST storage access
Function writes results to VastDB
    ↓
VAST Event Broker publishes completion CloudEvent to Kafka topic
    (e.g. assetharbor.dataengine.completed)
    ↓
Control-plane Event Broker Subscriber (Kafka consumer) receives event
    ↓
Subscriber correlates event to AssetHarbor job record
Subscriber updates job status + asset metadata in VastDB
    ↓
Web UI approval queue updated — artist sees result
```

### Dev/Local Mode (No VAST Cluster)

```
media-worker (simulation only)
    ↓
Poll AssetHarbor job queue → claim job
    ↓
Run local mock DataEngine (worker/data_engine.py)
    ↓
Publish mock completion event to in-process event bus
    ↓
Control-plane Event Broker Subscriber receives mock event
    (same code path as production — only the Kafka broker differs)
```

---

## Dual Execution Modes

Configurable per deployment via env vars. The control-plane subscriber code path is identical in both modes — only the source of the Kafka events differs.

### Mode A — Event-Driven (Default, Production)

```
VAST_EXECUTION_MODE=event-driven
VAST_EVENT_BROKER_URL=vast.cluster.example.com:9092
VAST_EVENT_BROKER_TOPIC=assetharbor.dataengine.completed
```

- VAST element trigger fires on file ingest
- VAST DataEngine executes function on Kubernetes
- Result arrives via Kafka

### Mode B — HTTP Server Function (On-Demand)

```
VAST_EXECUTION_MODE=http
VAST_DATA_ENGINE_URL=https://vast.cluster.example.com/api/dataengine
VAST_API_KEY=<token>
```

- Control-plane calls VAST DataEngine HTTP endpoint directly
- Function still runs on VAST Kubernetes infrastructure
- Result returned synchronously (or via callback)
- `ExrInspectorFunction.execute()` delegates to this URL

### Mode C — Local Simulation (Dev Only)

```
# Neither VAST_EVENT_BROKER_URL nor VAST_DATA_ENGINE_URL set
# media-worker runs local mock pipeline
```

---

## Modularity

`exr_inspector` is just the first example function. The system is designed for any function a customer deploys on VAST DataEngine:

| Function | VAST DataEngine capability |
|---|---|
| `exr_inspector` | EXR technical metadata extraction |
| `asr_transcription` | Audio speech-to-text (ASR) |
| `transcode_proxy` | Video proxy generation |
| `qc_validation` | Technical QC checks |
| `thumbnail_gen` | Thumbnail extraction |
| `checksum` | Integrity verification |

AssetHarbor registers each function in `FunctionRegistry` with its input/output schema. The Event Broker subscriber handles completion events from any registered function identically.

---

## What SERGIO-131 Builds

### 1. Event Broker Subscriber Module (Control-Plane)

New file: `src/events/vast-event-subscriber.ts`

Responsibilities:
- Kafka consumer using `kafkajs` (or `node-rdkafka` if Confluent-specific features needed)
- Subscribe to VAST Event Broker completion topic
- Parse incoming CloudEvents from VAST DataEngine
- Correlate `asset_id` + `job_id` from event payload to AssetHarbor job records
- Call `persistence.updateAsset()` with extracted metadata
- Call `persistence.setJobStatus()` to mark job completed or failed
- Handle partial failures (function errors in event payload)

```typescript
// src/events/vast-event-subscriber.ts
export class VastEventSubscriber {
  constructor(
    private readonly persistence: PersistenceAdapter,
    private readonly brokerUrl: string,
    private readonly topic: string,
  ) {}

  async start(): Promise<void>      // Connect and begin consuming
  async stop(): Promise<void>       // Graceful disconnect

  private async handleEvent(event: DataEngineCompletionEvent): Promise<void>
}
```

Registered in `app.ts` `onReady` hook (alongside `auditRetention`).

### 2. DataEnginePipeline Dual-Mode Execution

Update `src/data-engine/` to support Mode A and Mode B:

- Mode A: `execute()` publishes a CloudEvent to VAST Event Broker (Kafka producer) and returns `{ accepted: true }` — result arrives asynchronously via subscriber
- Mode B: `execute()` calls `VAST_DATA_ENGINE_URL/execute` HTTP endpoint — result returned synchronously

Configured via `VAST_EXECUTION_MODE` env var.

### 3. Dev Simulation Update (`services/media-worker/`)

Update `worker/main.py` to:
- Check for `VAST_EVENT_BROKER_URL` env var — if absent, run local simulation mode
- After local mock pipeline runs, publish mock completion event to in-process mock broker
- Control-plane subscriber receives mock event (same code path)
- Clearly document: "This file runs in dev simulation mode only."

### 4. `sourceUri` in Claim Response (Dev Mode Only)

For dev simulation, the worker needs `sourceUri` from the claim response to locate the mock file. Add it to `WorkflowJob` domain model and include it in the `/api/v1/queue/claim` response.

In production, VAST element trigger already has the file path from the VAST view — no claim response needed.

---

## Error Semantics

| Scenario | Subscriber action |
|---|---|
| `event.success == true` | Update asset metadata + set job `completed` |
| `event.success == false`, retryable | Set job `failed`, call `handleJobFailure` (may requeue) |
| `event.success == false`, permanent | Set job `failed`, move to DLQ |
| Kafka consumer error | Log, retry connection with backoff, do not drop events |
| Event for unknown job | Log warning, discard (idempotency guard) |
| Duplicate event (same event_id) | Idempotency check via `hasProcessedEvent()`, discard |

---

## Out of Scope for SERGIO-131

- Real PyOpenEXR C bindings (VAST DataEngine handles this natively)
- Kafka TLS/SSL configuration (infrastructure concern, not AssetHarbor code)
- VAST element trigger configuration (done in VAST VMS by admin)
- SERGIO-120 (typed VFX metadata) — parallel ticket
- SERGIO-132 (Web UI AppShell) — separate ticket

---

## Files Changed

**Control-plane (new):**
- `src/events/vast-event-subscriber.ts` — Kafka consumer + event correlation logic
- `src/events/types.ts` — `DataEngineCompletionEvent` CloudEvent type
- `test/vast-event-subscriber.test.ts` — contract tests

**Control-plane (modified):**
- `src/app.ts` — register `VastEventSubscriber` in `onReady` hook
- `src/data-engine/pipeline.ts` — dual-mode execute (Mode A event publish / Mode B HTTP)
- `src/domain/models.ts` — add `sourceUri` to `WorkflowJob` (dev mode)
- `src/routes/queue.ts` — include `sourceUri` in claim response (dev mode)

**Media worker (modified):**
- `worker/main.py` — add env check for dev simulation mode, clear documentation
- `worker/data_engine.py` — add "DEV SIMULATION ONLY" header comment

**Tests:**
- `test/vast-event-subscriber.test.ts` — NEW: mock Kafka consumer, verify job correlation
- `test/data-engine-contract.test.ts` — update for dual-mode execute
- `tests/test_worker_flow.py` — update for dev simulation mode path

---

## Environment Variables

| Var | Purpose | Required |
|---|---|---|
| `VAST_EXECUTION_MODE` | `event-driven` \| `http` \| unset (dev) | No (defaults to dev sim) |
| `VAST_EVENT_BROKER_URL` | Kafka broker address for VAST Event Broker | Mode A |
| `VAST_EVENT_BROKER_TOPIC` | Topic for DataEngine completion events | Mode A |
| `VAST_EVENT_BROKER_GROUP` | Kafka consumer group ID | Mode A |
| `VAST_DATA_ENGINE_URL` | VAST DataEngine HTTP endpoint | Mode B |
| `VAST_API_KEY` | Auth token for VAST APIs | Mode A + B |
