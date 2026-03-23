# ADR-001: Why VAST-Native (Element Handles over File Paths)

**Status:** Accepted
**Date:** 2026-03-02

## Context

Traditional media asset management systems reference files by filesystem paths (UNC, NFS mount points, S3 URIs). When files are moved, renamed, archived, or restored, these path references break — a problem known industry-wide as "broken links." This is the single largest source of data management failures in post-production pipelines.

VAST Data's platform provides **Element handles** — immutable identifiers bound to data objects at the storage layer. An Element handle stays valid regardless of where the file physically resides, what protocol accesses it, or how many copies exist.

## Decision

SpaceHarbor uses VAST Element handles as the primary key for all file references. Asset records never store filesystem paths; they store Element handles. All metadata in the VAST Catalog is keyed off Element handles, not paths.

This means:
- `asset.element_handle` is the canonical file reference (not `asset.path`).
- Metadata queries join on Element handle, not on path prefix.
- File movement, copying, and archival do not invalidate any metadata relationships.

## Consequences

**Benefits:**
- Eliminates "broken links" — the #1 pain point in VFX asset management.
- Files can be freely moved across tiers (hot/warm/cold) without metadata updates.
- Multi-protocol access (NFS, SMB, S3) to the same data with one consistent identifier.
- Future-proof: new access protocols don't require migration.

**Trade-offs:**
- Tight coupling to the VAST platform. Migrating away from VAST would require a mapping layer from Element handles back to paths.
- Development and testing without a VAST cluster requires a local fallback adapter that simulates Element handles (see ADR-003).
- Element handles are opaque — operators cannot infer file location from the handle alone. Tooling must resolve handles to paths when needed.
