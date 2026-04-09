# Storage Processing — CloudEvent publish wiring (Commit 3)

**Status:** Proposed — blocked on event broker availability
**Author:** SpaceHarbor platform
**Created:** 2026-04-09
**Depends on:** `7e83a11`, `3edaa7e`, `3f80813` (Commits 1 & 2 — UI and read-path already live)
**Blocks:** nothing (the feature is purely additive)

## 1. Background

Today the Storage Browser shows a per-row processing status icon and
action button. The icon renders correctly for all four file kinds
(image / video / raw_camera / other). The action button is labeled
contextually ("Process" / "Reprocess" / "Processing…" / "—") but its
`onClick` still fires the legacy `handleIngest` → `POST /assets/upload-url`
path, which only **registers the file as an asset row** — it does **not**
trigger any DataEngine function.

To actually reprocess a file that was placed in the bucket externally
(s3cmd, NFS copy, DaVinci export, VAST Catalog rehydration) or that
pre-dates the trigger, SpaceHarbor must publish a CloudEvents 1.0
message onto the event broker topic that the VMS element trigger
subscribes to. This is the documented VAST reprocess mechanism — there
is no `POST /functions/{guid}/invoke` API (confirmed by vast-platform-engineer
via vast-rag, commit `cd19227` era).

This document is the action plan for wiring the Process button to
that publish path. It is intentionally detailed so the eventual
implementer can work from a single source rather than reconstructing
context from scratch.

## 2. Prerequisites

Must be available before kickoff — **SpaceHarbor cannot implement
around any of these**:

1. **Event broker URL reachable from the control-plane container.**
   Currently `VAST_EVENT_BROKER_URL=` is empty in the deployment's
   `.env` on `10.143.2.102`. Needs a real broker address
   (e.g. `engine-broker.selab.vastdata.com:9092`).
2. **Broker credentials** — SASL username + password + mechanism
   (currently PLAIN). SSL flag.
3. **Two trigger GUIDs from VMS** — one for the image-processing
   element trigger (owner: `oiio-proxy-generator`) and one for the
   video-processing element trigger (owner: `video-proxy-generator`
   + `video-metadata-extractor` co-deployed). Resolvable via
   `GET /api/latest/dataengine/triggers/` once configured.
4. **The broker's topic names for each trigger.** VMS records these
   in `event_notifications[].topic` on the source view. The trigger
   definition names the broker + topic pair the function subscribes to.
5. **Confirmation that the DataEngine function self-guards on
   idempotent reprocess** — i.e., it's safe to publish a synthesized
   `ObjectCreated` event for a file that's already been processed.
   The function should either no-op (if its outputs already exist)
   or overwrite cleanly.

## 3. Goals

1. User clicks **Process** (or **Reprocess**) on a file in the Storage
   Browser → a CloudEvents 1.0 message is published to the correct
   trigger topic → the DataEngine function runs → the row transitions
   from `not_processed` → `processing` → `ready` in the UI.
2. In-flight state survives a browser refresh (read from the
   `processing_requests` table created in migration 015).
3. Completion state closes the loop without polling — the existing
   `VastEventSubscriber` catches the function completion event and
   updates the `processing_requests` row.
4. Multi-select bulk dispatch works with a single backend call that
   fans out to up to 500 CloudEvents.
5. Re-clicking Process while a job is in flight returns HTTP 409
   with the existing `job_id` — no duplicate publishes.
6. Explicit platform-settings config — no auto-discovery of triggers
   by bucket name (footgun per the architect review).

## 4. Non-goals (deferred to later)

- Per-file retry counter + "needs review" 3-strike gate (nice-to-have,
  not blocking).
- Admin "Scan & reconcile" nightly job that walks the bucket for
  unprocessed files — documented separately as Phase 2.
- Telemetry tab deep link from a failed `processing_requests` row to
  the corresponding DataEngine trace.
- Dead-letter queue surface in the UI.

