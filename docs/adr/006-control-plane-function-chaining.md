# ADR-006: Control-plane orchestrated function chaining

**Status:** Accepted
**Date:** 2026-03-22

## Context

SpaceHarbor's ingest pipeline executes multiple VAST DataEngine functions in
sequence for a single asset. For example, EXR assets go through:

```
scanner → exr-inspector → oiio-proxy-generator
```

Video assets go through:

```
scanner → ffmpeg-transcoder
```

Post-processing chains for material and timeline data:

```
mtlx-parser → dependency-graph-builder
otio-parser → timeline-conformer
```

VAST DataEngine supports defining a pipeline of functions, but it does not
natively pass one function's output as an env var to the next function in the
chain. Each DataEngine function starts from scratch with only the env vars
configured at pipeline registration time. There is no built-in mechanism to
carry intermediate results forward.

## Decision

The control-plane owns function chaining via a `ChainOrchestrator` module.

When the `VastEventSubscriber` receives and processes a DataEngine completion
event, it calls `ChainOrchestrator.triggerNext()`. The orchestrator looks up the
completed `function_id` in a static chain config, determines the next function
(resolving media-type branches using `file_extension` from the completion
metadata), and publishes a new `vast.dataengine.pipeline.completed` CloudEvent
to the same VAST Event Broker topic.

The new event carries the prior function's metadata under `data.previousResult`.
When DataEngine executes the next container, it exposes this field as the
`PREVIOUS_RESULT` env var. Downstream functions check `PREVIOUS_RESULT` as a
fallback when their primary input env var (e.g. `MTLX_PARSE_RESULT`,
`OTIO_PARSE_RESULT`) is not set, enabling both standalone and chained execution.

The chain config is a static record in `chain-orchestrator.ts`:

```typescript
const CHAINS: Record<string, ChainEntry> = {
  scanner: {
    next: { exr: "exr_inspector", mov: "ffmpeg_transcoder", mp4: "ffmpeg_transcoder" },
  },
  exr_inspector: { next: "oiio_proxy_generator" },
  mtlx_parser:   { next: "dependency_graph_builder" },
  otio_parser:   { next: "timeline_conformer" },
};
```

Adding a new function to a chain requires adding one entry to this config.

## Consequences

**Benefits**

- Orchestration is fully observable. Chain transitions are logged with asset ID,
  source function, and target function. All intermediate CloudEvents flow through
  the existing Kafka topic and are auditable.
- Chain config is centralized and colocated with the subscriber that acts on it.
  No chain logic is scattered across DataEngine function containers.
- Downstream functions remain independently executable. The `PREVIOUS_RESULT`
  fallback preserves standalone execution for development and testing.
- Branching (scanner → exr-inspector vs. ffmpeg-transcoder) is resolved without
  custom orchestration logic per function — the `file_extension` field in the
  scanner's completion metadata drives the branch.
- Chain failures are isolated. An error in `triggerNext` is caught and logged;
  it does not cause the current function's completion event to be rejected or
  reprocessed.

**Trade-offs**

- Each chain step adds one Kafka round-trip of latency (publish to Event Broker,
  consume back in VastEventSubscriber, then publish next). For typical VFX
  pipelines this is acceptable (milliseconds), but multi-step chains on high
  volume ingest should be monitored.
- The `VastEventSubscriber` now also acts as a chain trigger, not just a state
  updater. This slightly broadens its responsibility. If chain orchestration
  grows significantly (conditional branching at multiple nodes, fan-out, retries)
  it should be extracted into its own subscriber or a dedicated orchestration
  service.
- The scanner function must include `file_extension` in its completion metadata
  for media-type branching to resolve. If this field is absent the chain logs a
  warning and stops rather than guessing. Scanner implementations must document
  this contract.
- `PREVIOUS_RESULT` carries the full prior function metadata payload as an env
  var. For large metadata objects or any outputs containing sensitive paths or
  hashes, this is a data-in-transit concern. DataEngine should be configured with
  appropriate access controls on container env vars in production.

## Alternatives Considered

**Direct HTTP invocation of next function's container.**
VAST DataEngine supports HTTP-mode function invocation. The orchestrator could
call the DataEngine API directly instead of publishing to Kafka. This was
rejected because it introduces a synchronous coupling (the subscriber blocks
waiting for DataEngine to accept the request), bypasses the existing event-driven
architecture, and makes chain transitions invisible to the audit log.

**Native DataEngine pipeline configuration.**
VAST DataEngine pipelines can chain functions internally, but without the ability
to pass prior output forward as env vars. This limitation is what motivates the
control-plane approach. If a future VAST platform version adds this capability,
the `ChainOrchestrator` can be retired without changing any consumer code.

**Separate chain orchestration service.**
A dedicated microservice could own the chain config and trigger logic. This was
deferred as over-engineering for the current scale. The `ChainOrchestrator` is
structured as a plain class; extracting it to a separate service later is a
straightforward refactor.
