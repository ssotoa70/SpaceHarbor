# AssetHarbor: VAST-Native Architecture Design

**Phase:** 2 - Production System
**Scope:** Greenfield design for Post-production/VFX Media Asset Management
**Date:** March 2, 2026

---

## Executive Summary

AssetHarbor Phase 2 is a **complete redesign** as a VAST-native system, not a conversion of the MVP. The system will be built from the ground up to leverage VAST's core capabilities:

- **VAST Database** - Primary persistence for all state
- **VAST Catalog** - "Inseparable context" metadata attached to Element handles
- **VAST Event Broker** - Event streaming and workflow triggers
- **VAST DataEngine** - Serverless media processing pipelines
- **VAST Element Store** - Native file/media storage

---

## Core Problem This Solves: "Broken Links"

Traditional MAMs suffer from **"broken links"** - metadata lives in a database, files live in storage, and they're coupled by fragile URL/UNC paths. When files move, metadata breaks.

**VAST's solution:** Metadata is keyed off immutable **Element handles**, not file paths. Metadata stays attached to files forever, regardless of movement, copying, or cloning.

```
Traditional MAM:
Asset Record: { id: 123, title: "shot_001", path: "\\nas\projects\film1\shot_001.mov" }
                                            ↑
                            Breaks if file is moved

VAST Catalog:
Asset Record: { id: 123, title: "shot_001", elementHandle: "elem_abc123xyz" }
                                                              ↑
                     Stays valid forever, file can move anywhere
```

---

## System Architecture

### Layer 1: Storage Layer (VAST Platform)

```
┌─────────────────────────────────────────────────────────────┐
│                    VAST Platform                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ Element Store    │  │ VAST Catalog     │               │
│  │ (S3/NFS/etc)     │  │ (Metadata Tables)│               │
│  │                  │  │                  │               │
│  │ • Files          │  │ • Asset metadata │               │
│  │ • Versions       │  │ • Technical info │               │
│  │ • Renditions     │  │ • Review notes   │               │
│  │ • Proxies        │  │ • Approvals      │               │
│  │                  │  │ • Custom fields  │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                             │
│  ┌──────────────────────┐      ┌─────────────────┐        │
│  │ VAST Database        │      │ Event Broker    │        │
│  │ (Trino, SQL)         │      │ (Kafka-compat)  │        │
│  │                      │      │                 │        │
│  │ • Job state          │      │ • Element events│        │
│  │ • Workflow state     │      │ • Completion    │        │
│  │ • Queue/DLQ          │      │ • Approvals     │        │
│  │ • Audit logs         │      │ • Status        │        │
│  └──────────────────────┘      └─────────────────┘        │
│                                                             │
│  ┌──────────────────────────────────────────┐             │
│  │ VAST DataEngine                          │             │
│  │ (Serverless Processing)                  │             │
│  │                                          │             │
│  │ • Probing (FFprobe)                      │             │
│  │ • Transcoding (multiple formats)         │             │
│  │ • Thumbnail generation                  │             │
│  │ • Proxy creation                         │             │
│  │ • QC validation                          │             │
│  └──────────────────────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Layer 2: Control-Plane (AssetHarbor Service)

```
┌─────────────────────────────────────────────────────────────┐
│              Control-Plane (Fastify/Node.js)               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ REST API Layer                                     │    │
│  │ • Asset management endpoints                       │    │
│  │ • Workflow/job endpoints                           │    │
│  │ • Approval workflow endpoints                      │    │
│  │ • Review/QC endpoints                              │    │
│  │ • Search/filter endpoints                          │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Workflow Engine                                    │    │
│  │ • State machine transitions                        │    │
│  │ • Event processing                                 │    │
│  │ • Approval workflows                               │    │
│  │ • Error recovery                                   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ VAST Adapters                                      │    │
│  │ • VAST Database (Trino REST API)                   │    │
│  │ • VAST Catalog (Metadata via SQL)                  │    │
│  │ • VAST Event Broker (Kafka client)                 │    │
│  │ • VAST DataEngine (Orchestration)                  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Services                                           │    │
│  │ • Asset ingestion                                  │    │
│  │ • Metadata management                              │    │
│  │ • Approval workflow                                │    │
│  │ • Audit/compliance                                 │    │
│  │ • Search/indexing                                  │    │
│  │ • Notifications                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         ↓ REST API             ↓ WebSocket Events
```

### Layer 3: Client Layer

```
┌────────────────────────────────────┐
│  Web UI (React/TypeScript)         │
│                                    │
│  • Asset browser                   │
│  • Upload interface                │
│  • Approval panel                  │
│  • Review/QC interface             │
│  • Search/filter                   │
│  • Reporting dashboard             │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  Desktop Integration (Optional)    │
│                                    │
│  • Maya plugin                     │
│  • Nuke plugin                     │
│  • Houdini plugin                  │
│  • Direct ingest from DCC          │
└────────────────────────────────────┘
```

---

## Data Model: VAST-Native

### Element Handles (Foundation)

```
Every media file in VAST Element Store gets an immutable handle:
  elem_abc123xyz → /projects/film1/shots/shot_001.mov
                 → /projects/film1/shots/shot_001_v2.mov (same handle if copied)
                 → /archive/film1/shot_001.mov (same handle if moved)

