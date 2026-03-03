# Runbook

## Startup

1. Copy `.env.example` to `.env` and set:
   - `ASSETHARBOR_PERSISTENCE_BACKEND`
   - `ASSETHARBOR_VAST_STRICT` (recommended `true` for VAST-backed deployments)
   - `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL` (`true` for continuity, `false` for strict fail-fast)
   - VAST endpoints and token
   - optional API keys (`ASSETHARBOR_API_KEY`, `CONTROL_PLANE_API_KEY`, `VITE_API_KEY`)
   - webhook outbound integration config (optional):
     - `ASSETHARBOR_WEBHOOK_SLACK_URL`
     - `ASSETHARBOR_WEBHOOK_TEAMS_URL`
     - `ASSETHARBOR_WEBHOOK_PRODUCTION_URL`
     - `ASSETHARBOR_WEBHOOK_SIGNING_SECRET`
     - `ASSETHARBOR_WEBHOOK_STRICT_MODE` (`true`/`false`)
2. Run `docker compose up --build` from `AssetHarbor/`.
3. Verify:
   - API: `http://localhost:8080/health`
   - UI: `http://localhost:4173`

## Core Workflow Check

1. Submit ingest through UI or `POST /api/v1/assets/ingest`.
2. Worker claims jobs via `POST /api/v1/queue/claim`.
3. Confirm active lease heartbeat on `POST /api/v1/jobs/:id/heartbeat`.
4. Worker emits events to `POST /api/v1/events`.
5. Confirm status updates on `GET /api/v1/assets` and UI queue.
6. Validate counters on `GET /api/v1/metrics`.

## Failure Recovery

- If processing fails and attempts remain, system schedules retry automatically.
- When retries are exhausted, verify job appears in `GET /api/v1/dlq`.
- Replay a failed job with `POST /api/v1/jobs/:id/replay`.
- Use `POST /api/v1/queue/reap-stale` to requeue expired processing leases.

## Outbound webhook integrations

- Outbox publish (`POST /api/v1/outbox/publish`) dispatches webhook payloads to configured targets (`slack`, `teams`, `production`).
- Deliveries include HMAC signature header (`x-assetharbor-signature`) and timestamp (`x-assetharbor-timestamp`).
- On outbound failure, outbox entries stay pending for retry and audit logs include target-specific failure details.

## VAST strict and fallback policy

- Strict mode: with `ASSETHARBOR_VAST_STRICT=true` and `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=false`, VAST workflow client failures fail-fast.
- Continuity mode: with `ASSETHARBOR_VAST_FALLBACK_TO_LOCAL=true`, client failures fall back to local adapter behavior.
- Fallback usage is surfaced in `GET /api/v1/audit` as structured signal fields (`signal.type=fallback`, `signal.code=VAST_FALLBACK`, `signal.severity`).
- Operator dashboards should classify degraded/recovering state from structured `signal` values and event recency, not from audit message text parsing.
- Durability semantics (current): fallback counters and fallback signals are in-process and reset on control-plane restart; treat them as operational indicators, not durable compliance history.
- For incident validation, run ingest/event workflow and then confirm fallback `signal` values in audit events.

## SLO Definitions

- **Availability SLO:** `GET /health` success rate >= 99.9% over 30 days.
- **Workflow SLO:** 99% of ingest jobs reach a terminal state (`completed` or `failed`) within 15 minutes.
- **Reliability SLO:** degraded-mode fallback events remain below 0.5% of workflow write operations per 24 hours.

## Warning and Critical Thresholds

| Signal | Warning threshold | Critical threshold | Source |
| --- | --- | --- | --- |
| Fallback events (`degradedMode.fallbackEvents`) | +5 in 10 minutes | +20 in 10 minutes | `GET /api/v1/metrics` |
| DLQ growth (`dlq.total`) | +3 in 15 minutes | +10 in 15 minutes | `GET /api/v1/metrics` |
| Pending queue (`queue.pending`) | >50 for 15 minutes | >150 for 15 minutes | `GET /api/v1/metrics` |

## Ownership and Escalation Matrix

| Scenario | Primary owner | Secondary owner | Escalation target | Escalation window |
| --- | --- | --- | --- | --- |
| Warning threshold breach | On-call operator | Service owner | Engineering manager | 30 minutes |
| Critical threshold breach | Service owner | Incident commander | Director on-call | 15 minutes |
| Security or data integrity risk | Incident commander | Security lead | Executive on-call | Immediate |

## Shared Operator Coordination and Handoff

