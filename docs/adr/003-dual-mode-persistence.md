# ADR-003: Why Dual-Mode Persistence (Dev Fallback Strategy)

**Status:** Accepted
**Date:** 2026-03-02

## Context

SpaceHarbor's production persistence layer uses VAST Database (via Trino-compatible SQL). However, developers need to run the system locally without access to a VAST cluster for frontend development, testing, and rapid iteration.

Three options were considered:

1. **Require a VAST cluster for all development** — high friction, blocks contributors without VAST access.
2. **Use a local SQL database (PostgreSQL/SQLite) as a dev substitute** — requires maintaining two SQL dialects.
3. **Dual-mode persistence with a `PersistenceAdapter` interface** — production uses `VastPersistenceAdapter` (VAST Database), development uses `LocalPersistenceAdapter` (in-memory).

## Decision

SpaceHarbor implements a `PersistenceAdapter` interface with two implementations:

- **`LocalPersistenceAdapter`:** In-memory Maps for development. Zero external dependencies.
- **`VastPersistenceAdapter`:** VAST Database (via Trino) SQL queries for production. Supports CAS (compare-and-swap) for optimistic concurrency.

The active adapter is selected by `SPACEHARBOR_PERSISTENCE_BACKEND` (default: `local`).

When `SPACEHARBOR_VAST_FALLBACK_TO_LOCAL=true`, the VAST adapter automatically falls back to local behavior if VAST Database is unreachable. Fallback events are surfaced in the audit log with `VAST_FALLBACK` signal codes.

## Consequences

**Benefits:**
- Zero-friction local development — `docker compose up` works without any VAST credentials.
- CI/CD runs all tests without VAST infrastructure.
- Fallback mode provides continuity during VAST outages (degraded but functional).
- Single interface ensures both adapters implement the same contract.

**Trade-offs:**
- `LocalPersistenceAdapter` does not enforce SQL semantics (no transactions, no constraints). Bugs that only manifest under VAST Database may not surface in local mode.
- Fallback mode hides VAST failures — operators must monitor for `VAST_FALLBACK` signals to detect degraded state.
- Maintaining two adapter implementations doubles the surface area for persistence bugs.
- In-memory state is lost on restart in local mode (acceptable for dev, not for production).