Metadata never references the path - only the handle.
```

### Asset Table (VAST Catalog)

```sql
CREATE TABLE assets (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  element_handle VARCHAR(100) UNIQUE,   -- VAST Element handle
  title VARCHAR(255),                   -- "Shot 001 - Master"
  description TEXT,

  -- Technical metadata (from VAST Catalog)
  media_type VARCHAR(20),               -- "video", "image", "audio"
  mime_type VARCHAR(100),               -- "video/quicktime"
  duration_ms BIGINT,                   -- Duration in milliseconds
  file_size_bytes BIGINT,
  resolution VARCHAR(20),               -- "1920x1080"
  frame_rate FLOAT,
  video_codec VARCHAR(50),
  color_space VARCHAR(50),

  -- Status
  status VARCHAR(20) DEFAULT 'ingest',  -- ingest → processing → approved → archive
  approval_status VARCHAR(20),          -- pending → approved → rejected → archived
  qc_status VARCHAR(20),                -- pending → passed → failed

  -- Tracking
  created_at TIMESTAMP DEFAULT now(),
  ingest_started_at TIMESTAMP,
  ingest_completed_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(100),

  -- Links
  thumbnail_element_handle VARCHAR(100),
  proxy_element_handle VARCHAR(100),
  metadata JSONB                        -- Custom fields
);
```

### Workflow/Job Table (VAST Database)

```sql
CREATE TABLE workflow_jobs (
  id VARCHAR(36) PRIMARY KEY,
  asset_id VARCHAR(36) NOT NULL,

  -- Workflow stage
  stage VARCHAR(50),                    -- "probe", "transcode_4k", "transcode_proxy", "qc", "approval"
  status VARCHAR(20),                   -- "pending", "processing", "completed", "failed"

  -- Processing
  processing_started_at TIMESTAMP,
  processing_completed_at TIMESTAMP,
  duration_seconds INT,

  -- VAST DataEngine
  dataengine_job_id VARCHAR(100),
  dataengine_status VARCHAR(50),

  -- Results
  output_element_handle VARCHAR(100),   -- Where output was written
  error_message TEXT,

  -- Metadata
  parameters JSONB,                     -- Job-specific params (codec, bitrate, etc)
  created_at TIMESTAMP DEFAULT now(),

  FOREIGN KEY (asset_id) REFERENCES assets(id)
);
```

### Approval/QC Table

```sql
CREATE TABLE approvals (
  id VARCHAR(36) PRIMARY KEY,
  asset_id VARCHAR(36) NOT NULL,

  reviewer_id VARCHAR(100),
  review_status VARCHAR(20),            -- "approved", "rejected", "revise_requested"
  review_notes TEXT,

  -- Feedback
  issues JSONB,                         -- [{ category: "color", severity: "major", note: "..." }]
  revision_requested_on JSONB,          -- [{ field: "codec", reason: "..." }]

  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),

  FOREIGN KEY (asset_id) REFERENCES assets(id)
);
```

---

## Event Flow: VAST Event Broker

```
1. File Uploaded to Element Store
   └─ VAST Event Broker: "element.created"
      └─ AssetHarbor: Receives event, creates Asset record

2. Asset Created
   └─ AssetHarbor: Publishes "asset.ingest.started"
   └─ VAST DataEngine: Receives event, starts probe job

3. Probe Completes (via VAST Element trigger)
   └─ VAST Event Broker: "dataengine.job.completed"
   └─ AssetHarbor: Receives, updates Asset metadata, queues transcode jobs

4. Transcoding Completes
   └─ VAST Event Broker: "dataengine.job.completed"
   └─ AssetHarbor: Creates output Element, updates Catalog

5. Awaiting Approval
   └─ AssetHarbor: Publishes "asset.ready_for_review"
   └─ UI: Displays asset in approval queue

6. Approved by Reviewer
   └─ AssetHarbor: Updates approval_status, publishes "asset.approved"
   └─ UI: Marks as approved, removes from review queue

7. Archival
   └─ AssetHarbor: Publishes "asset.archive"
   └─ VAST DataEngine: May compress, move to cold storage
