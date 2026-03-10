# AssetHarbor Project Audit Report

**Date:** 2026-03-10
**Scope:** Git, GitHub, Linear, Codebase, Documentation
**Objective:** Restore coherence across all project tracking systems

---

## 1. Project State Snapshot

| Metric | Value |
|--------|-------|
| Current branch | `main` (clean, up-to-date with origin) |
| Total commits on main | 170+ |
| Total PRs | 52 (45 merged, 7 closed, 0 open) |
| Remote branches | 44 (30 merged, 14 unmerged) |
| Tags / Releases | 0 / 0 |
| Linear issues audited | 45 |
| Actually completed (code merged) | 34 |
| Genuinely remaining | 8 + Phase 4 production chain |
| control-plane tests | 252 passing |
| web-ui tests | 78 passing |
| TypeScript errors | 0 in source (53 in web-ui node_modules only) |
| Untracked files | 5 |
| Branch protection | None |
| Code reviews on PRs | None (all self-merged) |

---

## 2. Workstream Map

### Completed Workstreams

| Workstream | PRs | Linear Issues | Status |
|------------|-----|---------------|--------|
| Phase 1-2 Stabilization | #1-#4, #28 | SERGIO-57, 109, 110, 114, 116 | Done |
| Phase 5 VAST Persistence Parity | #4 | SERGIO-57 | Done |
| Phase 6 Operator UX + Governance | #5-#8 | SERGIO-58, 59, 60, 61 | Done |
| Phase 7 Review/QC + Operations | #9-#15, #17-#26 | SERGIO-17, 18, 19, 62, 63, 64, 65 | Done |
| Phase 3 Data Engine + Features | #28-#34, #39 | SERGIO-118-122, 129-131, 136-140 | Done |
| ASWF Pipeline (OIIO, OCIO, OTIO, OpenAssetIO, OpenRV) | #35-#37, #40, #46 | -- | Done |
| MaterialX Domain + API | #44, #45 | -- | Done |
| CI Hardening | #38, #42 | -- | Done |
| Critical Bug Fixes (C1-C4) | commits | SERGIO-145, 146, 147, 117 | Done |
| P1 Trino/VAST Persistence | #48-#52 | SERGIO-159-164 | Done |

### Active / Future Workstreams

| Workstream | Status | Notes |
|------------|--------|-------|
| Phase 3 UI Overhaul | Future | Plan dated April-June 2026; local branch exists |
| Phase 4 VAST Integration Testing | Future | Requires real VAST cluster (SERGIO-180+) |
| Phase 8 Identity/Roles/Entitlements | Future | 0% progress, no target date |

### Remaining Backlog (genuinely unfinished)

| Issue | Title | Priority |
|-------|-------|----------|
| SERGIO-120 | Strongly type VFX metadata | Medium |
| SERGIO-123 | Background heartbeat task in worker | Urgent |
| SERGIO-124 | DLQ automation and retry counter | High |
| SERGIO-125 | VastDbAdapter CAS load test | High |
| SERGIO-155 | Asset list pagination and filtering | Medium |
| SERGIO-156 | Gate media-worker behind dev profile | Medium |
| SERGIO-157 | Webhook config docs + env vars in compose | Medium |
| SERGIO-158 | Bounded processedEventIds eviction (LRU/TTL) | Medium |

---

## 3. Consistency Matrix (Linear <-> GitHub <-> Git)

### Status Mismatches (Linear says X, reality says Y)

| Linear Issue | Linear Status | Actual Status | Evidence | Action |
|-------------|--------------|---------------|----------|--------|
| SERGIO-19 | In Progress | Done | PR #15 merged 2026-02-23 | Close in Linear |
| SERGIO-62 | In Progress | Done | PRs #17-26 all merged | Close in Linear |
| SERGIO-115 | Backlog | Likely Done | Blocker SERGIO-114 done; async refactor in codebase | Verify and close |
| SERGIO-159 | Backlog | Done | PR #48 merged 2026-03-10 | Close in Linear |
| SERGIO-160 | Backlog | Done | PR #48 merged 2026-03-10 | Close in Linear |
| SERGIO-161 | Backlog | Done | PR #49 merged 2026-03-10 | Close in Linear |
| SERGIO-162 | Backlog | Done | PR #50 merged 2026-03-10 | Close in Linear |
| SERGIO-163 | Backlog | Done | PR #51 merged 2026-03-10 | Close in Linear |
| SERGIO-164 | Backlog | Done | PR #52 merged 2026-03-10 | Close in Linear |

