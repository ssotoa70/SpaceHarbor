# AssetHarbor Next-Step Execution Plan

**Date:** 2026-03-10
**Input:** Project Audit Report, Cleanup Output (PR #53), Multi-Agent Domain Reviews
**Validated by:** VAST Platform Engineer, Codebase Analysis, GitHub/Linear Alignment, Documentation/Governance agents

---

## Executive Summary

The audit and cleanup phase restored basic coherence (35 branches deleted, 9 Linear issues closed, dead code removed, branch protection enabled). Four domain agents reviewed the remaining gaps and converged on three independent work tracks that can execute in parallel. The VAST Platform Engineer validated the plan and identified three critical fixes that must precede any production VAST testing.

**Overall priority:** Stabilize foundations before building features. The remaining 8 backlog items should NOT begin until the technical debt items below are resolved, because they would compound on the wrong foundations.

---

## Pre-Execution: Merge PR #53 and Tag Baseline

Before any track begins:

1. PR #53 CI re-triggered with `allow-large-pr` label (size guardrail was the blocker)
2. After CI passes, merge PR #53 to main
3. Tag `v0.1.0` on the resulting main commit (triggers CD pipeline to publish images)
4. Close Linear "Week 1 Checkpoint (March 7)" milestone

---

## Three Parallel Task Tracks

### Track 1: Repository & Codebase Stabilization

**Objective:** Eliminate technical debt that blocks or inflates the cost of all remaining work.

**Primary agents:** Codebase Analysis Agent, VAST Platform Engineer (validation)

**Required inputs:** Audit findings F2.1, F5.1, F5.2, F6.2, F7.2; VAST PE validation findings

| ID | Task | Priority | Depends On | Deliverable |
|----|------|----------|------------|-------------|
| T1.1 | **Kafka client migration** | Critical | -- | Replace `kafkajs` with `@confluentinc/kafka-javascript` behind `KafkaClient` interface in `events/kafka-types.ts`. Rewrite `vast-event-subscriber.ts` to consume interface only. Dynamic import in `app.ts`. |
| T1.2 | **Scanner function VAST fixes** | Critical | -- | Fix `function.py` handler signature from `handler(event, context)` to `handler(ctx, event)` per VAST DataEngine docs. Add Basic auth to `trino_client.py`. |
| T1.3 | **CI coverage for Python services** | High | -- | Add `pytest` steps for scanner-function, openassetio-manager, and dataengine-functions to `ci.yml`. Add `test:scanner`, `test:openassetio`, `test:dataengine` scripts. |
| T1.4 | **Bounded state consolidation** | High | T1.1 | Move `approvalAuditLog` and `dccAuditTrail` into `PersistenceAdapter`. Add LRU eviction to `processedEventIds` (cap 10K). Resolves SERGIO-158 + H4. |
| T1.5 | **EXR inspector consolidation** | Medium | T1.3 | Eliminate divergent mock data across 3 implementations. Single source of truth in `dataengine-functions/oiio-proxy-generator`. |
| T1.6 | **DCC stub safety** | Medium | -- | Return 404 for unknown job IDs in `GET /dcc/status/:job_id`. Gate stubs behind env var or mark `deprecated: true` in OpenAPI. |
| T1.7 | **Worktree cleanup** | Low | -- | Remove stale `.worktrees/` directories. Delete 2 remaining remote branches. |

**Acceptance criteria:**
- `kafkajs` removed from `package.json`; `@confluentinc/kafka-javascript` installed
- Scanner function handler matches VAST DataEngine spec
- All Python services tested in CI
- Zero module-scoped mutable state in route files
- 252+ control-plane tests pass, 0 TS errors

**Risks:**
- `@confluentinc/kafka-javascript` has native C++ bindings (librdkafka) -- may need build tooling in Docker
- Scanner function signature change may affect any VAST DataEngine function registrations

**Parallelism:** T1.1 + T1.2 + T1.3 + T1.7 run simultaneously (no dependencies). T1.4 waits for T1.1. T1.5 benefits from T1.3.

---

### Track 2: Workstream & Issue Alignment

**Objective:** Restore full traceability between Linear, GitHub, and Git. Establish workflow standards.

**Primary agents:** GitHub Agent, Linear Agent

**Required inputs:** Consistency matrix, PR history, Linear issue list

| ID | Task | Priority | Depends On | Deliverable |
|----|------|----------|------------|-------------|
| T2.1 | **Retroactive PR linking** | High | -- | Add `SERGIO-*` references to the 18 unlinked PRs via `gh pr edit`. Add phase/type labels to all 53 PRs. |
| T2.2 | **Linear milestone hygiene** | High | -- | Close Week 1 milestone. Reassign 8 backlog items to correct milestones per sprint plan. Fix Week 4 showing 100% despite remaining work. |
| T2.3 | **Create PR template** | High | -- | `.github/PULL_REQUEST_TEMPLATE.md` with Summary, Linear Issue, Changes, Test Plan, Documentation Impact checklist. |
| T2.4 | **Add missing GitHub labels** | Medium | -- | Create `phase-3`, `phase-4`, `phase-8`, `reliability`, `documentation`, `ci` labels. |
| T2.5 | **Branch and release hygiene** | Medium | PR #53 merged | Delete `origin/feat/materialx-integration` and `origin/feat/otio-editorial-lineage`. Create `v0.1.0` tag. |
| T2.6 | **Sprint plan assignment** | Medium | T2.2 | Map backlog to 3 sprints: Sprint A (Reliability: 123, 124, 158) -> Sprint B (Production: 125, 156, 157) -> Sprint C (Polish: 155, 120). |
| T2.7 | **Document workflow standards** | Low | T2.3 | Branch naming convention (`{type}/{description}`), issue linking requirement, label standards, milestone discipline. |

**Acceptance criteria:**
- 100% of PRs have at least one label
- 100% of merged PRs can be traced to a Linear issue
- PR template auto-populates on new PRs
- `v0.1.0` tag exists and CD pipeline published images
- Backlog items assigned to milestones with target dates

**Risks:**
- Retroactive PR body edits may trigger webhook notifications
- Linear API rate limits when bulk-updating milestones

**Parallelism:** T2.1 through T2.4 are fully independent. T2.5 requires PR #53 merged. T2.6 requires T2.2.

---

### Track 3: Documentation & Governance

**Objective:** Close documentation gaps, establish sustainable maintenance practices, and prevent recurrence of drift.

**Primary agents:** Documentation Agent, Governance Agent

**Required inputs:** Documentation audit findings, governance gap analysis

| ID | Task | Priority | Depends On | Deliverable |
|----|------|----------|------------|-------------|
| T3.1 | **Complete api-contracts.md** | Critical | -- | Add 5 missing route groups: Approval (4 endpoints), Review (1), DCC (4, marked as stubs), Materials (13), Timelines (5). Include request/response schemas from Fastify route definitions. |
| T3.2 | **Add webhook env vars** | High | -- | Add `ASSETHARBOR_WEBHOOK_*` and audit retention vars to all `.env.example` files. |
| T3.3 | **Create CONTRIBUTING.md** | High | -- | Prerequisites, setup, branch naming, commit conventions, PR workflow, test and doc requirements. |
| T3.4 | **Fix stale architecture doc** | Medium | -- | Update `VAST_NATIVE_ARCHITECTURE.md`: replace point-in-time test counts with "see CI" reference. Note kafkajs status accurately. |
| T3.5 | **Wiki 2.0 stub resolution** | Medium | T3.1 | Convert Architecture, Getting-Started, API-Reference stubs to redirects pointing at canonical docs. Expand Security page or convert to redirect. |
| T3.6 | **Archive historical docs** | Low | -- | Move 10 historical plan/completion docs to `docs/archive/`. Fix dangling references in COMPLETION_CHECKLIST.md and DOCUMENTATION_REVIEW. |
| T3.7 | **CI documentation linter** | Medium | T3.1, T3.2 | New `scripts/ci/check-docs-consistency.js`: verify every route file has api-contracts.md section, every `ASSETHARBOR_*` env var is in .env.example. Add to CI. |

**Acceptance criteria:**
- `api-contracts.md` covers all 17 route files registered in `app.ts`
- All `ASSETHARBOR_*` env vars in code appear in `.env.example`
- `CONTRIBUTING.md` exists with actionable setup instructions
- CI fails if new routes or env vars are added without documentation
- Wiki stubs either redirect or contain 50+ lines of substantive content

**Risks:**
- api-contracts.md is labor-intensive (27+ endpoints to document with schemas)
- CI docs linter must be tolerant of legitimate exceptions (internal-only routes)

**Parallelism:** T3.1, T3.2, T3.3, T3.6 are fully independent. T3.5 and T3.7 depend on T3.1.

---

## VAST Platform Engineer Validation Report

### Architecture Assessment: APPROVED with conditions

The foundational VAST integration patterns are **architecturally sound**:
- Trino REST client with nextUri polling: correct approach for VastDB
- ElementCreated triggers on S3 views: standard VAST DataEngine pattern
- sourceUri-based event correlation: valid alternative to jobId for VAST events
- CloudEvent typing for DataEngine outputs: aligned with VAST Event Broker
- SQL migration approach with version gating: appropriate for VastDB schema management

### Critical Fixes Required Before Production (3 items)

| # | Issue | Location | VAST Rationale |
|---|-------|----------|----------------|
| 1 | **Replace kafkajs** | `vast-event-subscriber.ts`, `package.json` | `kafkajs` is discontinued pure-JS. VAST Event Broker requires `@confluentinc/kafka-javascript` (librdkafka) for production reliability, exactly-once semantics, and proper SASL/SSL support. |
| 2 | **Fix DataEngine handler signature** | `scanner-function/function.py` | VAST DataEngine passes `(ctx, event)` not `(event, context)`. The current signature will fail at invocation time on a real VAST cluster. |
| 3 | **Add Trino Basic auth** | `scanner-function/trino_client.py` | VastDB Trino endpoint requires Basic authentication. The scanner function's Trino client has no auth headers, which will fail on any production VAST cluster. |

### Biggest Architectural Risk

The `VastPersistenceAdapter` at `persistence/adapters/vast-persistence.ts` delegates **all workflow-critical operations** (jobs, DLQ, outbox, event deduplication) to the `localFallback` `LocalPersistenceAdapter` when Trino is unavailable. This means the entire reliability stack (CAS claiming, idempotent processing, audit trail) runs against in-memory storage in the default configuration. This is appropriate for dev mode but must be resolved before production deployment (SERGIO-180+ scope).

### Track Conflict Assessment: No conflicts

The three parallel tracks do not introduce operational conflicts:
- Track 1 modifies source code (events, persistence, CI)
- Track 2 modifies GitHub/Linear metadata (labels, milestones, PR bodies)
- Track 3 modifies documentation files and CI scripts

File-level overlap is minimal: only `.github/workflows/ci.yml` is touched by both T1.3 and T3.7, but T3.7 adds a new step (docs linter) while T1.3 adds Python test steps -- these are additive and non-conflicting.

---

## Agent/Subagent Assignment Map

| Track | Lead Agent | Supporting Agents | Scope |
|-------|-----------|------------------|-------|
| Track 1 | Codebase Analysis | VAST Platform Engineer (T1.1, T1.2 validation), CI/CD Agent (T1.3) | Source code, dependencies, CI pipeline |
| Track 2 | GitHub Agent | Linear Agent (T2.2, T2.6), Governance Agent (T2.3, T2.7) | Project metadata, tracking systems |
| Track 3 | Documentation Agent | Governance Agent (T3.7), CI/CD Agent (T3.7) | Documentation files, CI linting |

---

## Dependency Overview

```
PRE-EXECUTION: Merge PR #53 → Tag v0.1.0
                    |
    ┌───────────────┼───────────────┐
    v               v               v
  TRACK 1         TRACK 2         TRACK 3
  T1.1 Kafka ──┐  T2.1 PR links   T3.1 API contracts
  T1.2 Scanner  │  T2.2 Milestones T3.2 Env vars
  T1.3 CI py    │  T2.3 PR tmpl    T3.3 CONTRIBUTING
  T1.7 Worktree │  T2.4 Labels     T3.4 Architecture
    |           │  T2.5 Release ←── (needs v0.1.0)
    v           │  T2.6 Sprint     T3.6 Archive
  T1.4 State ←─┘  T2.7 Standards    |
  T1.5 EXR                        T3.5 Wiki ←── T3.1
  T1.6 DCC                        T3.7 Linter ←── T3.1, T3.2
```

Cross-track dependency: T2.5 (release tag) requires PR #53 merged (pre-execution).
No other cross-track dependencies exist.

---

## Sprint Timeline

| Week | Sprint | Track 1 | Track 2 | Track 3 |
|------|--------|---------|---------|---------|
| Mar 10-14 | Pre + Sprint A | T1.1, T1.2, T1.3, T1.7 | T2.1-T2.5 | T3.1, T3.2, T3.3 |
| Mar 14-21 | Sprint B | T1.4, T1.5, T1.6 | T2.6, T2.7 | T3.4, T3.5, T3.6, T3.7 |
| Mar 21-28 | Sprint C | Backlog: SERGIO-123, 124, 125 | Milestone closeout | Backlog: SERGIO-155, 156, 157 |
| Mar 28 | Release | Tag v0.2.0 | Close all milestones | Final doc sweep |

---

## Constraint Acknowledgment

This plan introduces NO new features. All tasks address:
- Technical debt identified during the audit
- Governance gaps that caused the drift
- Documentation inconsistencies between systems
- Platform compatibility issues flagged by VAST PE

Feature work (remaining backlog SERGIO-120 through SERGIO-180+) begins only after all three tracks complete their Sprint A/B deliverables.

---

*Consolidated from domain reports by: Codebase Analysis Agent, GitHub/Linear Alignment Agent, Documentation/Governance Agent, VAST Platform Engineer. 2026-03-10.*