```

---

## Implementation Strategy: TDD from Ground Up

### Phase 2A: Foundation Layer (Weeks 1-2)

**Epic 1: VAST Database Integration**
- Trino REST API client
- Asset table schema
- VAST Catalog metadata queries
- Test: Can store/retrieve assets via VAST DB

**Epic 2: Element Handle Binding**
- Map Element handles to Assets
- Handle → Asset lookup
- Asset → Handle reverse mapping
- Test: Element handle remains constant across file moves

**Epic 3: Basic Workflow State**
- Job table schema
- Job state machine
- Status transitions
- Test: Job lifecycle is persisted and queryable

### Phase 2B: Processing Layer (Weeks 2-3)

**Epic 4: VAST DataEngine Integration**
- DataEngine API client
- Job submission
- Job status polling
- Result retrieval
- Test: Can submit probe job and retrieve results

**Epic 5: Event Broker Integration**
- Kafka client (VAST Event Broker)
- Event publishing
- Event subscription
- Test: Can publish/consume events from Event Broker

**Epic 6: Workflow Orchestration**
- Multi-stage pipelines (probe → transcode → approval)
- Stage completion triggers next stage
- Error handling and retries
- Test: Complete workflow end-to-end

### Phase 2C: User Features (Weeks 3-4)

**Epic 7: Approval Workflow**
- Approval table schema
- Reviewer interface
- Approval state machine
- Notifications
- Test: Can submit for review, approve/reject, track state

**Epic 8: Search & Discovery**
- Full-text search on VAST Catalog
- Filter by metadata
- Saved searches
- Test: Can find assets by criteria

**Epic 9: Audit & Compliance**
- Audit events to Event Broker
- Compliance reports
- 90-day retention policy
- Test: Audit trail is complete and queryable

---

## Key Design Principles

### 1. **Element Handle is the Source of Truth**
- Never store file paths in Asset records
- All file references go through Element handles
- Metadata follows Element handles, not files

### 2. **Event-Driven Everything**
- All state changes publish events to VAST Event Broker
- External systems consume events via Kafka
- No polling, only event-driven updates
- Events are immutable audit trail

### 3. **VAST DataEngine Owns Media Processing**
- Control-plane orchestrates, DataEngine executes
- DataEngine is the "worker pool"
- No separate Python worker service needed
- Serverless scaling via VAST

### 4. **Eventual Consistency**
- Asset records are source of truth in VAST DB
- Metadata in VAST Catalog may lag slightly
- Event-driven sync ensures eventual consistency
- No blocking waits for external systems

### 5. **TDD at Every Layer**
- Write failing test first
- Implement minimum code to pass
- Refactor for clarity
- Every feature has accompanying test

---

## Critical Differences from MVP

| Aspect | MVP (Phase 1) | VAST-Native (Phase 2) |
|--------|---------------|----------------------|
| **Persistence** | In-memory Maps | VAST Database (Trino) |
| **Metadata** | Asset object fields | VAST Catalog tables + SQL |
| **File Reference** | String paths | Element handles |
| **Event Delivery** | HTTP POST (unreliable) | Kafka Event Broker (durable) |
| **Job Processing** | Python worker polls | VAST DataEngine serverless |
| **Scalability** | Single instance | Horizontal (VAST handles it) |
| **Data Consistency** | Immediate | Eventual (but auditable) |
| **Cost Model** | Unknown | Pay-per-processing (VAST) |

---

## Success Metrics for Phase 2

- ✅ All state persisted in VAST Database
- ✅ No data loss on restart
- ✅ All events published to Kafka Event Broker
- ✅ Multi-stage workflows end-to-end
- ✅ Approval workflow with audit trail
- ✅ 90-day compliance retention
- ✅ Full-text search on VAST Catalog
- ✅ Element handles remain constant across file moves
- ✅ 70%+ test coverage
- ✅ 0 critical issues in security audit

---

## Technical Requirements

### VAST Endpoints Needed

```
VAST_DATABASE_URL=https://vast.example.com/api/v1/trino
  → Trino REST API for SQL queries

VAST_CATALOG_URL=https://vast.example.com/api/v1/catalog
  → Metadata querying and updates

VAST_EVENT_BROKER_URL=https://vast.example.com/api/v1/kafka
  → Kafka-compatible producer/consumer

VAST_DATAENGINE_URL=https://vast.example.com/api/v1/dataengine
  → Job submission and monitoring

VAST_API_TOKEN=<auth-token>
  → Authentication for all VAST APIs
```

### Dependencies to Add

```
npm install --save
  @trino/trino          # Trino REST client
  kafkajs               # Kafka producer/consumer
  uuid                  # ID generation
  date-fns              # Date utilities
  joi                   # Validation
  pino                  # Structured logging
```

---

## Next Steps

1. **Design Review** - Validate this architecture with stakeholders
2. **VAST Configuration** - Ensure test VAST instance is available
3. **Phase 2A Kickoff** - Start Epic 1: VAST Database Integration
4. **TDD Framework** - Set up test structure for VAST integration
5. **Documentation** - Update API contracts for VAST-native design

---

## Confirmed Requirements

✅ **Element Store Type:** NFS, SMB, or S3 via VAST Element Store (consistent protocol handling)
✅ **DCC Integrations:** YES - Maya, Nuke, Houdini plugins required
✅ **Approval Workflow:** Single approval for now, extensible for multi-level in future
✅ **QC Validation:** Auto-checks enabled + optional manual review capability
✅ **Retention Policy:** 90 days after project finalization (adjustable), then archive
✅ **Scalability:** Support 10-200 concurrent users with linear performance degradation

---

**This is the correct architecture for AssetHarbor Phase 2: VAST-native, event-driven, element-handle-based, production-grade MAM for Post-production/VFX.**

Ready to implement? 🚀
