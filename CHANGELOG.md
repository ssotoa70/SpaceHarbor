# Changelog

All notable changes to SpaceHarbor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CodeQL security scanning workflow (weekly + PR/push)
- Dependabot configuration for npm, pip, and GitHub Actions
- OpenAPI schema linting via Spectral in CI
- Slack failure notification on nightly smoke test

### Changed
- Nightly smoke readiness timeout increased from 60s to 120s
- Removed `continue-on-error` from DataEngine function CI steps (oiio, mtlx, otio now fail-fast)
- Added system dependency install step for DataEngine functions in CI

## [0.2.0] - 2026-03-11

### Added
- **Phase 3 — UI Overhaul** (SERGIO-172 through SERGIO-179)
  - Design system: Tailwind CSS 4, Radix UI primitives, dark/light theme with `--ah-*` CSS custom properties
  - Asset Browser: gallery/list/compact views, ThumbnailCard with hover-to-play, MediaPreview modal, FilterBar, pagination, multi-select bulk actions
  - Hierarchy Browser: recursive TreeView (Project > Sequence > Shot > Version), DetailPanel, keyboard navigation, version timeline strip
  - Timeline visualization: horizontal track lanes, proportional clip blocks, conform status coloring, zoom controls, minimap, frame ruler, playhead, ClipPopover
  - SSE real-time updates: backend `GET /events/stream` endpoint, `useEventStream` hook with exponential backoff reconnection, ConnectionIndicator
  - Review Session: split layout video player with frame stepping, approval queue, approve/reject actions, bulk approve
  - Material Browser: material grid with preview swatches, version selector, look variant cards, texture dependency tree, "Where Used?" panel
- **Phase 8 — Identity, Roles & Entitlements** (SERGIO-97 through SERGIO-107)
  - IAM module with JWT bearer, API key, service token, and anonymous auth strategies
  - 9 hierarchical roles (vendor_external through admin)
  - 40+ canonical permissions across 11 action domains
  - Feature flags (all default OFF) with shadow mode before enforcement
  - Rollout rings: internal > pilot > expand > general with KPI-based go/no-go gates
- Strongly-typed VFX metadata parser (SERGIO-120)
- Asset list pagination, status filter, and search (SERGIO-155)
- DLQ automation endpoints and configurable max retries (SERGIO-124)
- Background lease reaping for stuck jobs (SERGIO-123)
- CAS load tests for concurrent job claiming (SERGIO-125)
- Webhook config documentation and env vars (SERGIO-157)

### Changed
- Media-worker gated behind dev profile (SERGIO-156)
- Bounded `processedEventIds` eviction via LRU strategy (SERGIO-158)
- Audit logs moved to PersistenceAdapter layer

### Fixed
- Return 404 for unknown DCC job IDs; DCC routes marked deprecated
- EXR inspector mock data consolidated to single source of truth

## [0.1.0] - 2026-03-10

### Added
- **Phase 1 — VAST Trino Persistence**
  - Shared Trino REST client with `nextUri` polling and Basic auth
  - CLI database installer with dry-run and version gating
  - `VastPersistenceAdapter` with full Trino SQL read/write operations
  - Trino integration test harness
- **Phase 2 — ASWF Media Pipeline**
  - EXR metadata extraction via `oiiotool`
  - MaterialX domain models, persistence layer, migration, and sub-resource REST endpoints
  - Real MaterialX parsing with `materialx` library
  - OTIO timeline routes and conform logic
  - OTIO parser DataEngine function
  - OpenAssetIO resolver queries control-plane API
  - DataEngine function completion event publishing
  - OCIO color management (LogC/ACEScg to sRGB/Rec.709)
- **Phases 3-7 — Core Platform**
  - Security, metrics, and strict VAST mode
  - OpenAPI contract generation and route schemas
  - VAST parity for event lifecycle, fallback observability signals
  - Workflow transition guards, replay safety controls, out-of-order event rejection
  - Operator UX: metrics data model, degraded health strip, fallback timeline
  - Reliability smoke harness and nightly CI workflow
  - Release governance and runbook templates
  - Incident coordination API with conflict checks
  - Review QC lifecycle states and gate actions
  - Webhook outbound integrations via outbox
  - Audit log retention (90-day automated)
- PR guardrails CI check (stale and oversized PRs)
- CONTRIBUTING.md with branch naming, commit conventions, PR workflow
- `.env.example` with all environment variables documented

### Changed
- Replaced `kafkajs` with `@confluentinc/kafka-javascript` behind `KafkaClient` interface

### Fixed
- Scanner-function handler signature and Trino Basic auth
- Docker-compose openassetio port 3000 to 8080
- CI-compatible control-plane test glob

[Unreleased]: https://github.com/ssotoa70/spaceharbor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ssotoa70/spaceharbor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ssotoa70/spaceharbor/releases/tag/v0.1.0
