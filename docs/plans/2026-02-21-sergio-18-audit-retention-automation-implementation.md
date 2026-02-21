# SERGIO-18 Audit Retention Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add safe 90-day audit retention automation with `dry-run` default and explicit `apply` enforcement mode.

**Architecture:** Extend persistence adapters with retention preview/apply methods and run a control-plane retention scheduler in process. Keep API routes unchanged and preserve existing contract compatibility.

**Tech Stack:** TypeScript, Fastify lifecycle hooks, Node test runner.

---

### Task 1: Persistence contract additions

**Files:**
- Modify: `services/control-plane/src/persistence/types.ts`
- Modify: `services/control-plane/test/persistence-contract.test.ts`

### Task 2: Local adapter retention behavior

**Files:**
- Modify: `services/control-plane/src/persistence/adapters/local-persistence.ts`
- Modify: `services/control-plane/test/assets-audit.test.ts`

### Task 3: VAST retention delegation

**Files:**
- Modify: `services/control-plane/src/persistence/vast/workflow-client.ts`
- Modify: `services/control-plane/src/persistence/adapters/vast-persistence.ts`
- Modify: `services/control-plane/test/vast-mode-contract.test.ts`

### Task 4: Retention runner and lifecycle wiring

**Files:**
- Create: `services/control-plane/src/retention/audit-retention.ts`
- Modify: `services/control-plane/src/app.ts`
- Create: `services/control-plane/test/retention-automation.test.ts`

### Task 5: Runbook and docs

**Files:**
- Modify: `docs/runbook.md`
- Modify: `docs/api-contracts.md`

### Task 6: Verification

Run:

- `npm run test:docs`
- `npm run test:contracts`
- `npm run test:control-plane`
- `npm run test:all`
