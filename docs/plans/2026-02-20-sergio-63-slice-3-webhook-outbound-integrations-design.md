# SERGIO-63 Slice 3: Webhook Outbound Integrations Design

## Context

Slices 1-2 established review/QC lifecycle and annotation/preview metadata readiness. Slice 3 adds operational integrations using webhook-only outbound adapters without introducing vendor SDK coupling.

## Scope (Slice 3)

- Add webhook-based outbound notifications for Slack/Teams-style channels and ShotGrid/ftrack-style production systems.
- Reuse current outbox-driven publish model.
- Add payload signing and integration delivery observability.

## Out of Scope

- Vendor SDK integration (Slack bot API, Teams Graph SDK, ShotGrid/ftrack clients).
- Bi-directional sync or inbound webhook processing.
- Workflow contract breaking changes.

## Goals

- Deliver integration value quickly with low implementation risk.
- Preserve retry/idempotency semantics through existing outbox pipeline.
- Provide signed payloads and auditable delivery outcomes.

## Architecture

Introduce a bounded outbound integration layer in control-plane:

- `OutboundNotifier` interface: accepts normalized outbox event and target config.
- `WebhookOutboundNotifier` implementation: HTTP POST JSON + HMAC signature header.
- `OutboundPayloadMapper`: maps internal outbox items to target-specific payload shape.

Targets in this slice:

- `slack`
- `teams`
- `production` (ShotGrid/ftrack-style generic event feed)

All targets use webhook transport in Slice 3.

## Data Flow

1. Workflow transitions enqueue outbox events (existing behavior).
2. Outbox publish step resolves configured target(s) for each event type.
3. Payload mapper emits normalized body:
   - `eventType`, `occurredAt`, `correlationId`
   - `assetId`, `jobId`, `status`, `summary`
   - `target`, `schemaVersion`
4. Notifier signs body and sends POST request.
5. Success marks outbox item published; failure keeps item pending and records audit signal.

## Configuration Strategy

Environment-driven config:

- `ASSETHARBOR_WEBHOOK_SLACK_URL`
- `ASSETHARBOR_WEBHOOK_TEAMS_URL`
- `ASSETHARBOR_WEBHOOK_PRODUCTION_URL`
- `ASSETHARBOR_WEBHOOK_SIGNING_SECRET`
- optional strict mode gate to fail startup if required integration config is missing.

Non-strict behavior: missing target config means skip that target, emit audit warning.

## Security and Reliability

- Sign payload with HMAC SHA-256 header (`x-assetharbor-signature`).
- Include timestamp header to support replay protection downstream (`x-assetharbor-timestamp`).
- On transient HTTP/network failures, preserve pending outbox item for retry.
- Maintain deterministic audit entries for success/failure per target.

## API/Contract Impact

- No breaking API changes.
- Existing endpoints and response envelopes remain stable.
- Optional metrics counters added for observability.

## Metrics and Observability

Add counters by target:

- `outboundAttempts`
- `outboundSuccess`
- `outboundFailure`

Expose in existing metrics response as additive fields.

## Testing Strategy

- Unit tests:
  - payload mapping for each target
  - signature generation format
- Integration tests:
  - successful webhook publish marks item published
  - failed publish retains pending status and increments failure counters
- Contract tests:
  - no regression in existing API schemas
  - additive metrics fields if introduced
- Full verification:
  - `npm run test:all`

## Acceptance Criteria

- Webhook outbound notifications work for configured targets.
- Failure path retries through existing outbox mechanism.
- Signed payload headers are present and deterministic.
- Existing workflow and API contracts remain backward compatible.
