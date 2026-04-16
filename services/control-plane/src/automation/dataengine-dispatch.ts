/**
 * DataEngine dispatch — closes the ingest → proxy-generation feedback loop.
 *
 * Problem
 * -------
 * VAST element triggers on `ObjectCreated:CompleteMultipartUpload` already
 * fire DataEngine functions automatically after an atomic check-in commits
 * (confirmed with vast-platform-engineer). Proxies land in `.proxies/`,
 * metadata lands in `video_metadata.files` or `frame_metadata.files`.
 * SpaceHarbor had no record of "which files are being processed, what's
 * done, where did the output go" — so the UI couldn't link a proxy to
 * its version and workflows couldn't wait on proxy completion.
 *
 * This module is the ledger + detector.
 *
 * Flow
 * ----
 * 1. `checkin.committed` fires on the internal event bus after a successful
 *    atomic check-in. Payload includes files[] with role + filename + s3Key.
 *
 * 2. For each file, inferFileKind(filename) classifies it. Files of kind
 *    "other" (sidecars, timecode .txt, random JSON) are NOT expected to
 *    trigger a DataEngine function — we skip them.
 *
 * 3. The pipeline-config lookup tells us which function is expected for
 *    this file kind. We write one `dataengine_dispatches` row per expected
 *    function run, status=pending, deadline=now+PROCESSING_SLA.
 *
 * 4. We publish `version.processing.started` so triggers/workflows can
 *    react ("notify Slack that sh010 v003 is being processed").
 *
 * 5. A background poller (PollingDetector) runs every 15s on the
 *    background-worker replica. For each pending dispatch it:
 *      a. Skips if last_polled_at was < 5s ago (avoids thrash)
 *      b. HEAD-checks the expected artifact path in S3:
 *         - oiio-proxy-generator output:  {dir}/.proxies/{stem}_proxy.jpg
 *                                         {dir}/.proxies/{stem}_thumb.jpg
 *         - video-proxy-generator output: {dir}/.proxies/{stem}-proxy.mp4
 *         - metadata extractors:          {dir}/.proxies/{stem}_metadata.json
 *      c. If found, flips status → completed, attaches proxy/thumb URLs
 *         to the Version row, and publishes `version.proxy.generated` or
 *         `version.metadata.extracted`.
 *      d. If the deadline passes without detection, flips to `abandoned`
 *         with a last_error explaining the artifact wasn't produced in time.
 *
 * Kafka completion events (future)
 * --------------------------------
 * When the Kafka subscriber is running on the cluster, a completion event
 * can short-circuit the poller by matching (version_id, s3_key) → dispatch
 * row and flipping status directly. The poller is still the authoritative
 * detector because it works with or without the Event Broker.
 *
 * Plan: docs/plans/2026-04-16-mam-readiness-phase1.md (P2.6)
 */

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";

import type { PersistenceAdapter } from "../persistence/types.js";
import { eventBus, type PlatformEvent } from "../events/bus.js";
import { inferFileKind, type FileKind } from "../storage/file-kinds.js";
import { getStorageEndpoints, getDataEnginePipelines } from "../routes/platform-settings.js";
import { setVastTlsSkip, restoreVastTls } from "../vast/vast-fetch.js";
import { s3Breaker } from "../infra/circuit-breaker.js";
import { dispatchCreatedTotal, dispatchCompletedTotal, dispatchAbandonedTotal } from "../infra/metrics.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// How long we wait for a DataEngine function to produce its output before
// we give up and mark the dispatch abandoned. Long-running transcodes
// (e.g. 2-hour ProRes mezzanine) may need a higher value — set via
// SPACEHARBOR_DISPATCH_SLA_MINUTES.
const DISPATCH_SLA_MS =
  Number.parseInt(process.env.SPACEHARBOR_DISPATCH_SLA_MINUTES ?? "30", 10) * 60_000;

