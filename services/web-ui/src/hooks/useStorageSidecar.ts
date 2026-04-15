/**
 * useStorageSidecar — lazily fetch the `_metadata.json` sidecar for an asset.
 *
 * Reads the control-plane `/storage/metadata` route and exposes the result
 * with cache + in-flight dedup + unmount cancellation, so a presentation
 * component (e.g. `AssetMetadataPanel`) can stay pure and the data layer
 * lives in one place.
 *
 * Behavior:
 *   - Returns `{ sidecar: null, loading: false }` when `sourceUri` is empty
 *     or the file kind is `"none"` (pdf, txt, etc.) — never issues a fetch.
 *   - Caches successful responses per sourceUri with a configurable TTL
 *     (default 60s). Repeated mounts within the window hit the cache.
 *   - Dedupes concurrent fetches — two hooks mounting with the same
 *     sourceUri share a single in-flight promise.
 *   - Cancels the state update on unmount via a mounted-ref (AbortController
 *     would also abort other subscribers due to in-flight dedup, so we
 *     rely on the component-level cancellation flag instead).
 *
 * Cache lifetime is process-local; it clears on page reload.
 */

import { useEffect, useState } from "react";

import {
  ApiRequestError,
  fetchStorageMetadata,
  type StorageMetadataResponse,
} from "../api";
import { createLogger } from "../utils/logger";
import { metadataKindForFilename } from "../utils/metadata-routing";

const log = createLogger("hooks/useStorageSidecar");

export interface UseStorageSidecarResult {
  sidecar: StorageMetadataResponse | null;
  loading: boolean;
  error: ApiRequestError | null;
}

interface CacheEntry {
  data: StorageMetadataResponse | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StorageMetadataResponse | null>>();

let cacheTtlMs = 60_000;

export function __setSidecarCacheTtlForTests(ttlMs: number): void {
  cacheTtlMs = ttlMs;
}

export function __resetSidecarCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  cacheTtlMs = 60_000;
}

const lastSegment = (sourceUri: string): string => {
  const slash = sourceUri.lastIndexOf("/");
  return slash === -1 ? sourceUri : sourceUri.substring(slash + 1);
};

function isEligible(sourceUri: string): boolean {
  if (!sourceUri) return false;
  const kind = metadataKindForFilename(lastSegment(sourceUri));
  // Both image and video pipelines write `_metadata.json` sidecars now —
  // image via frame-metadata-extractor, video via video-metadata-extractor.
  // `metadataKindForFilename` returns "video" for raw camera formats too
  // (R3D/BRAW) since they share the video-metadata-extractor, and "none"
  // for formats the pipeline does not process.
  return kind === "image" || kind === "video";
}

async function runFetch(sourceUri: string): Promise<StorageMetadataResponse | null> {
  const existing = inFlight.get(sourceUri);
  if (existing) return existing;

  const promise = fetchStorageMetadata(sourceUri).then(
    (data) => {
      cache.set(sourceUri, { data, expiresAt: Date.now() + cacheTtlMs });
      inFlight.delete(sourceUri);
      return data;
    },
    (err: unknown) => {
      inFlight.delete(sourceUri);
      throw err;
    },
  );
  inFlight.set(sourceUri, promise);
  return promise;
}

export function useStorageSidecar(sourceUri: string | undefined | null): UseStorageSidecarResult {
  const [state, setState] = useState<UseStorageSidecarResult>({
    sidecar: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const uri = sourceUri ?? "";
    if (!isEligible(uri)) {
      setState({ sidecar: null, loading: false, error: null });
      return;
    }

    // Cache hit?
    const cached = cache.get(uri);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ sidecar: cached.data, loading: false, error: null });
      return;
    }

    let alive = true;
    setState({ sidecar: null, loading: true, error: null });
    runFetch(uri).then(
      (data) => {
        if (!alive) return;
        setState({ sidecar: data, loading: false, error: null });
      },
      (err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiRequestError) {
          log.warn("sidecar fetch failed", { sourceUri: uri, status: err.status });
          setState({ sidecar: null, loading: false, error: err });
        } else {
          log.error("sidecar fetch threw non-Api error", { error: String(err) });
          setState({ sidecar: null, loading: false, error: new ApiRequestError(0, String(err)) });
        }
      },
    );

    return () => { alive = false; };
  }, [sourceUri]);

  return state;
}
