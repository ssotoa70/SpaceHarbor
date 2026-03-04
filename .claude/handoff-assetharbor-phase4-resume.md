# AssetHarbor Phase 4 — Session Handoff
**Date:** March 4, 2026
**Branch:** `phase-4-production-integration` (also active: `phase-3-feature-development`)
**Project:** `/Users/sergio.soto/Development/ai-apps/code/AssetHarbor`

---

## ⚠️ CRITICAL: Read Before Writing Any Code

AssetHarbor is **VAST-native**. VAST platform handles all processing:

| VAST Service | Role |
|---|---|
| **VAST DataEngine** | Serverless function execution (exr_inspector, ASR, transcode…). Triggered by element events (file CRUD on VAST views) on Kubernetes. |
| **VAST Database (VastDB/Trino)** | All persistence via Trino REST API |
| **VAST Event Broker** | Kafka-compatible. Confluent Kafka Python 2.4–2.8. DataEngine publishes completion CloudEvents. |

**`services/media-worker/` = DEV SIMULATION ONLY. Not production.**
**Always use `mcp__vast-rag__search_docs` before assuming anything about VAST APIs.**

---

## Correct Processing Flow

```
Artist → Web UI → POST /ingest
  → Asset record in VastDB
  → File placed in VAST view
  → VAST element trigger fires (ElementCreated on *.exr etc.)
  → VAST DataEngine runs pipeline (exr_inspector, ASR, transcode…)
  → Results written to VastDB
  → VAST Event Broker publishes CloudEvent to Kafka topic
  → Control-plane VastEventSubscriber (Kafka consumer) receives event
  → Updates job status + asset metadata in VastDB
  → Web UI approval queue updated
```

Dev mode (no VAST cluster): media-worker simulates trigger+pipeline, posts mock CloudEvent to `POST /api/v1/events/vast-dataengine`.

---

## Completed (March 3-4, 2026)

- **SERGIO-129** ✅ TypeScript compilation errors (commit `888ab20`)
- **SERGIO-130** ✅ VastDbAdapter + TrinoClient (commit `d2e578a`)
- **Architecture correction** ✅ — media-worker is dev-only, VAST-native model documented
- **All docs updated** ✅ — design doc, phase design, specialist validation, VAST_NATIVE_ARCHITECTURE.md
- **SERGIO-131 design** ✅ — `docs/plans/2026-03-04-sergio-131-design.md`
- **SERGIO-131 implementation plan** ✅ — `docs/plans/2026-03-04-sergio-131-implementation.md`

---

## NEXT ACTION: Execute SERGIO-131 Implementation Plan

**Implementation plan:** `docs/plans/2026-03-04-sergio-131-implementation.md`

Use `superpowers:executing-plans` skill to implement task-by-task.

### 7 Tasks to implement (all TDD):

| # | Task | Key deliverable |
|---|---|---|
| 1 | Event types | `VastDataEngineCompletionEvent` type + normalizer in `src/events/types.ts` |
| 2 | sourceUri on WorkflowJob | Add `sourceUri` to domain model + claim response |
| 3 | VastEventSubscriber | `src/events/vast-event-subscriber.ts` — Kafka consumer |
| 4 | App lifecycle wiring | Register subscriber in `app.ts` `onReady` hook |
| 5 | Media worker dev mode | Mock CloudEvent publishing in `worker/main.py` |
| 6 | `/api/v1/events/vast-dataengine` | HTTP route for dev simulation |
| 7 | Full suite validation | All tests green, 0 TS errors |

### How to start the new session:

```bash
# 1. Navigate to project
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor

# 2. Verify build health
cd services/control-plane && npx tsc --noEmit

# 3. Read the implementation plan
cat docs/plans/2026-03-04-sergio-131-implementation.md

# 4. Install kafkajs (Task 3 dependency)
cd services/control-plane && npm install kafkajs

# 5. Invoke executing-plans skill and implement
```

---

## Build State (end of March 4 session)

```
TypeScript:   0 errors
TrinoClient:  8/8 tests passing
VastAdapter:  9/9 tests passing
Branch:       phase-3-feature-development (latest commits)
```

---

## Linear Board

**URL:** https://linear.app/dev-ss/project/assetharbor-mvp-scrum-board-3f804bce058c

| Ticket | Title | Status |
|---|---|---|
| SERGIO-129 | Fix TS compilation errors | ✅ DONE |
| SERGIO-130 | VastDbAdapter Trino REST | ✅ DONE |
| SERGIO-131 | VastEventSubscriber (Event Broker) | 🔄 PLAN READY — implement next |
| SERGIO-132 | Web UI AppShell layout | 📋 BACKLOG |
| SERGIO-120 | Strongly type VFX metadata | 🔄 IN PROGRESS |

**Update SERGIO-131 in Linear after implementing** — change description to reflect Event Broker Subscriber architecture.

---

## Key File Locations

```
docs/plans/2026-03-04-sergio-131-design.md          ← corrected design
docs/plans/2026-03-04-sergio-131-implementation.md  ← TDD plan to execute
docs/VAST_NATIVE_ARCHITECTURE.md                    ← correct VAST-native arch reference

services/control-plane/src/
  events/types.ts          ← add VastDataEngineCompletionEvent here (Task 1)
  events/processor.ts      ← existing processAssetEvent() — reuse in subscriber
  events/vast-event-subscriber.ts  ← CREATE in Task 3
  routes/vast-events.ts    ← CREATE in Task 6
  app.ts                   ← wire subscriber in Task 4
  domain/models.ts         ← add sourceUri to WorkflowJob in Task 2
  data-engine/pipeline.ts  ← existing DataEnginePipeline (no changes needed for MVP)

services/media-worker/worker/
  main.py       ← update for dev simulation in Task 5
  client.py     ← add post_dataengine_completion() in Task 5
  data_engine.py  ← add DEV SIMULATION header in Task 5
```
