/**
 * Audit chain helpers.
 *
 * Every audit row carries `prev_hash` (the previous row's rowHash) and
 * `row_hash` (sha256 of the canonical JSON of this row with prev_hash
 * included). Any tampering with a middle row breaks every subsequent
 * rowHash, so verification is a single linear scan.
 *
 * canonical_json: JSON.stringify with sorted keys. That's what we hash —
 * the payload reproducibility is what makes the chain verifiable across
 * language/runtime boundaries.
 */

import { createHash } from "node:crypto";
import type { AuditEvent } from "../domain/models.js";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

/**
 * Compute sha256 over the canonical JSON of an audit row.
 * Accepts any object; sorts keys deterministically to produce a stable
 * digest regardless of JS property insertion order.
 */
export function hashAuditRow(row: Omit<AuditEvent, "rowHash"> | Record<string, unknown>): string {
  const canonical = canonicalize(row);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Stable JSON serialization — sorts object keys at every depth.
 * Arrays preserve order (semantic). Primitives pass through.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface AuditChainVerification {
  valid: boolean;
  /** Number of rows scanned. */
  scanned: number;
  /** Number of rows that failed their hash check. */
  brokenCount: number;
  /** IDs of rows with invalid hashes. */
  brokenIds: string[];
  /** ID of the first row that broke the chain (earliest in time). */
  firstBrokenId: string | null;
}

/**
 * Verify a chain of audit events. Expects oldest-first order (so prev_hash
 * of index i refers to rowHash of index i-1). The in-memory store keeps
 * rows newest-first, so callers should reverse before passing in.
 */
export function verifyAuditChain(
  eventsOldestFirst: AuditEvent[],
): AuditChainVerification {
  let expectedPrev = AUDIT_GENESIS_HASH;
  const brokenIds: string[] = [];

  for (const event of eventsOldestFirst) {
    // If a row is missing hash fields, treat it as pre-chain (e.g.
    // migrated data from before this feature shipped). Don't fail the
    // chain — just treat its declared prevHash as authoritative going
    // forward.
    if (!event.rowHash) {
      expectedPrev = AUDIT_GENESIS_HASH;
      continue;
    }
    if (event.prevHash !== expectedPrev) {
      brokenIds.push(event.id);
    }
    const recomputed = hashAuditRow({
      id: event.id,
      message: event.message,
      at: event.at,
      ...(event.signal ? { signal: event.signal } : {}),
      prevHash: event.prevHash,
    });
    if (recomputed !== event.rowHash) {
      if (!brokenIds.includes(event.id)) brokenIds.push(event.id);
    }
    expectedPrev = event.rowHash;
  }

  return {
    valid: brokenIds.length === 0,
    scanned: eventsOldestFirst.length,
    brokenCount: brokenIds.length,
    brokenIds,
    firstBrokenId: brokenIds[0] ?? null,
  };
}
