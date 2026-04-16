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
`SPACEHARBOR_PERSISTENCE_BACKEND=local`. Ran each script for ~50 s with
the VU ramp in the script. Numbers will shift once Phase 3 completes
the persistence split and adds Trino-backed reads.

| Endpoint                                   | p50     | p95     | max     | req/s  | failures |
|--------------------------------------------|---------|---------|---------|--------|----------|
| `GET /health`                              | 1.38 ms | 3.46 ms | 21.5 ms | 232/s  | 0%       |
| `GET /api/v1/assets?limit=50`              | 1.65 ms | 3.06 ms | 13.7 ms | 58/s   | 0%       |
| `POST /assets/checkin` (reserve+abort, single-file, 2 parts) | 18.9 ms | 32.9 ms | 43.0 ms | 9.3/s | 0%       |

Observations:
- Health and list both sit comfortably under 5 ms p95 — the Fastify +
  route layer isn't the bottleneck.
- Checkin is dominated by two S3 round-trips (CreateMultipartUpload +
  AbortMultipartUpload) to the VAST cluster, which accounts for ~20 ms.
  Real commits do ONE S3 round-trip per part, so a multi-part upload is
  linear in part count.
- Zero failed requests across 15 000+ iterations — the circuit breakers
  never opened.

Run the scripts and commit the numbers as part of the release cycle —
regressions get caught before they hit customers.