1. Read shared state with `GET /api/v1/incident/coordination` before taking ownership changes.
2. Update guided actions via `PUT /api/v1/incident/coordination/actions` whenever acknowledgement, owner, escalation status, or next update ETA changes.
3. Add timeline updates via `POST /api/v1/incident/coordination/notes` for each decision, mitigation, and escalation handoff checkpoint.
4. Use `PUT /api/v1/incident/coordination/handoff` to transition handoff state:
   - `none`: no active handoff.
   - `handoff_requested`: outgoing owner requests transition and records summary.
   - `handoff_accepted`: incoming owner accepts and becomes active responder.
5. During critical threshold incidents, keep escalation targets aligned with the matrix above and reflect any owner/escalation changes in guided actions immediately.

## Correlation ID Discipline for Incident Timeline Notes

- Reuse the workload `x-correlation-id` when posting incident notes so runbook, audit feed, and API traces remain linkable.
- If a note references a known fallback or workflow event, set `correlationId` to that event correlation (for example `corr-vast-fallback-123`).
- Keep note text action-oriented and time-bound (what changed, who owns next action, and next ETA).
- Validate timeline continuity by checking `GET /api/v1/incident/coordination` and `GET /api/v1/audit` for matching correlation markers.

## Canary Promotion and Rollback Gates

1. Promote canary only when warning/critical thresholds are clear for 30 minutes and no new `vast fallback` entries appear in audit feed.
2. Halt promotion if any critical threshold trips, job terminal-state latency exceeds SLO budget, or canary error rate exceeds baseline by 2x.
3. Roll back immediately when critical thresholds persist for 10 minutes after mitigation actions.

## Go/No-Go Checklist

- [ ] SLO and threshold dashboards reviewed for pre-release baseline.
- [ ] On-call ownership and escalation contacts confirmed for the release window.
- [ ] Canary gates, rollback owner, and rollback command path verified.
- [ ] Release-day checklist completed (`docs/runbooks/release-day-checklist.md`).

## Project-by-Project Rollout Tracking

- Use in-repo rollout artifacts for each release cohort:
  - `docs/rollouts/templates/cohort-rollout-tracker.md`
  - `docs/rollouts/templates/project-rollout-signoff.md`
- Keep one row per project in the cohort tracker and one signoff record per project.
- Do not mark a project `live` in the tracker until service owner and ops owner signoff fields are completed in the project record.

## Coordinator Handoff and Release Readiness

- For `qc_approved` assets, coordinator completes handoff checklist (release notes, verification, comms draft, owner assignment).
- Use `docs/runbooks/release-day-checklist.md` communication templates for promotion/rollback/post-release updates.
- Post-release verification is mandatory at T+15m and T+60m before final sign-off.

## Audit Retention Automation (90 Days)

- Retention job defaults to `dry-run` and can be switched to `apply` mode explicitly.
- Configure with environment variables:
  - `ASSETHARBOR_AUDIT_RETENTION_ENABLED` (`true`/`false`, default `true`)
  - `ASSETHARBOR_AUDIT_RETENTION_MODE` (`dry-run`/`apply`, default `dry-run`)
  - `ASSETHARBOR_AUDIT_RETENTION_DAYS` (default `90`)
  - `ASSETHARBOR_AUDIT_RETENTION_INTERVAL_SECONDS` (default `3600`)
  - `ASSETHARBOR_AUDIT_RETENTION_MAX_DELETE_PER_RUN` (optional safety cap)
- Eligibility rule: audit records where `at < cutoff` are eligible for retention apply.
- Boundary rule: records at exactly cutoff timestamp are retained.

### Dry-run and Apply Operations

1. Start in `dry-run` mode and run at least one full cycle.
2. Confirm eligible counts and cutoff behavior match expectations.
3. Set mode to `apply` only after verification.
4. Keep `ASSETHARBOR_AUDIT_RETENTION_MAX_DELETE_PER_RUN` set during initial rollout.

### Rollback and Restore Guidance

1. If unexpected deletions are detected, switch mode to `dry-run` immediately (or disable retention).
2. Restart control-plane to apply updated mode safely.
3. Restore audit records from latest backup snapshot if required by incident/compliance response.
4. Capture restoration activity in incident timeline notes and attach correlation IDs.

## Troubleshooting

- `400` on `/api/v1/events`: verify canonical event envelope fields (`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `producer`, `data.assetId`, `data.jobId`).
- No worker progress: verify `CONTROL_PLANE_URL` and worker container logs.
- UI empty: verify API returns data from `/api/v1/assets` and `/api/v1/audit`.
- Check `x-correlation-id` response header for request tracing.
- `401/403` on POST routes: verify matching API keys across control-plane, worker, and web-ui.