// How often the poller sweeps pending rows.
const POLL_INTERVAL_MS =
  Number.parseInt(process.env.SPACEHARBOR_DISPATCH_POLL_INTERVAL_MS ?? "15000", 10);

// How long to wait between polls of the same row.
const PER_ROW_COOLDOWN_MS =
  Number.parseInt(process.env.SPACEHARBOR_DISPATCH_ROW_COOLDOWN_MS ?? "5000", 10);

// ---------------------------------------------------------------------------
// Artifact path conventions — mirror what the DataEngine functions emit.
// Kept in sync with services/control-plane/src/storage/sidecar-resolver.ts
// and the memory note project_dataengine_function_coverage.md.
// ---------------------------------------------------------------------------

interface ArtifactProbePath {
  key: string;
  kind: "proxy" | "thumbnail" | "metadata";
}

function artifactProbePaths(s3Key: string, fileKind: FileKind): ArtifactProbePath[] {
  const dir = path.posix.dirname(s3Key);
  const ext = path.posix.extname(s3Key).toLowerCase();
  const stem = path.posix.basename(s3Key, ext);
  const proxiesDir = `${dir}/.proxies`;
  const paths: ArtifactProbePath[] = [];

  if (fileKind === "image") {
    // oiio-proxy-generator: underscore separator
    paths.push({ key: `${proxiesDir}/${stem}_proxy.jpg`, kind: "proxy" });
    paths.push({ key: `${proxiesDir}/${stem}_thumb.jpg`, kind: "thumbnail" });
    paths.push({ key: `${proxiesDir}/${stem}_metadata.json`, kind: "metadata" });
  } else if (fileKind === "video") {
    // video-proxy-generator: hyphen separator for the proxy mp4
    paths.push({ key: `${proxiesDir}/${stem}-proxy.mp4`, kind: "proxy" });
    // video-metadata-extractor: underscore separator for metadata sidecar
    paths.push({ key: `${proxiesDir}/${stem}_metadata.json`, kind: "metadata" });
  } else if (fileKind === "raw_camera") {
    // video-metadata-extractor — metadata only
    paths.push({ key: `${proxiesDir}/${stem}_metadata.json`, kind: "metadata" });
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Dispatch service — subscribes to checkin.committed
// ---------------------------------------------------------------------------

export class DataEngineDispatchService {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly persistence: PersistenceAdapter) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = eventBus.subscribe("checkin.committed", async (event) => {
      try {
        await this.handleCheckinCommitted(event);
      } catch (err) {
        console.error("[dataengine-dispatch] error handling checkin.committed", err);
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async handleCheckinCommitted(event: PlatformEvent): Promise<void> {
    const data = event.data as {
      checkinId?: string;
      versionId?: string;
      files?: Array<{ role: string; filename: string; s3Key: string; s3Bucket?: string }>;
    };
    if (!data.versionId || !Array.isArray(data.files) || data.files.length === 0) return;

    const pipelines = getDataEnginePipelines();
    const pipelinesByKind = new Map(pipelines.map((p) => [p.fileKind, p]));

    const endpoints = getStorageEndpoints();
    // The primary endpoint is the one the files were written to — all
    // files in a single checkin share a bucket (see routes/checkin.ts).
    const primaryBucket = endpoints[0]?.bucket;
    if (!primaryBucket) {
      console.warn("[dataengine-dispatch] no storage endpoint configured; skipping dispatch");
      return;
    }

    const deadlineAt = new Date(Date.now() + DISPATCH_SLA_MS).toISOString();
    const inputs = [];
    for (const f of data.files) {
      const fileKind = inferFileKind(f.filename);
      if (fileKind === "other") continue; // sidecars and unknowns — no DataEngine function expected
      const pipeline = pipelinesByKind.get(fileKind);
      if (!pipeline) continue; // pipeline not configured for this kind — skip rather than error
      inputs.push({
        checkinId: data.checkinId,
        versionId: data.versionId,
        fileRole: f.role,
        fileKind,
        sourceS3Bucket: f.s3Bucket ?? primaryBucket,
        sourceS3Key: f.s3Key,
        expectedFunction: pipeline.functionName,
        metadataTargetSchema: pipeline.targetSchema,
        metadataTargetTable: pipeline.targetTable,
        deadlineAt,
        correlationId: event.correlationId,
      });
    }

    if (inputs.length === 0) return;

    const writeCtx = {
      correlationId: event.correlationId ?? `dispatch-${data.versionId}`,
      now: new Date().toISOString(),
    };
    const dispatches = await this.persistence.createDataEngineDispatches(inputs, writeCtx);
    for (const input of inputs) {
      dispatchCreatedTotal.inc({ file_kind: input.fileKind, expected_function: input.expectedFunction });
    }

    eventBus.publish({
      type: "version.processing.started",
      subject: `version:${data.versionId}`,
      data: {
        versionId: data.versionId,
        checkinId: data.checkinId,
        dispatchCount: dispatches.length,
        functions: [...new Set(dispatches.map((d) => d.expectedFunction))],
      },
      actor: event.actor,
      correlationId: event.correlationId,
    });
  }
}

// ---------------------------------------------------------------------------
// Polling detector — sweeps pending dispatches and HEADs their expected
// artifact paths. Runs on the background-worker replica only.
// ---------------------------------------------------------------------------

export class DispatchPollingDetector {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly persistence: PersistenceAdapter) {}

  start(): void {
    if (this.timer) return;
    // First sweep after a short delay so we don't race the reserve-side writes.
    this.timer = setInterval(() => {
      void this.runSweep().catch((err) =>
        console.error("[dispatch-poller] sweep failed", err),
      );
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for manual test runs and admin POST triggers. */
  async runSweep(): Promise<{ polled: number; completed: number; abandoned: number }> {
    const now = new Date().toISOString();
    const pending = await this.persistence.listPendingDispatchesForPolling(now, 50);
    let polled = 0;
    let completed = 0;
    let abandoned = 0;

    const endpoints = getStorageEndpoints();
    const ep = endpoints[0];
    if (!ep) return { polled: 0, completed: 0, abandoned: 0 };

    const s3 = new S3Client({
      endpoint: ep.endpoint,
      region: ep.region || "us-east-1",
      credentials: { accessKeyId: ep.accessKeyId, secretAccessKey: ep.secretAccessKey },
      forcePathStyle: ep.pathStyle !== false,
    });

    setVastTlsSkip();
    try {
      for (const dispatch of pending) {
        // Per-row cooldown — don't spam HEAD calls on the same row
        if (dispatch.lastPolledAt) {
          const last = Date.parse(dispatch.lastPolledAt);
          if (!Number.isNaN(last) && Date.now() - last < PER_ROW_COOLDOWN_MS) continue;
        }

        // Deadline passed → abandon
        if (dispatch.deadlineAt < now) {
          await this.persistence.updateDataEngineDispatch(
            dispatch.id,
            {
              status: "abandoned",
              proxyUrl: null,
              thumbnailUrl: null,
              metadataRowId: null,
              lastError: `SLA exceeded: no artifact produced by ${dispatch.expectedFunction} before ${dispatch.deadlineAt}`,
              completedAt: now,
              lastPolledAt: now,
              pollAttempts: dispatch.pollAttempts + 1,
            },
            { correlationId: dispatch.correlationId ?? `poller-${dispatch.id}`, now },
          );
          abandoned++;
          dispatchAbandonedTotal.inc({ file_kind: dispatch.fileKind });
          eventBus.publish({
            type: "version.processing.abandoned",
            subject: `version:${dispatch.versionId}`,
            data: { dispatchId: dispatch.id, expectedFunction: dispatch.expectedFunction },
            correlationId: dispatch.correlationId ?? undefined,
          });
          continue;
        }

        polled++;

        // Probe artifact paths
        const probes = artifactProbePaths(dispatch.sourceS3Key, dispatch.fileKind as FileKind);
        let proxyUrl: string | null = null;
        let thumbnailUrl: string | null = null;
        let metadataFound = false;

        for (const probe of probes) {
          try {
            await s3Breaker.execute(() =>
              s3.send(new HeadObjectCommand({ Bucket: dispatch.sourceS3Bucket, Key: probe.key })),
            );
            const url = `s3://${dispatch.sourceS3Bucket}/${probe.key}`;
            if (probe.kind === "proxy") proxyUrl = url;
            if (probe.kind === "thumbnail") thumbnailUrl = url;
            if (probe.kind === "metadata") metadataFound = true;
          } catch {
            // 404 / NoSuchKey is the common case — artifact not ready yet.
            // s3Breaker's isExpectedError classifier treats these as expected
            // and won't trip the circuit.
          }
        }

        // Completion heuristic per file kind:
        //   image:     proxy + thumbnail + metadata expected → all three present ⇒ completed
        //              (or at least metadata + one of proxy/thumbnail)
        //   video:     proxy OR metadata present ⇒ progress; BOTH ⇒ fully completed
        //   raw_camera: metadata present ⇒ completed (no proxy emitted)
        const kind = dispatch.fileKind as FileKind;
        const completeEnough =
          (kind === "image" && (proxyUrl || thumbnailUrl || metadataFound)) ||
          (kind === "video" && (proxyUrl || metadataFound)) ||
          (kind === "raw_camera" && metadataFound);

        if (completeEnough) {
          await this.persistence.updateDataEngineDispatch(
            dispatch.id,
            {
              status: "completed",
              proxyUrl,
              thumbnailUrl,
              metadataRowId: null,
              lastError: null,
              completedAt: now,
              lastPolledAt: now,
              pollAttempts: dispatch.pollAttempts + 1,
            },
            { correlationId: dispatch.correlationId ?? `poller-${dispatch.id}`, now },
          );
          completed++;
          dispatchCompletedTotal.inc({ file_kind: kind });

          // Attach the proxy/thumbnail back to the Version row so the UI
          // can render the preview without re-querying the dispatch ledger.
          // Updates merge into VfxMetadata: {proxy_url, thumbnail_url}.
          if (proxyUrl || thumbnailUrl) {
            try {
              const mediaUpdate: Record<string, string> = {};
              if (proxyUrl) mediaUpdate.proxy_url = proxyUrl;
              if (thumbnailUrl) mediaUpdate.thumbnail_url = thumbnailUrl;
              await this.persistence.updateVersionTechnicalMetadata(
                dispatch.versionId,
                mediaUpdate,
                { correlationId: dispatch.correlationId ?? `poller-${dispatch.id}`, now },
              );
            } catch (err) {
              // Non-fatal — dispatch is already marked completed, the UI
              // just can't link to the proxy until someone re-queries.
              console.warn(
                `[dispatch-poller] failed to attach proxy to version ${dispatch.versionId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          eventBus.publish({
            type: "version.proxy.generated",
            subject: `version:${dispatch.versionId}`,
            data: {
              dispatchId: dispatch.id,
              versionId: dispatch.versionId,
              fileKind: kind,
              proxyUrl,
              thumbnailUrl,
              metadataFound,
            },
            correlationId: dispatch.correlationId ?? undefined,
          });
        } else {
          await this.persistence.updateDataEngineDispatch(
            dispatch.id,
            {
              status: "pending",
              proxyUrl: null,
              thumbnailUrl: null,
              metadataRowId: null,
              lastError: null,
              completedAt: null,
              lastPolledAt: now,
              pollAttempts: dispatch.pollAttempts + 1,
            },
            { correlationId: dispatch.correlationId ?? `poller-${dispatch.id}`, now },
          );
        }
      }
    } finally {
      s3.destroy();
      restoreVastTls();
    }

    return { polled, completed, abandoned };
  }
}
