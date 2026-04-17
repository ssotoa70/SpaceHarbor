/**
 * Pipeline discovery service.
 *
 * Merges the admin-controlled `dataEnginePipelines` from PlatformSettings
 * with live function records fetched from VAST DataEngine. The merge is
 * lazy, cached (60s TTL by default), and resilient to VAST unavailability
 * — when the function list cannot be reached, the service returns the
 * Settings entries tagged as `vast-unreachable` so the web-ui can still
 * render labels and fall back gracefully.
 *
 * The "name is the contract" principle applies: discovery looks up each
 * configured function by its exact name in VAST (via the injected
 * `FunctionFetcher`). No trigger-name conventions, no tenant scoping
 * assumptions, no naming-pattern heuristics. If the admin configured
 * `functionName: "frame-metadata-extractor"`, the service asks VAST for
 * exactly that name.
 *
 * This module is pure business logic — it does NOT own an HTTP client,
 * auth tokens, or knowledge of the VAST API path layout. The concrete
 * `FunctionFetcher` implementation is supplied by the route layer
 * (commit 4), which wires it to `/dataengine-proxy/functions?name={name}`
 * via the existing `proxyToVast` infrastructure. Tests inject an
 * in-memory fetcher and never touch a real network.
 */

import type { DataEnginePipelineConfig } from "./pipeline-config.js";

/** Live record shape returned by VAST DataEngine function lookup. */
export interface LiveFunctionRecord {
  guid: string;
  name: string;
  description: string;
  owner: { id?: string; name?: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  vrn: string | null;
  lastRevisionNumber: number | null;
}

export type PipelineStatus =
  | "ok"                 // config matches a live VAST function AND the target schema/table exists
  | "function-not-found" // config points to a name that VAST doesn't know
  | "vast-unreachable"   // VAST lookup failed (network, auth, etc.)
  | "target-not-found"   // function resolves but the targetSchema.targetTable doesn't exist in VastDB
  | "target-unreachable"; // function resolves but vastdb-query itself is down/unreachable

export interface DiscoveredPipeline {
  config: DataEnginePipelineConfig;
  live: LiveFunctionRecord | null;
  status: PipelineStatus;
  /** Human-readable detail when status !== "ok". */
  statusDetail?: string;
}

/**
 * Interface for fetching a VAST DataEngine function by name. The caller
 * (discovery service) invokes this once per configured pipeline. Must
 * handle its own auth + HTTP concerns — discovery is protocol-agnostic.
 *
 * Contract:
 *   - Returns the live record when the name is found
 *   - Returns null when VAST responds OK but no function matches the name
 *   - Throws on network / auth / HTTP 5xx errors — discovery catches and
 *     tags the pipeline as `vast-unreachable`
 */
export interface FunctionFetcher {
  fetchByName(name: string): Promise<LiveFunctionRecord | null>;
}

export type TargetProbeStatus = "ok" | "target-not-found" | "target-unreachable";

export interface TargetProbeResult {
  status: TargetProbeStatus;
  /** Human-readable detail when status !== "ok". */
  detail?: string;
}

/**
 * Interface for probing whether a VastDB schema.table exists and is
 * reachable. Injected into the discovery service; omitting it skips
 * probing (backward-compatible default).
 */
export interface TargetProbe {
  check(schema: string, table: string): Promise<TargetProbeResult>;
}

export interface DiscoveryOptions {
  /** Skip the cache and force a fresh fetch. Defaults to false. */
  force?: boolean;
}

interface CacheEntry {
  results: DiscoveredPipeline[];
  expiresAt: number;
}

export class PipelineDiscoveryService {
  private cache: CacheEntry | null = null;
  private inFlight: Promise<DiscoveredPipeline[]> | null = null;

  constructor(
    private readonly configProvider: () => readonly DataEnginePipelineConfig[],
    private readonly fetcher: FunctionFetcher,
    private readonly targetProbe?: TargetProbe,
    private readonly ttlMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Return the discovered pipeline list, refreshing from VAST when the
   * cache is stale or absent. Concurrent callers share a single in-flight
   * fetch so a cache-miss burst doesn't fan out into N parallel VAST
   * queries.
   */
  async discover(options: DiscoveryOptions = {}): Promise<DiscoveredPipeline[]> {
    if (!options.force && this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.results;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runDiscovery().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Drop the cache. Next `discover()` call will refresh. */
  invalidate(): void {
    this.cache = null;
  }

  private async runDiscovery(): Promise<DiscoveredPipeline[]> {
    const configs = this.configProvider();

    // Fetch each configured function in parallel. Errors in one lookup
    // don't block the others — each result is tagged independently.
    const results = await Promise.all(
      configs.map(async (config): Promise<DiscoveredPipeline> => {
        try {
          const live = await this.fetcher.fetchByName(config.functionName);

          if (!live) {
            // Short-circuit: don't probe VastDB when the function itself isn't found.
            return {
              config,
              live: null,
              status: "function-not-found",
              statusDetail: `No VAST DataEngine function named "${config.functionName}"`,
            };
          }

          // Function resolved — run the target probe (if any).
          if (this.targetProbe) {
            const probeResult = await this.targetProbe.check(config.targetSchema, config.targetTable);
            if (probeResult.status !== "ok") {
              return {
                config,
                live,
                status: probeResult.status,
                statusDetail: probeResult.detail,
              };
            }
          }

          return { config, live, status: "ok" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            config,
            live: null,
            status: "vast-unreachable",
            statusDetail: msg,
          };
        }
      }),
    );

    this.cache = {
      results,
      expiresAt: this.now() + this.ttlMs,
    };
    return results;
  }
}
