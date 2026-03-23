# Ingest Pipeline

End-to-end sequence for a media ingest. In production VAST environments the ScannerFunction is a VAST DataEngine container that detects `.ready` sentinel files and calls the control plane. The VAST element trigger then fires DataEngine processing functions automatically. In dev/local mode the Media Worker simulates both the scanner and the element trigger.

Function chaining (scanner → exr-inspector → oiio-proxy-generator for EXR, or scanner → ffmpeg-transcoder for video) is orchestrated by the control-plane `ChainOrchestrator`. See [ADR-006](../adr/006-control-plane-function-chaining.md) for rationale.

```mermaid
sequenceDiagram
    actor Artist
    participant S3 as VAST Element Store (S3)
    participant Scanner as ScannerFunction<br/>(DataEngine container)
    participant CP as Control Plane
    participant Orch as ChainOrchestrator<br/>(inside CP)
    participant VastDB as VAST Database
    participant DE as VAST DataEngine
    participant EB as VAST Event Broker (Kafka)
    participant Sub as VastEventSubscriber<br/>(Kafka consumer in CP)
    participant WebUI as Web UI

    note over Scanner,CP: In dev mode, Media Worker simulates Scanner + element trigger.

    Artist->>S3: Upload render sequence (*.exr frames)
    Artist->>S3: Write sequence.ready sentinel file

    S3-->>Scanner: Element trigger fires on *.ready
    Scanner->>Scanner: path_parser: detect sentinel,<br/>resolve render directory as single asset
    Scanner->>CP: POST /api/v1/assets/ingest<br/>{title, sourceUri: s3://bucket/seq/}
    CP->>VastDB: INSERT INTO assets (id, element_handle, status='ingest')
    CP->>VastDB: INSERT INTO workflow_jobs (id, asset_id, status='pending')
    CP-->>Scanner: 201 {asset, job}

    Scanner->>EB: Publish scanner completion CloudEvent<br/>{function_id: "scanner", file_extension: "exr", ...}

    EB-->>Sub: Consumer receives scanner completion
    Sub->>Sub: processVastFunctionCompletion("scanner")
    Sub->>Orch: triggerNext(scannerEvent)
    note over Orch: Resolves branch: file_extension="exr" → exr_inspector
    Orch->>EB: Publish CloudEvent<br/>{function_id: "exr_inspector", previousResult: {scannerMetadata}}

    EB-->>DE: DataEngine picks up exr_inspector trigger
    DE->>DE: exr-inspector: extract EXR technical metadata<br/>(frame_range, display_window, compression, md5)
    DE->>EB: Publish exr_inspector completion CloudEvent

    EB-->>Sub: Consumer receives exr_inspector completion
    Sub->>VastDB: Update asset VFX metadata
    Sub->>Orch: triggerNext(exrInspectorEvent)
    note over Orch: Chain: exr_inspector → oiio_proxy_generator
    Orch->>EB: Publish CloudEvent<br/>{function_id: "oiio_proxy_generator", previousResult: {exrMetadata}}

    EB-->>DE: DataEngine picks up oiio_proxy_generator trigger
    DE->>DE: oiio-proxy-generator: create proxy + thumbnail
    DE->>EB: Publish oiio_proxy_generator completion CloudEvent

    EB-->>Sub: Consumer receives oiio_proxy_generator completion
    Sub->>VastDB: Update asset proxy URLs
    Sub->>Orch: triggerNext(proxyEvent)
    note over Orch: No chain entry for oiio_proxy_generator — chain complete

    Sub->>VastDB: UPDATE workflow_jobs SET status='completed'
    Sub->>CP: Trigger approval workflow state transition
    CP->>EB: Publish asset.ready_for_review event

    WebUI-->>Artist: Asset appears in approval queue
    note over WebUI: Reviewer opens ApprovalPanel,<br/>inspects proxy + metadata.

    Artist->>CP: POST /api/v1/assets/:id/approve
    CP->>VastDB: UPDATE assets SET approval_status='approved'
    CP->>EB: Publish asset.approved event
    WebUI-->>Artist: Asset marked approved
```

## Video ingest chain (alternative branch)

When the scanner detects a `.mov` or `.mp4` file, `ChainOrchestrator` routes to `ffmpeg_transcoder` instead of `exr_inspector`:

```
scanner (file_extension: mov/mp4) → ffmpeg_transcoder
```

## Post-processing chains

```
mtlx_parser → dependency_graph_builder
otio_parser  → timeline_conformer
```

These chains are triggered independently when a MaterialX or OTIO file is ingested. The same chaining mechanism applies: `VastEventSubscriber` calls `ChainOrchestrator.triggerNext()` after each function completes.
