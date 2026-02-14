# Phase 6 Operator UX Guided Response Design

## Context

AssetHarbor now exposes degraded-mode observability at the API layer:

- `GET /api/v1/metrics` with `degradedMode.fallbackEvents`
- `GET /api/v1/audit` with `vast fallback` markers

Workflow semantics and replay safety are now deterministic (SERGIO-61), so the next gap is operator speed and clarity during degraded incidents.

## Goal

Improve operator detection and triage for degraded mode in the existing web UI without backend/API changes.

## Scope

In scope (SERGIO-58):

- Service health strip (`normal`, `degraded`, `recovering`)
- Fallback impact panel (fallback count + trend + key queue/job counters)
- Correlated timeline highlighting fallback-related audit events
- UI-only guided actions (`acknowledge`, `assign owner`, `escalate`) persisted in browser local storage
- Data freshness visibility and stale-state behavior

Out of scope:

- Backend-persisted incident actions
- Multi-user collaboration state
- New API endpoints
- Predictive analytics and auto-remediation

## Chosen Approach

Approach 2: keep a single page, but split behavior into focused UI sections/components in `services/web-ui/src` while preserving current ingest/replay interactions.

Rationale:

- fastest delivery with lowest architectural risk
- leverages existing APIs and avoids contract churn
- keeps operator context in one place during incident handling

## UX Information Architecture

Top-to-bottom layout:

1. Existing hero/banner
2. New `Operational Health` section (new)
   - Health strip
   - Fallback impact panel
   - Guided actions panel
3. Existing ingest panel
4. Existing assets queue panel
5. Existing recent audit panel upgraded to correlated timeline behavior

Priority rule: ingest and queue operations remain visible and usable; new incident UX augments without displacing core controls.

## Data Model and Derivation

### Data Inputs

- Assets: `GET /api/v1/assets`
- Audit: `GET /api/v1/audit`
- Metrics: `GET /api/v1/metrics`

### Derived UI State

- `fallbackEventsNow`: latest metrics count
- `fallbackEventsDelta`: current count minus previous snapshot count
- `hasRecentFallbackAudit`: recent audit rows containing `vast fallback`
- `lastSuccessfulRefreshAt`: timestamp of latest successful full refresh
- `isStale`: true when now - `lastSuccessfulRefreshAt` exceeds stale threshold

### Health State Logic

- `degraded` when `fallbackEventsDelta > 0` or `hasRecentFallbackAudit`
- `recovering` when recently degraded and no new fallback growth for a cooldown window
- `normal` otherwise

Hysteresis requirement:

- avoid health-state flicker by requiring a minimum cooldown window before returning to `normal`

## Guided Actions Model (UI-only)

Local action state stored in local storage under a namespaced key:

- `acknowledged: boolean`
- `owner: string`
- `escalated: boolean`
- `updatedAt: string`

Guardrails:

- all labels explicitly state these actions are local to this browser/session
- clear/reset action available
- action timestamps shown for handoff clarity

## Accessibility and Clarity Guardrails

- state is never color-only (text labels + icon markers)
- controls keyboard accessible with visible focus order
- health changes announced with debounced polite live region updates
- timestamps consistently formatted and include timezone marker
- stale data state visually distinct from healthy data

## Error Handling

- refresh cycle should tolerate partial failures by retaining last good panel state
- stale indicator shown when data age threshold is exceeded
- existing ingest/replay behavior remains unchanged on transient health-panel fetch failures

## Testing Strategy

`services/web-ui/src/App.test.tsx` will be expanded to cover:

- health strip rendering in normal/degraded/recovering
- stale indicator behavior
- fallback trend/impact panel rendering
- correlated fallback highlighting in timeline
- guided actions persistence/restore from local storage
- no regression of ingest/queue/audit baseline UI elements

Verification gates:

- `npm --prefix services/web-ui test`
- `npm run test:web-ui`
- `npm run test:all`

## Exit Criteria for SERGIO-58

- Operators can detect degraded mode from the UI within one glance
- Impact panel shows fallback count and direction (rising/stable/falling)
- Timeline clearly surfaces fallback-related events among normal audit noise
- Guided actions are usable, persistent across reload, and clearly local-only
- Existing ingest/replay workflow remains unchanged in behavior and discoverability
