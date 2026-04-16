# Load test baseline — k6

Baseline throughput + latency numbers for SpaceHarbor control-plane,
captured against the dev cluster at `10.143.2.102`.

## Why this exists

The MAM readiness review (Phase 3 of the roadmap) called for a k6 baseline
so capacity-planning conversations have concrete numbers. Without a
baseline, any "is it fast enough?" question becomes a debate about feel.

## What we measure

Three scripts — each exercises a different layer of the stack:

| Script          | Exercises                                 | Bottleneck we expect |
|-----------------|-------------------------------------------|-----------------------|
| `health.js`     | Fastify handler + no-op response          | TCP + router          |
| `list-assets.js`| DB read + pagination + JSON serialization | in-memory / Trino     |
| `checkin.js`    | S3 multipart reserve + commit round-trip  | VAST S3 throughput    |

## How to run

Install k6:

    brew install k6       # macOS
    # or see https://k6.io/docs/getting-started/installation/

Run against the dev cluster:

    export SPACEHARBOR_URL=http://10.143.2.102:8080
    export SPACEHARBOR_TOKEN="$(curl -s -X POST -H 'content-type: application/json' \
        -d '{"email":"admin@spaceharbor.dev","password":"Vastdata2026"}' \
        $SPACEHARBOR_URL/api/v1/auth/login | jq -r .accessToken)"

    k6 run tests/load/health.js
    k6 run tests/load/list-assets.js
    k6 run tests/load/checkin.js

Each script ends with a `check()` block that fails the run if p95 is
above the agreed threshold. Bumping thresholds requires a team
conversation — they represent the documented SLO, not a CI tripwire.

## Current baseline (2026-04-16)

Measured on the dev cluster `10.143.2.102` running a single
control-plane replica with `SPACEHARBOR_BACKGROUND_WORKER=true` and
`SPACEHARBOR_PERSISTENCE_BACKEND=local`. Numbers will shift once Phase 3
completes the persistence split and adds Trino-backed reads.

| Endpoint             | p50   | p95   | p99   | req/s |
|----------------------|-------|-------|-------|-------|
| `GET /health`        | TBD   | TBD   | TBD   | TBD   |
| `GET /api/v1/assets` | TBD   | TBD   | TBD   | TBD   |
| `POST /assets/checkin` (reserve only, 1 file / 3 parts) | TBD | TBD | TBD | TBD |

Run the scripts and commit the numbers as part of the release cycle —
regressions get caught before they hit customers.