## 5. Architectural summary

Established by the architect review in the `2026-04-09` session:

- **No shared CloudEventFactory with `ChainOrchestrator`.** The audit
  found ChainOrchestrator is dead code in production (never
  instantiated, broker not configured) and its event shape is an
  internal SpaceHarbor loopback, not a VMS element-trigger format.
  Conflating the two would be architecturally wrong.
- **Dedicated helper in a new file**: `services/control-plane/src/events/vms-element-event.ts`
  with a single exported function `buildElementCreatedEvent({ bucket,
  key, triggerName, triggerId })`. Zero dependencies on ChainOrchestrator.
- **Trigger resolution is explicit configuration, not auto-discovery.**
  Platform Settings holds a `processing_triggers` map with two entries:
  ```json
  { "processing_triggers": { "image": "<guid-A>", "video": "<guid-B>" } }
  ```
  The backend resolves which trigger to use from `inferFileKind(filename)`
  (already implemented in `storage-browse.ts`) — images go to trigger A,
  videos + raw camera both go to trigger B (co-deployed functions).
- **The `processing_requests` table from migration 015** (already
  deployed in `7e83a11`) is the dedup + observability primitive. A
  unique partial index on `(s3_bucket, s3_key)` where `status = 'in_progress'`
  enforces "one live request per object."
- **Failure observability via the event subscriber, not polling.**
  `VastEventSubscriber` (already exists but currently gated on the
  empty broker URL) will gain a new handler branch: when it sees a
  DataEngine function completion event whose `data.s3_key` matches
  an `in_progress` row, update the row's status to `completed` or
  `failed` and record any error message.
- **5-minute deadline as the safety net.** If no completion event
  arrives within `deadline_at`, a background sweeper marks the row
  `timed_out`. This covers the case where the function crashes hard
  enough to never publish a completion event.

## 6. Scope — files touched

### 6.1 New files

```
services/control-plane/src/events/vms-element-event.ts
services/control-plane/src/routes/storage-process.ts
services/control-plane/src/persistence/processing-requests.ts
```

- **`vms-element-event.ts`** — pure function `buildElementCreatedEvent`.
  Takes `{ bucket, key, triggerName, triggerId }` and returns the
  exact CloudEvents 1.0 envelope:
  ```yaml
  specversion: "1.0"
  type: "vastdata.com:Element.ObjectCreated"
  source: "vastdata.com:<triggerName>.<triggerId>"
  subject: "vastdata.com:<broker>.<topic>"   # REQUIRED — the subscriber crashes without it
  id: <uuid>
  time: <RFC3339>
  datacontenttype: "application/json"
  data:
    s3_bucket: <bucket>
    s3_key: <key>
  ```
  **Broker/topic come from Platform Settings**, not derived from the
  trigger id. The trigger config in settings holds the full tuple.
  No VMS REST call at request time.

- **`storage-process.ts`** — new route file registering
  `POST /storage/process` and `GET /storage/process/:jobId`.
  Owns the handler orchestration: resolve trigger → insert
  `processing_requests` row → publish CloudEvent → return job id.
  Error handling: 409 on dup, 503 if broker down, 400 on invalid input,
  500 on publish failure (roll back the row).

- **`processing-requests.ts`** — persistence helper backed by the
  vastdb SDK (not the persistence adapter interface, at least not
  yet — the adapter pattern is for cross-backend swap, and this table
  is deliberately VAST-DB-only since the in-flight state is ephemeral).
  Exports:
  ```ts
  insertProcessingRequest({ s3_bucket, s3_key, requested_by, deadline_ms }): Promise<{ job_id: string } | { conflict: { existing_job_id: string } }>
  findProcessingRequest(s3_bucket, s3_key): Promise<Row | null>
  findProcessingRequestByJobId(job_id): Promise<Row | null>
  updateProcessingRequestStatus(job_id, { status, completed_at, error_message }): Promise<void>
  findTimedOutRequests(now: Date): Promise<Row[]>
  batchFindByKeys(bucket, keys: string[]): Promise<Map<string, Row>>  // for status endpoint
  ```
  The batch lookup is what `/storage/processing-status` will call to
  populate the `in_flight_job_id`, `last_status`, and `last_error`
  fields (all currently hardcoded to null).

