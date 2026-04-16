# MAM Readiness — Phase 1 Execution Plan

**Date:** 2026-04-16
**Source:** 5-agent MAM readiness review (see conversation log)
**Scope:** Phase 1 Monday-morning punch list from the review's Catch-up Roadmap

---

## Goal

Close the operational hazards that make SpaceHarbor dangerous today and lay
the schema foundation for Phase 2 atomic check-in + workflow engine work.

## Ship conditions

Each bullet ships a small, revert-friendly commit. Every commit:
- Type-checks (no new errors introduced).
- Is validated against `http://10.143.2.102/` before the next commit lands.
- Has its SHA confirmed against the remote (`feedback_commit_sha_validation.md`).

## Monday-morning punch list

1. **SIGTERM handler** — `services/control-plane/src/server.ts`. Graceful
   drain via `app.close()` on SIGTERM/SIGINT with a configurable timeout
   (`SPACEHARBOR_SHUTDOWN_TIMEOUT_MS`, default 30 s).
   *Closes: "no graceful shutdown" hazard.*

2. **Migration 015 — `s3_compensation_log`** — forward-only FileUndo
   equivalent. Columns: `id, tx_id, correlation_id, s3_bucket, s3_key,
   operation, inverse_operation, inverse_payload, status, actor, created_at,
   committed_at, compensated_at, last_error, attempts`.
   Status lifecycle: `pending → committed | compensated | failed`.
   Reaper worker lands in a follow-up (Phase 2 atomic-checkin PR).

3. **Migration 016 — `custom_field_definitions` + `custom_field_values`** —
   runtime schema extension without `ALTER TABLE`. Supports `string | number
   | boolean | date | enum | ref` types. Soft-delete via `deleted_at` so
   value rows referencing deprecated definitions remain readable.

4. **Migration 017 — version `context` + sentinels** — `ALTER TABLE
   versions ADD COLUMN context, is_sentinel, sentinel_name, manifest_id`.
   Each is its own VAST transaction; per-statement error tolerance in the
   installer makes re-run idempotent even though `IF NOT EXISTS` is not
   guaranteed on VAST's Trino connector (confirmed with vast-platform-engineer).

5. **Custom fields HTTP surface** — `POST|GET|PATCH|DELETE
   /custom-fields/definitions`, `PUT|GET|DELETE /custom-fields/values/:et/:id`.
   Validation is pure (`domain/custom-fields.ts`). Bulk value `PUT`
   validates every field before any write — atomic per-entity updates.
   Values are projected onto entities via a future Phase-2 join in the
   persistence layer.

6. **Framework-enforced audit hooks** — `http/hooks.ts :: attachAuditHooks`.
   `onResponse` hook emits a structured audit row for every mutating
   request. Swallows persistence failures so audit can never break a
   request. Skips `/health`, `/metrics`, `/openapi`, `/docs`.
   *Closes: "audit drift from per-route manual calls" gap.*

7. **List-limit tripwire** — `http/hooks.ts :: attachLimitTripwire`.
   `preValidation` hook caps pathological `?limit=...` values at
   `SPACEHARBOR_MAX_LIST_LIMIT` (default 500) before route handlers see
   them. Individual routes keep their own lower caps.
   *Closes: "OOM on large list" hazard.*

8. **Silent IAM fallback gated** — `app.ts:748-759`. Fallback to in-memory
   IAM on Trino failure is now explicit: gated by
   `SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK`. Defaults `true` in dev (first
   boot before "Deploy Schema" runs), `false` in prod. Log level bumped
   from `warn` to `error` when the fallback fires.
   *Closes: "silent role-binding wipe on Trino hiccup" hazard.*

9. **Version-number race retry-loop** — `vast-trino-queries.ts :: insertVersion`.
   Scope `MAX(version_number)` to `(shot_id, context)`. INSERT then verify;
   if another row claimed the same triple, DELETE ours, jittered backoff,
   retry (≤5 attempts). Local adapter does the same but without the retry
   loop (JS event loop serializes it naturally).
   *Closes: "concurrent publishes race to same version" hazard.*

10. **Atomic check-in scaffold** — `routes/checkin.ts`. Endpoints
    `POST /assets/checkin`, `POST /assets/checkin/:id/{commit,abort}`,
    `GET /assets/checkin/:id`. All four return 501 with a helpful pointer
    message for now; full implementation in the Phase 2 atomic-checkin PR
    on branch `feat/atomic-checkin`. Per media-pipeline-specialist feedback,
    commit + sentinel are ONE transaction, not two endpoints — reduces
    failure window.

## Commits on `main` (landed)

- `20da22c` — SIGTERM drain + migrations 015/016/017 + custom fields runtime schema
- `05bf18b` — framework-enforced audit + list-limit tripwire
- `26719ec` — gated silent IAM fallback + version-number race retry-loop
- `b2880b1` — attach hooks directly instead of via Fastify plugin (encapsulation fix)

## Commits on `feat/atomic-checkin`

- (this commit) — route scaffold + phase-plan doc

## QC validation (10.143.2.102)

After each commit batch:
- `docker compose restart control-plane` (tsx, no build step)
- Health: `curl /health` returns `{status: "ok"}`
- IAM: `/health/ready` shows `iam.persistenceType`
- Limit tripwire: `?limit=5000` returns 200 AND logs `[limit-tripwire]` warn
- Audit: any mutation adds a `POST|PUT|PATCH|DELETE /... → STATUS by ACTOR`
  row to `/audit`
- Custom fields E2E:
  - `POST /custom-fields/definitions {name:"show_code", dataType:"string"}` → 201
  - `POST /custom-fields/definitions {name:"BadName", ...}` → 400 (pattern)
  - `POST` duplicate → 409

## Phase 2 hand-off

Phase 2 work continues on `feat/atomic-checkin`:
1. Wire real `CreateMultipartUpload` + per-part presigned URLs
2. `s3_compensation_log` reaper worker (watches rows past `deadline`)
3. `version_files` multi-file manifest migration (migration 018)
4. Merge the four checkin endpoint stubs into real implementations
5. Proxy-ladder schema + DataEngine request API

See docs/plans/2026-04-09-storage-process-wiring-sow.md for the related
Kafka CloudEvent path that becomes Phase 3 (when the Event Broker URL is
configured — out of scope for atomic checkin).

## Respected constraints

- `feedback_no_ci_actions.md` — no GitHub Actions added
- `feedback_no_hardcoded_values.md` — new limits/thresholds are env-gated
  (`SPACEHARBOR_SHUTDOWN_TIMEOUT_MS`, `SPACEHARBOR_MAX_LIST_LIMIT`,
  `SPACEHARBOR_ALLOW_INMEMORY_IAM_FALLBACK`)
- `feedback_dataengine_functions_deprecated.md` — no changes to
  `services/dataengine-functions/`
- `feedback_docs_wiki_not_readme.md` — this doc is an execution plan,
  not release notes. Release notes land in Wiki when Phase 1 is declared
  done.
- `feedback_commit_sha_validation.md` — every push followed by SHA +
  remote-validation report.
