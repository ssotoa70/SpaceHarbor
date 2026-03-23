# Logical Architecture

High-level component view of SpaceHarbor. Shows all runtime services, the VAST platform services they depend on, and the DataEngine function containers that execute media processing pipelines. The Media Worker is dev-only and is not deployed against a production VAST cluster.

```mermaid
graph TD
    subgraph Client["Client Layer"]
        WebUI["Web UI\nReact / Vite"]
        DCC["DCC Plugins\nMaya · Nuke · Houdini\n(optional)"]
    end

    subgraph ControlPlane["Control Plane  —  Fastify / Node.js"]
        RestAPI["REST API\n55+ route files"]
        WorkflowEngine["Workflow Engine\nState machine · Approval · DLQ"]
        VastEventSubscriber["VastEventSubscriber\nKafka consumer\n(completion events)"]
        PersistenceAdapters["Persistence Adapters\nVastPersistenceAdapter · LocalAdapter"]
        FunctionRegistry["DataEngine Function Registry\nExrInspectorFunction · OiioProxyFunction"]
    end

    subgraph MediaWorker["Media Worker  —  Python  [Dev-only simulation]"]
        Scanner["ScannerFunction\npath_parser · .ready sentinel"]
        DevSim["Mock trigger loop\nSimulates VAST element events locally"]
    end

    subgraph VASTplatform["VAST Platform"]
        VastDB["VAST Database\nTrino REST API :8443\nSQL persistence"]
        VastCatalog["VAST Catalog\nIndexed columns\ntag_* · mtime · element_type"]
        EventBroker["VAST Event Broker\nKafka-compatible :9092\nSASL/PLAIN auth"]
        S3["VAST Element Store\nS3 · NFS · SMB\nPresigned URLs · Tagging"]

        subgraph DataEngine["VAST DataEngine  —  Serverless containers"]
            ExrInspector["exr-inspector\nEXR technical metadata"]
            OiioProxy["oiio-proxy-generator\nProxy + thumbnail"]
            FfmpegTranscoder["ffmpeg-transcoder\nDelivery formats"]
            OtioParser["otio-parser\nTimeline parsing"]
            MtlxParser["mtlx-parser\nMaterialX parsing"]
            ProvenanceRecorder["provenance-recorder\nAudit lineage"]
            StorageMetrics["storage-metrics-collector\nCapacity metrics"]
        end
    end

    WebUI -->|REST + WebSocket| RestAPI
    DCC -->|REST| RestAPI

    RestAPI --> WorkflowEngine
    WorkflowEngine --> PersistenceAdapters
    WorkflowEngine --> FunctionRegistry
    FunctionRegistry -->|"POST /api/v1/functions/{id}/invoke"| DataEngine

    VastEventSubscriber -->|Kafka consumer| EventBroker
    VastEventSubscriber --> WorkflowEngine

    PersistenceAdapters -->|Trino REST| VastDB
    PersistenceAdapters -->|SQL via Trino| VastCatalog
    RestAPI -->|S3 presigned URLs| S3

    S3 -->|Element trigger on *.exr *.mov *.dpx| DataEngine
    DataEngine -->|Results written to VastDB| VastDB
    DataEngine -->|Completion CloudEvents| EventBroker

    MediaWorker -.->|"Dev: simulates element trigger"| RestAPI
    MediaWorker -.->|"Dev: POST /api/v1/events"| RestAPI

    style MediaWorker fill:#fffbe6,stroke:#d4a017,stroke-dasharray: 5 5
    style MediaWorker color:#333
    style DataEngine fill:#e8f4fd,stroke:#2980b9
    style VASTplatform fill:#f0f8ff,stroke:#2c3e50
    style ControlPlane fill:#f9f9f9,stroke:#555
    style Client fill:#f0fff0,stroke:#27ae60
```
