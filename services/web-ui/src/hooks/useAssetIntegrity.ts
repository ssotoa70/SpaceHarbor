/**
 * 60s-TTL cache around GET /assets/:id/integrity.
 * Mirrors the shape of useAssetMetadata; surfaces hashes + keyframes for the
 * INTEGRITY tab on AssetDetailPanel.
 *
 * Spec: docs/plans/phase-6.0-asset-integrity (Task D5).
 */
import { useEffect, useState } from "react";

import { fetchAssetIntegrity, type AssetIntegrityResponse } from "../api";

const TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  data?: AssetIntegrityResponse;
  error?: string;
}

const cache = new Map<string, CacheEntry>();

export function __resetAssetIntegrityCacheForTests(): void {
  cache.clear();
}

export type AssetIntegrityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AssetIntegrityResponse }
  | { status: "error"; error: string };

export function useAssetIntegrity(
  assetId: string | null,
): AssetIntegrityState & { retry: () => void } {
  const [state, setState] = useState<AssetIntegrityState>(() =>
    assetId ? { status: "loading" } : { status: "idle" },
  );

  useEffect(() => {
    if (!assetId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    const now = Date.now();
    const cached = cache.get(assetId);
    if (cached && now - cached.at < TTL_MS && cached.data) {
      setState({ status: "ready", data: cached.data });
      return;
    }
    setState({ status: "loading" });
    fetchAssetIntegrity(assetId).then(
      (data) => {
        cache.set(assetId, { at: Date.now(), data });
        if (!cancelled) setState({ status: "ready", data });
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        cache.set(assetId, { at: Date.now(), error: msg });
        if (!cancelled) setState({ status: "error", error: msg });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const retry = (): void => {
    if (!assetId) return;
    cache.delete(assetId);
    setState({ status: "loading" });
    fetchAssetIntegrity(assetId).then(
      (data) => {
        cache.set(assetId, { at: Date.now(), data });
        setState({ status: "ready", data });
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        cache.set(assetId, { at: Date.now(), error: msg });
        setState({ status: "error", error: msg });
      },
    );
  };

  return { ...state, retry };
}
