# Data and Query Flow

Shows the persistence layer topology: the Trino REST API client, the two adapter implementations (VastPersistenceAdapter for production and LocalAdapter for tests/dev), VAST Catalog queries using the correct indexed-column schema, and the migration system that governs the authoritative 30+ table schema.

```mermaid
graph TD
    subgraph ControlPlane["Control Plane"]
        Routes["Routes\nassets · jobs · queue\napproval · audit · vfx-hierarchy"]
        WorkflowEngine["Workflow Engine\nstate transitions · DLQ · outbox"]
        PersistenceInterface["PersistenceAdapter interface\n(async-first contract)"]
    end

    subgraph Adapters["Persistence Adapters"]
        VastAdapter["VastPersistenceAdapter\nProduction\n(VastWorkflowClient wired in factory.ts)"]
        LocalAdapter["LocalAdapter\nDev / tests\n(in-memory Maps)"]
    end

    subgraph TrinoClient["TrinoClient\n(custom implementation — no external npm package)"]
        TrinoREST["Trino REST API\nPOST /v1/statement\nPoll until FINISHED"]
        Auth["HTTP Basic Auth\nVAST API token"]
    end

    subgraph VastDB["VAST Database  —  Trino endpoint :8443"]
        Migrations["Migration system\n14 migrations\n30+ tables"]
        CoreTables["Core tables\nassets · workflow_jobs · approvals\noutbox · processed_events · dlq"]
        VfxTables["VFX hierarchy tables\nprojects · sequences · shots · versions"]
        AuditTable["Audit table\naudit_logs (90-day retention)"]
    end

    subgraph CatalogLayer["VAST Catalog  —  Trino SQL (same endpoint)"]
        CatalogQueries["vast-catalog.ts\nSELECT CONCAT(parent_path,'/',name)\nmtime · element_type · tag_* columns"]
        SearchPath["search_path resolver\nelement handle → file location"]
    end

    Routes --> WorkflowEngine
    WorkflowEngine --> PersistenceInterface
    PersistenceInterface --> VastAdapter
    PersistenceInterface --> LocalAdapter

    VastAdapter --> TrinoClient
    TrinoClient --> TrinoREST
    TrinoREST --> Auth
    Auth -->|"HTTPS :8443"| VastDB
    Auth -->|"HTTPS :8443"| CatalogLayer

    VastDB --> Migrations
    Migrations --> CoreTables
    Migrations --> VfxTables
    Migrations --> AuditTable

    CatalogLayer --> CatalogQueries
    CatalogQueries --> SearchPath

    SearchPath -->|"element handle"| CoreTables

    note1["Note: LocalAdapter is the test/dev fallback.\nVastWorkflowClient must be wired in factory.ts\nfor workflow ops to persist in VAST mode.\n(Gap 1 — fixed in Phase 0.1)"]

    style note1 fill:#fffbe6,stroke:#d4a017,color:#333
    style LocalAdapter fill:#fffbe6,stroke:#d4a017,stroke-dasharray: 4 4
    style VastDB fill:#f0f8ff,stroke:#2c3e50
    style CatalogLayer fill:#e8f4fd,stroke:#2980b9
    style TrinoClient fill:#f9f9f9,stroke:#555
```