### 6.2 Modified files

```
services/control-plane/src/routes/platform-settings.ts
services/control-plane/src/routes/storage-browse.ts
services/control-plane/src/events/vast-event-subscriber.ts
services/control-plane/src/app.ts
services/web-ui/src/pages/SettingsPage.tsx
services/web-ui/src/pages/StorageBrowserPage.tsx
services/web-ui/src/api.ts
```

- **`platform-settings.ts`**:
  - Extend `PlatformSettings.processingTriggers` shape:
    ```ts
    processingTriggers: {
      image: { triggerId: string; triggerName: string; broker: string; topic: string } | null;
      video: { triggerId: string; triggerName: string; broker: string; topic: string } | null;
    }
  - Add `getProcessingTrigger(fileKind: "image" | "video"): ProcessingTrigger | null`.
  - New section in the settings GET/POST handlers. Round-trip the
    full config; the broker URL + SASL live in env vars (not settings)
    because they're deployment-level.
  - Expand the DataEngine "Test Connection" probe to also verify the
    two trigger IDs exist via `GET /triggers/:guid` — similar pattern
    to the `X-Tenant-Name` probe added in `cd19227`.

- **`storage-browse.ts`**:
  - `/storage/processing-status` handler: after the HEAD checks, call
    `batchFindByKeys()` to populate `in_flight_job_id`, `last_status`,
    and `last_error` from the `processing_requests` table. Today those
    fields are always null — this is the only change here.

- **`vast-event-subscriber.ts`**:
  - In the `eachMessage` handler, after the existing
    `processAssetEvent` call, add a new branch: if the message is a
    function completion event and `data.s3_bucket + data.s3_key` match
    an `in_progress` `processing_requests` row, call
    `updateProcessingRequestStatus(job_id, { status: success ? "completed" : "failed", completed_at: now, error_message })`.
  - No changes to the existing chain-orchestrator / asset-metadata
    path — that code is unaffected.

- **`app.ts`**:
  - Register `registerStorageProcessRoutes(app, prefixes, ...)` alongside
    the existing `registerStorageBrowseRoutes`.
  - Start a background `setInterval` sweeper that calls
    `findTimedOutRequests(now)` every 60s and marks them `timed_out`.
    The interval is cancelled on app shutdown.
  - Ensure the Kafka producer is constructed once at startup (next to
    the existing consumer construction) and passed to the
    `storage-process.ts` route registration.

- **`SettingsPage.tsx`**:
  - New "Processing Triggers" section under "VAST DataEngine" card.
    Two input groups — one for image, one for video — each with:
    `triggerId`, `triggerName`, `broker`, `topic`. Save round-trips
    through the existing platform-settings PUT endpoint.
  - Inline "Probe" button per trigger that calls a new
    `POST /platform/settings/process-trigger/test` endpoint to verify
    VMS returns the trigger by id. Green/red badge.

- **`StorageBrowserPage.tsx`**:
  - Swap the Process button's `onClick={handleIngest}` for
    `onClick={handleProcess}` where `handleProcess` calls a new
    `requestProcessing(sourceUri)` API helper that hits
    `POST /storage/process`.
  - Transient state: optimistically set `statusByUri` for the file
    to `in_flight_job_id = <pending>` so the row immediately shows
    the spinner while the backend round-trips.
  - Handle 409 (already in flight) by showing a toast with the
    existing job id and preserving the spinner state.
  - Add a multi-select checkbox per row (reuse the selection pattern
    from `AssetBrowser.tsx`) and a top-bar "Process selected (N)"
    button that fires the bulk endpoint in chunks of 500.
  - Poll `/storage/processing-status` every 15s while any visible
    row is `processing` — stops polling when none remain in-flight.

- **`api.ts`**:
  - New `requestProcessing(sourceUri: string): Promise<{ job_id: string } | { conflict: { existing_job_id: string } }>`
  - New `requestProcessingBatch(sourceUris: string[]): Promise<{ jobs: Array<{ sourceUri: string; job_id: string | null; error?: string }> }>`
  - New `getProcessingJob(jobId: string): Promise<ProcessingJob | null>`

### 6.3 No changes

- `ChainOrchestrator` stays untouched (confirmed dead in production).
- `confluent-kafka.ts` producer factory is already implemented;
  just needs to be instantiated at startup.
- `storage-browse.ts`'s file kind inference (`inferFileKind`) is
  the single source of truth — both the new process route and the
  existing status endpoint import from it. DO NOT duplicate the
  extension sets.
- No web-ui dependencies added (no new npm packages).

## 7. Implementation order

Six discrete steps, each independently revertible:

1. **Platform Settings — store + retrieve `processingTriggers`**
   Zero behavior change. Round-trip works via settings UI; nothing
   consumes the values yet. Commit and ship.

2. **Event broker startup — producer singleton + bootstrap**
   Construct the producer at app startup (gated on `VAST_EVENT_BROKER_URL`
   being set, same guard the existing consumer uses). Log a startup
   message. No routes yet. Verifies the broker is reachable without
   touching any user-facing code.

3. **`processing_requests` persistence helper** (read-only portion)
   Ship `findProcessingRequest`, `batchFindByKeys`, and wire them into
   `/storage/processing-status` so the status endpoint starts
   populating `in_flight_job_id` / `last_status` / `last_error` from
   the table (still empty — but the code path is proven).

4. **`vms-element-event.ts` + unit tests**
   Pure function. Unit test against the exact schema from the VAST
   docs. No runtime integration yet.

5. **`POST /storage/process` — single-file dispatch**
   Insert row → publish event → return job id. Wire the Process
   button in the UI to call it. Verify end-to-end with one file.
   No bulk, no sweeper yet.

6. **Loop-close — subscriber handler + sweeper + bulk + retry UX**
   Add the completion handler to `VastEventSubscriber`, the 60s
   sweeper in `app.ts`, the multi-select bulk button, and the retry
   semantics for `failed` rows. This is the biggest step; ship
   behind a feature flag if it feels risky.

Each step compiles and passes tests independently. No step is blocking
on a later step being present.

## 8. Configuration surface

New env vars (optional — fallback defaults listed):

| Var | Purpose | Default |
|---|---|---|
| `SPACEHARBOR_PROCESSING_REQUEST_DEADLINE_SEC` | How long before a row is marked `timed_out` | 300 |
| `SPACEHARBOR_PROCESSING_SWEEPER_INTERVAL_SEC` | How often the sweeper runs | 60 |
| `SPACEHARBOR_PROCESSING_BULK_CAP` | Max sourceUris per bulk dispatch | 500 |

New Platform Settings fields (stored in `operational.json`):

```json
{
  "processingTriggers": {
    "image": {
      "triggerId": "…",
      "triggerName": "image-processing",
      "broker": "engine-broker",
      "topic": "main"
    },
    "video": {
      "triggerId": "…",
      "triggerName": "video-processing",
      "broker": "engine-broker",
      "topic": "video"
    }
  }
}
```

## 9. Testing strategy

### 9.1 Unit tests

- `vms-element-event.ts` — schema match against a frozen fixture
  taken from the VAST docs. Include a test that `subject` is
  always present (the subscriber crashes without it).
- `processing-requests.ts` — dedup semantics with a mocked vastdb
  client. Insert twice for the same `(bucket, key)` while first
  is `in_progress` → second returns conflict. Insert twice when
  first is `completed` → both succeed (reprocess is allowed).
- `deriveDisplayState` already tested; extend with cases for
  `in_flight_job_id` non-null in each file kind.

### 9.2 Integration tests

- `POST /storage/process` happy path — insert row, publish, return
  job id. Assert the Kafka producer was called with the right topic
  and payload.
- `POST /storage/process` conflict path — second call returns 409
  with the existing job id.
- `VastEventSubscriber` completion handler — construct a fake
  completion event, assert the row transitions to `completed`.
- Sweeper — insert a row with `deadline_at` in the past, run the
  sweeper, assert `timed_out`.

### 9.3 End-to-end on the dev cluster

1. Put a fresh EXR into `s3://sergio-spaceharbor/` via s3cmd (not
   SpaceHarbor upload — the element trigger must not have fired).
