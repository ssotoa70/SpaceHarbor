/**
 * useDataEnginePipelines — fetch the live DataEngine pipeline routing table.
 *
 * Calls `GET /api/v1/dataengine/pipelines/active` and caches the result
 * in a module-level store with a configurable TTL (default 5 minutes).
 * The pipeline list is global — not per-asset — so there is one cache
 * slot shared by every consumer in the app. Concurrent mounts share a
 * single in-flight fetch.
 *
 * Every component that used to reference a hardcoded function name,
 * hardcoded extension list, or hardcoded DB schema now reads from this
 * hook instead. When the admin changes Settings, the next mount (or
 * cache expiry) picks up the new list automatically.
 *
 * Also exports pure helper functions that accept the pipelines array
 * and look up by criteria (fileKind, extension, sidecar schema id). The
 * helpers are pure so they can be called from non-React code or tested
 * in isolation.
 */

import { useEffect, useState } from "react";

import {
  ApiRequestError,
  fetchActiveDataEnginePipelines,
  type DiscoveredPipeline,
  type PipelineFileKind,
} from "../api";
import { createLogger } from "../utils/logger";

const log = createLogger("hooks/useDataEnginePipelines");

export interface UseDataEnginePipelinesResult {
  pipelines: DiscoveredPipeline[];
  loading: boolean;
  error: ApiRequestError | null;
  /** Manually re-fetch, bypassing the cache. */
  refresh: () => void;
}

interface CacheEntry {
  data: DiscoveredPipeline[];
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<DiscoveredPipeline[]> | null = null;
let cacheTtlMs = 5 * 60_000; // 5 minutes — pipelines rarely change

/** Test-only helpers. Not part of the public API. */
export function __setPipelineCacheTtlForTests(ttlMs: number): void {
  cacheTtlMs = ttlMs;
}
export function __resetPipelineCacheForTests(): void {
  cache = null;
  inFlight = null;
  cacheTtlMs = 5 * 60_000;
}

async function runFetch(force: boolean): Promise<DiscoveredPipeline[]> {
  const existing = inFlight;
  if (existing && !force) return existing;

  const promise = fetchActiveDataEnginePipelines({ force })
    .then((response) => {
      cache = { data: response.pipelines, expiresAt: Date.now() + cacheTtlMs };
      inFlight = null;
      return response.pipelines;
    })
    .catch((err: unknown) => {
      inFlight = null;
      throw err;
    });
  inFlight = promise;
  return promise;
}

export function useDataEnginePipelines(): UseDataEnginePipelinesResult {
  const [state, setState] = useState<UseDataEnginePipelinesResult>(() => {
    // If cache is warm, expose it synchronously on first render
    if (cache && cache.expiresAt > Date.now()) {
      return {
        pipelines: cache.data,
        loading: false,
        error: null,
        refresh: () => {}, // replaced in effect
      };
    }
    return { pipelines: [], loading: true, error: null, refresh: () => {} };
  });

  useEffect(() => {
    let alive = true;

    const doFetch = (force: boolean) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      runFetch(force).then(
        (data) => {
          if (!alive) return;
          setState({ pipelines: data, loading: false, error: null, refresh });
        },
        (err: unknown) => {
          if (!alive) return;
          if (err instanceof ApiRequestError) {
            log.warn("pipelines fetch failed", { status: err.status });
            setState({ pipelines: [], loading: false, error: err, refresh });
          } else {
            log.error("pipelines fetch threw non-Api error", { error: String(err) });
            setState({
              pipelines: [],
              loading: false,
              error: new ApiRequestError(0, String(err)),
              refresh,
            });
          }
        },
      );
    };

    const refresh = (): void => doFetch(true);

    // Use cache if still warm — expose the refresh fn either way
    if (cache && cache.expiresAt > Date.now()) {
      setState({ pipelines: cache.data, loading: false, error: null, refresh });
      return () => { alive = false; };
    }

    doFetch(false);
    return () => { alive = false; };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Pure helpers — accept the pipelines array and look up by criteria.
// Exported separately so they can be called from non-React code.
// ---------------------------------------------------------------------------

/** Find the pipeline that handles the given file kind (or undefined). */
export function findPipelineByFileKind(
  pipelines: readonly DiscoveredPipeline[],
  fileKind: PipelineFileKind,
): DiscoveredPipeline | undefined {
  return pipelines.find((p) => p.config.fileKind === fileKind);
}

/** Find the pipeline whose sidecarSchemaId matches (e.g. "video@1"). */
export function findPipelineBySidecarSchemaId(
  pipelines: readonly DiscoveredPipeline[],
  sidecarSchemaId: string,
): DiscoveredPipeline | undefined {
  return pipelines.find((p) => p.config.sidecarSchemaId === sidecarSchemaId);
}

/**
 * Classify a filename against the discovered pipelines — returns the
 * pipeline whose extension list contains the filename's extension.
 * Case-insensitive. Falls back to undefined for unsupported files.
 */
export function findPipelineForFilename(
  pipelines: readonly DiscoveredPipeline[],
  filename: string,
): DiscoveredPipeline | undefined {
  if (typeof filename !== "string" || filename.length === 0) return undefined;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return undefined;
  const ext = filename.substring(lastDot).toLowerCase();
  return pipelines.find((p) => p.config.extensions.includes(ext));
}

/** Build the extension → fileKind mapping from discovered pipelines. */
export function buildExtensionIndex(
  pipelines: readonly DiscoveredPipeline[],
): ReadonlyMap<string, PipelineFileKind> {
  const index = new Map<string, PipelineFileKind>();
  for (const p of pipelines) {
    for (const ext of p.config.extensions) {
      index.set(ext, p.config.fileKind);
    }
  }
  return index;
}
