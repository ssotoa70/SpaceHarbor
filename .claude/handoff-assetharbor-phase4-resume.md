# AssetHarbor Phase 4 — Session Handoff
**Date:** March 4, 2026
**Branch:** `phase-4-production-integration`
**Worktree:** `~/.config/superpowers/worktrees/AssetHarbor/phase-4-production-integration`

---

## ⚠️ CRITICAL: Read Before Writing Any Code

AssetHarbor is a **VAST-native MAM**. All media processing is handled by the VAST platform — do NOT build custom processing pipelines.

| VAST Service | Role |
|---|---|
| **VAST DataEngine** | Serverless function execution (exr_inspector, ASR, transcode, etc.) Triggered by element events on VAST views OR HTTP. Functions are containerized Python on Kubernetes. |
| **VAST Database (VastDB/Trino)** | All persistence via Trino REST API |
| **VAST Event Broker** | Kafka-compatible (Confluent Kafka Python 2.4–2.8). DataEngine publishes completion events. |

**`services/media-worker/` is DEV-MODE SIMULATION ONLY.** Not the production path.
**`worker/data_engine.py` and `worker/exrinspector.py` are local mocks only.**

Always use `mcp__vast-rag__search_docs` before making assumptions about VAST APIs.

---

## Correct Processing Flow (validated vs VAST docs)

```
Artist → Web UI → Control-plane POST /ingest
  → Asset record in VastDB
  → File placed in VAST view (S3 path)
  → VAST element trigger fires (ElementCreated on *.exr / *.mov / audio)
  → VAST DataEngine runs registered pipeline
  → Results written to VastDB by DataEngine function
  → VAST Event Broker publishes CloudEvent to completion topic
  → Control-plane Kafka consumer receives event
  → Updates AssetHarbor job status
  → Web UI updates approval queue
```

**Dual execution modes (configurable):**
- **Mode A (event-driven)**: element trigger → Kafka → DataEngine (default VAST-native)
- **Mode B (HTTP server)**: control-plane calls VAST DataEngine HTTP endpoint directly

---

## Completed This Session (March 4, 2026)

### SERGIO-129 ✅ — TypeScript compilation errors (commit `888ab20`)
### SERGIO-130 ✅ — VastDbAdapter Trino integration (commit `d2e578a`)
- `src/persistence/vast/trino-client.ts` — 8 tests passing
- `src/persistence/vast/workflow-client-impl.ts` — full Trino SQL implementation

### Architecture Correction ✅ (this session)
- Identified media-worker is redundant in production VAST environment
- Validated VAST DataEngine event-driven model vs VAST docs
- Updated MEMORY.md with correct VAST-native architecture
- Docs-knowledge-steward launched to update all planning docs (in progress)
- Design doc at `docs/plans/2026-03-04-sergio-131-design.md` being rewritten

---

## Current Build State

```
TypeScript:   0 errors (npx tsc --noEmit)
TrinoClient:  8/8 tests passing
VastAdapter:  9/9 tests passing
Branch:       phase-4-production-integration (2 commits ahead of main)
```

Resume command:
```bash
cd /Users/sergio.soto/Development/ai-apps/code/AssetHarbor
# OR if worktree exists:
cd ~/.config/superpowers/worktrees/AssetHarbor/phase-4-production-integration
cd services/control-plane && npx tsc --noEmit
```

---

## SERGIO-131 — Redesigned (IN PROGRESS, not started)

**New scope** (corrected from original):

### What to build:
1. **Event Broker subscriber module** in control-plane (`src/events/vast-event-subscriber.ts`)
   - Kafka consumer using `kafkajs` or `node-rdkafka`
   - Subscribes to VAST Event Broker completion topic
   - Correlates CloudEvents back to AssetHarbor job records
   - Updates job status in VastDB on completion/failure

2. **DataEnginePipeline dual-mode execution** — already partially exists in `src/data-engine/`
   - Mode A: publish CloudEvent to VAST Event Broker topic (trigger DataEngine)
   - Mode B: HTTP call to VAST DataEngine HTTP server function
   - Configured via `VAST_EXECUTION_MODE` env var (`event-driven` | `http`)

3. **Dev-mode simulation** — update `services/media-worker/` to simulate VAST trigger loop locally
   - When `VAST_DATA_ENGINE_URL` and `VAST_EVENT_BROKER_URL` are not set, fall back to local simulation
   - Keeps dev workflow working without a VAST cluster

4. **`sourceUri` in claim response** — still needed for dev-mode simulation

### Design doc:
`docs/plans/2026-03-04-sergio-131-design.md` — being rewritten by docs-knowledge-steward

### Implementation plan:
NOT YET WRITTEN — invoke `superpowers:writing-plans` skill after design doc is finalized

---

## Next Steps (in order)

1. ✅ Wait for docs-knowledge-steward to finish updating docs
2. Review updated `docs/plans/2026-03-04-sergio-131-design.md`
3. Invoke `superpowers:writing-plans` to create TDD implementation plan for SERGIO-131
4. Update Linear board: SERGIO-131 description, add sub-tasks
5. Implement SERGIO-131 (Event Broker subscriber + dual-mode DataEngine)
6. SERGIO-132 — Web UI AppShell layout
7. SERGIO-120 — Strongly type VFX metadata (In Progress)

---

## Key Files

```
services/control-plane/src/
  data-engine/           ← DataEnginePipeline + FunctionRegistry + ExrInspectorFunction
  events/processor.ts    ← existing event processor (extend for Kafka subscriber)
  app.ts                 ← register Event Broker subscriber on startup
  persistence/vast/      ← TrinoClient + VastWorkflowClientImpl

services/media-worker/   ← DEV SIMULATION ONLY
  worker/main.py         ← poll/claim loop (dev mode)
  worker/data_engine.py  ← local mock pipeline (dev mode)
  worker/exrinspector.py ← local mock EXR inspector (dev mode)

docs/plans/
  2026-03-02-assetharbor-phase1-2-3-design.md  ← main design doc
  2026-03-04-sergio-131-design.md              ← SERGIO-131 corrected design
```

---

## Linear Board

**URL:** https://linear.app/dev-ss/project/assetharbor-mvp-scrum-board-3f804bce058c

| Ticket | Title | Status |
|---|---|---|
| SERGIO-129 | Fix TS compilation errors | ✅ DONE |
| SERGIO-130 | VastDbAdapter Trino REST | ✅ DONE |
| SERGIO-131 | Wire Data Engine (Event Broker subscriber) | 🔄 REDESIGNING |
| SERGIO-132 | Web UI AppShell layout | 📋 BACKLOG |
| SERGIO-120 | Strongly type VFX metadata | 🔄 IN PROGRESS |
| SERGIO-123 | Background heartbeat task | 📋 BACKLOG (may be superseded) |
| SERGIO-115 | LocalAdapter async refactor | 📋 BACKLOG |
| SERGIO-117 | Kafka event broker | 📋 BACKLOG (covered by SERGIO-131 redesign) |

---

## How to Resume

```bash
# 1. Load this file
cat /Users/sergio.soto/Development/ai-apps/code/AssetHarbor/.claude/handoff-assetharbor-phase4-resume.md

# 2. Verify build health
cd services/control-plane && npx tsc --noEmit

# 3. Check Linear board for current task state
# https://linear.app/dev-ss/project/assetharbor-mvp-scrum-board-3f804bce058c

# 4. Read the corrected SERGIO-131 design doc
cat docs/plans/2026-03-04-sergio-131-design.md

# 5. Next action: invoke superpowers:writing-plans to create implementation plan
```
