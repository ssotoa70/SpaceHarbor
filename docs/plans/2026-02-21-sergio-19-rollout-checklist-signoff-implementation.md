# SERGIO-19 Rollout Checklist and Signoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add in-repo rollout checklist templates and tracking links for project-cohort cutovers.

**Architecture:** Docs-first implementation with two markdown templates and link integration across runbooks and release process docs. Enforce stability with docs presence tests.

**Tech Stack:** Markdown docs, Node docs tests.

---

### Task 1: Add failing docs tests for new rollout artifacts

- Update `tests/docs/docs-presence.test.js` to require new template files and headings.

### Task 2: Create rollout templates

- Create `docs/rollouts/templates/cohort-rollout-tracker.md`
- Create `docs/rollouts/templates/project-rollout-signoff.md`

### Task 3: Link templates from release/runbook docs

- Update `docs/wiki-2.0/Release-Process.md`
- Update `docs/runbooks/release-day-checklist.md`
- Update `docs/runbook.md`

### Task 4: Verify

- Run `npm run test:docs`
- Run `npm run test:all`