2. Open Storage Browser → row shows `not_processed`.
3. Click Process → row shows `processing` spinner.
4. Wait for function completion → row transitions to `ready` with
   artifacts visible.
5. Reopen the browser tab → state persists (read from
   `processing_requests`).

## 10. Risks

- **Trigger GUID drift**: if someone deletes and recreates the
  trigger in VMS, SpaceHarbor's stored config goes stale. Mitigation:
  the "Probe" button in Platform Settings validates on demand; add
  a startup probe that logs a warning if either trigger GUID fails
  to resolve.
- **Completion event never arrives**: covered by the 5-minute
  `deadline_at` sweeper. The row transitions to `timed_out` and the
  UI shows a retry affordance.
- **DataEngine function doesn't self-guard on reprocess**: would
  cause duplicate artifacts. The user's section-2 prerequisite asks
  the functions team to confirm idempotency before we ship. If the
  answer is "no," SpaceHarbor can add a pre-publish check for
  existing artifacts and return 409 with a "already processed" error
  — but that's a backup plan, not the primary design.
- **Kafka producer memory leak on errors**: the confluent client
  requires explicit disconnect. Ensure the producer is a singleton
  with a graceful shutdown hook in `app.ts`.
- **VMS tenant header on broker operations?** Unknown whether the
  broker itself enforces the `X-Tenant-Name` header or if that's
  only a VMS REST concern. Verify during step 2 of the implementation
  order.