### MEMORY.md Inaccuracies

| Claim | Reality | Action |
|-------|---------|--------|
| C4 kafkajs->Confluent: "Done" | `kafkajs` is still installed; `kafka-types.ts` doesn't exist | Correct MEMORY.md |
| Key path: `events/kafka-types.ts` | File does not exist | Remove from MEMORY.md |
| Branch: `feat/materialx-api` (active) | Current branch is `main` | Update MEMORY.md |
| Test count: 207 (control-plane) | Now 252 | Update MEMORY.md |

### Documentation <-> Code Mismatches

| Document | Claim | Reality | Action |
|----------|-------|---------|--------|
| docker-compose.yml | openassetio port 3000 | control-plane listens on 8080 | Fix port |
| PERSISTENCE_ARCHITECTURE.md | References MockVastAdapter | File doesn't exist | Update or remove doc |
| .env.example files | -- | Missing `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` | Add to env examples |
| README.md | Lists only core routes | Missing approval, materials, timelines, review, DCC routes | Update README |
| api-contracts.md | Core endpoints only | Missing 5+ route groups | Update contracts |

---

## 4. Branch Cleanup Plan

### Immediate Deletion (30 merged remote branches)

All branches associated with merged PRs. Key groups:

```
# P1 feature chain (merged today)
origin/feat/p1-trino-client
origin/feat/p1-cli-installer
origin/feat/p1-vast-persistence-reads
origin/feat/p1-vast-persistence-writes
origin/feat/p1-integration-tests

# ASWF pipeline
origin/feat/oiio-ocio-pipeline
origin/feat/phase-2-aswf-pipeline
origin/feat/phase-3-ui-overhaul

# MaterialX
origin/feat/materialx-api
origin/feat/materialx-domain

# Fixes
origin/fix-ci-declared-deps-check
origin/fix/remove-corrupted-submodule

# All origin/sergio-* and origin/ssotoa70/sergio-* merged branches (20+)
```

### Deletion After Review (7 abandoned unmerged branches)

