/**
 * 60s-TTL cache around GET /assets/:id/metadata.
 * Mirrors the shape of useStorageSidecar but targets the unified endpoint.
 * Spec: docs/superpowers/specs/2026-04-16-asset-metadata-db-reader-design.md
 */
import { useEffect, useState } from "react";

import { fetchAssetMetadata, type AssetMetadataResponse } from "../api";

const TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  data?: AssetMetadataResponse;
  error?: string;
  promise?: Promise<void>;
}

const cache = new Map<string, CacheEntry>();

export function __resetAssetMetadataCacheForTests(): void {
  cache.clear();
}

export type AssetMetadataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AssetMetadataResponse }
  | { status: "error"; error: string };

export function useAssetMetadata(assetId: string | null): AssetMetadataState & { data?: AssetMetadataResponse; error?: string } {
  const [state, setState] = useState<AssetMetadataState>(() =>
    assetId ? { status: "loading" } : { status: "idle" }
  );

  useEffect(() => {
    if (!assetId) {
      setState({ status: "idle" });
      return;
    }

    const now = Date.now();
    const cached = cache.get(assetId);
    if (cached && now - cached.at < TTL_MS) {
      if (cached.data) {
        setState({ status: "ready", data: cached.data });
        return;
      }
      if (cached.error) {
        setState({ status: "error", error: cached.error });
        return;
      }
    }

    setState({ status: "loading" });
    let cancelled = false;

    const promise = fetchAssetMetadata(assetId)
      .then((data) => {
        cache.set(assetId, { at: Date.now(), data });
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        cache.set(assetId, { at: Date.now(), error: msg });
        if (!cancelled) setState({ status: "error", error: msg });
      });
    cache.set(assetId, { at: now, promise });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // Flatten so callers can destructure `data`/`error` without switching on status.
  if (state.status === "ready") return { ...state, data: state.data };
  if (state.status === "error") return { ...state, error: state.error };
  return state;
}