## 11. Exit criteria

- User can click Process on an unprocessed file and see it transition
  to `ready` without manually refreshing.
- Multi-select + Process selected dispatches a bulk of ≥ 10 files
  and all transition to `ready` within the expected window.
- `processing_requests` table reflects the full lifecycle: the UI
  status endpoint surfaces `in_flight_job_id` during processing and
  `last_status=completed` afterward.
- `/platform/settings/test-connection` for `data_engine` validates
  both trigger GUIDs (not just VMS auth) and fails loudly on mismatch.
- Nothing in the existing DataEngine / Assets / Settings / Preview
  surfaces regresses. In particular, the Frame.io preview continues
  to render correctly for files with `_proxy.jpg` and `_thumb.jpg`,
  and the DataEngine tab list views keep working.
- ChainOrchestrator and the existing `VastEventSubscriber.start()`
  path are untouched except for the new completion handler branch.

## 12. Out of scope / follow-ups

- **Scan & reconcile nightly job** (architect's Phase 4) — walks the
  bucket, enqueues anything missing artifacts. Same dispatch path
  as the manual Process button; just a different caller with an
  internal service token. Separate commit after this one lands.
- **Retry-with-backoff for failed rows** — today "Reprocess" on a
  failed row fires immediately. A 3-strike gate + exponential
  backoff is a later polish.
- **Per-tenant multi-bucket config** — today the trigger config is
  global (one image trigger, one video trigger for the whole
  deployment). If a customer ever needs bucket-scoped triggers, add
  a `perBucket` override map in settings. Not needed for v1.

---

**Review and approval**: once the five prerequisites in §2 are
available, this plan can be worked through in about one focused
session. No new dependencies, no new migrations beyond what's
already in `7e83a11`.