| Branch | Ahead | Behind | Recommendation |
|--------|-------|--------|----------------|
| origin/phase-3-feature-development | 5 | 67 | Delete (superseded by later PRs) |
| origin/sergio-137-r1b-hierarchy-routes | 1 | 69 | Delete (PR #31 merged from different branch) |
| origin/ssotoa70/sergio-62-phase-7-* | 4 | 142 | Delete (abandoned) |
| origin/ssotoa70/sergio-62-slice-2-role-boards-* | 1 | 130 | Delete (PR merged from recut) |
| origin/ssotoa70/sergio-62-slice-3-readiness-* | 3 | 130 | Delete (PR merged from recut) |
| origin/ssotoa70/sergio-62-slice-3-*-recut | 2 | 128 | Delete (PR closed/recut) |
| origin/worktree-assetharbor-implementation-* | 1 | 113 | Delete (worktree artifact) |

### Keep (4 branches with potential future use)

| Branch | Reason |
|--------|--------|
| origin/feat/materialx-integration | May contain unmerged work |
| origin/feat/otio-editorial-lineage | 9 ahead, may have unmerged features |
| origin/feature/openassetio-manager-clean | 6 ahead, review before deleting |
| Local: feat/phase-4-local-tasks | Active local development |

### Local Branch Cleanup

| Branch | Action |
|--------|--------|
| feat/phase-3-ui-overhaul | Keep (tracks remote) |
| feat/phase-4-local-tasks | Keep (active) |
| feat/materialx-integration | Delete (1 ahead, 22 behind, superseded) |

---

## 5. Codebase Issues

### HIGH Priority

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| F2.1 | `kafkajs` still in use despite documented migration | package.json, vast-event-subscriber.ts | Correct MEMORY.md OR complete migration |
| F5.5 | `AsyncPersistenceAdapter` is dead code (zero implementors) | persistence/async-adapter.ts | Delete file |
| F7.2 | docker-compose openassetio port mismatch (3000 vs 8080) | docker-compose.yml:60 | Fix to 8080 |

### MEDIUM Priority

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| F5.1 | DCC routes are stubs | routes/dcc.ts | Document as stubs or implement |
| F5.2 | Module-scoped mutable state in approval.ts | routes/approval.ts | Move to persistence layer |
| F5.6 | Empty scaffolding dirs | control-plane/services/dataengine-functions/ | Delete |
| F5.8 | PERSISTENCE_ARCHITECTURE.md references nonexistent files | persistence/PERSISTENCE_ARCHITECTURE.md | Update or delete |
| F7.1 | web-ui missing skipLibCheck in tsconfig | web-ui/tsconfig.json | Add skipLibCheck: true |
| -- | CI doesn't test scanner-function, openassetio-manager, dataengine-functions | .github/workflows/ci.yml | Add test steps |
| -- | Nightly Reliability Smoke failing on main | CI | Investigate and fix |

### LOW Priority

| ID | Issue | Location | Action |
|----|-------|----------|--------|
| F5.7 | 85KB session transcript at repo root | *.txt | Gitignore or delete |
| F2.2 | requests version mismatch across Python services | requirements.txt files | Align versions |
| F7.3 | Inconsistent .gitignore for Python __pycache__ | Root .gitignore | Extend patterns |
| -- | scripts/__pycache__/ untracked | scripts/ | Add to .gitignore |

---

## 6. Documentation Issues

### Critical

| Issue | Action |
|-------|--------|
| MEMORY.md claims C4 (Kafka migration) is Done -- it is NOT | Revert C4 to "Open" or correct the description |
| MEMORY.md references nonexistent `kafka-types.ts` | Remove path |
| handoff-assetharbor-phase4.md references missing plan file | Archive all handoff files |

### High

| Issue | Action |
|-------|--------|
| 3 stale handoff files in .claude/ | Archive or delete |
| API contracts missing 5+ route groups | Update api-contracts.md |
| README missing newer routes | Update README |
| .env.example files missing documented env vars | Add missing vars |

### Medium

| Issue | Action |
|-------|--------|
| Wiki 2.0 stubs (Architecture, Getting-Started, API-Reference, Security) | Expand or remove |
| Test counts stale in VAST_NATIVE_ARCHITECTURE.md | Update or remove counts |
| Phase numbering inconsistent across docs | Standardize |
| Untracked: deployment-guide.md, deploy.py | Commit |

---

## 7. Governance Recommendations

1. **Enable branch protection on `main`**: Require PR reviews, status checks, no force push
2. **Create a v0.1.0 tag**: Mark current state as a baseline release
3. **Establish a PR review requirement**: Even self-review with a checklist
4. **Fix nightly smoke**: The scheduled reliability test is failing
5. **Expand CI coverage**: Add scanner-function, openassetio-manager, and dataengine-functions tests

---

## 8. Remediation Checklist

### Phase A: Linear Cleanup (no code changes)

- [ ] Close SERGIO-19 (In Progress -> Done)
- [ ] Close SERGIO-62 (In Progress -> Done)
- [ ] Close SERGIO-159 through SERGIO-164 (Backlog -> Done)
- [ ] Verify SERGIO-115 and close if complete
- [ ] Unblock SERGIO-125 (blocker SERGIO-109 is Done)

### Phase B: Git/GitHub Cleanup

- [ ] Delete 30 merged remote branches (`git push origin --delete <branch>`)
- [ ] Delete 7 abandoned unmerged remote branches (after review)
- [ ] Delete local `feat/materialx-integration` branch
- [ ] Prune local remote-tracking refs (`git remote prune origin`)
- [ ] Add `scripts/__pycache__/` to .gitignore
- [ ] Remove or gitignore 85KB session transcript file
- [ ] Commit untracked files: `docs/deployment-guide.md`, `scripts/deploy.py`
- [ ] Create v0.1.0 tag on current main

### Phase C: Code Fixes

- [ ] Fix docker-compose.yml port 3000 -> 8080 for openassetio-manager
- [ ] Delete `persistence/async-adapter.ts` (dead code)
- [ ] Delete `control-plane/services/dataengine-functions/` (empty scaffolding)
- [ ] Add `skipLibCheck: true` to web-ui/tsconfig.json
- [ ] Add missing env vars to .env.example files

### Phase D: Documentation Updates

- [ ] Correct MEMORY.md: revert C4 status, remove kafka-types.ts path, update test counts, update branch
- [ ] Archive or delete stale handoff files
- [ ] Update or delete PERSISTENCE_ARCHITECTURE.md
- [ ] Update README with complete route list
- [ ] Update api-contracts.md with missing route groups

### Phase E: Governance Setup

- [ ] Enable branch protection on main (require PR + CI)
- [ ] Investigate and fix nightly reliability smoke failure
- [ ] Add scanner-function and openassetio-manager tests to CI
- [ ] Establish PR review process

---

*Generated by project audit on 2026-03-10. This report should be reviewed and the remediation checklist executed in order (A through E).*
