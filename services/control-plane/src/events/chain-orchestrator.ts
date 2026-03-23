/**
 * ChainOrchestrator — control-plane orchestrated DataEngine function chaining.
 *
 * When a DataEngine function completes, the control-plane receives the
 * completion event via Kafka (VastEventSubscriber). After processing, the
 * subscriber calls triggerNext(), which looks up the chain config to determine
 * whether a downstream function should be triggered.
 *
 * Chaining is implemented by publishing a new CloudEvent to the Event Broker
 * topic that the VastEventSubscriber already consumes. The downstream function's
 * completion event will in turn call triggerNext() again, propagating the chain.
 *
 * The previous function's result metadata is embedded under data.previousResult
 * so the DataEngine container can expose it via the PREVIOUS_RESULT env var.
 *
 * IMPORTANT: function_id values here must exactly match the case keys in
 * processor.ts#processVastFunctionCompletion (underscore convention).
 */

import crypto from "node:crypto";
import type { KafkaProducer } from "./kafka-types.js";
import type { VastDataEngineCompletionEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Chain configuration
//
// Each entry maps a completed function_id to its successor(s).
// - A string value means there is exactly one successor regardless of media type.
// - An object value maps file extension (lower-case) to a successor function_id.
//   The scanner function reads file_extension from its metadata payload to pick
//   the correct branch. If file_extension is absent the branch is skipped with
//   a warning — see triggerNext() for the guard.
// ---------------------------------------------------------------------------

type ChainNext = string | Record<string, string>;

interface ChainEntry {
  next: ChainNext;
}

const CHAINS: Record<string, ChainEntry> = {
  scanner: {
    next: { exr: "exr_inspector", mov: "ffmpeg_transcoder", mp4: "ffmpeg_transcoder" },
  },
  exr_inspector: { next: "oiio_proxy_generator" },
  mtlx_parser: { next: "dependency_graph_builder" },
  otio_parser: { next: "timeline_conformer" },
};

// ---------------------------------------------------------------------------
// ChainOrchestrator
// ---------------------------------------------------------------------------

export class ChainOrchestrator {
  constructor(
    private readonly producer: KafkaProducer,
    private readonly topic: string,
  ) {}

  /**
   * Inspect the completed function and, if a successor is configured, publish
   * a new CloudEvent to the Event Broker to trigger it.
   *
   * @param event - The raw VastDataEngineCompletionEvent just processed.
   */
  async triggerNext(event: VastDataEngineCompletionEvent): Promise<void> {
    const { function_id: functionId, asset_id: assetId, job_id: jobId, metadata } = event.data;

    const entry = CHAINS[functionId];
    if (!entry) {
      // No chain defined for this function — end of chain.
      console.info(`[ChainOrchestrator] No chain configured for ${functionId} — chain complete`);
      return;
    }

    const nextFunctionId = this._resolveNext(entry.next, functionId, metadata ?? {});
    if (!nextFunctionId) {
      // Branch could not be resolved (e.g. unknown file_extension from scanner).
      console.warn(
        `[ChainOrchestrator] Cannot resolve next function for ${functionId} — ` +
          `file_extension="${(metadata as Record<string, unknown>)?.["file_extension"] ?? "(absent)"}"`,
      );
      return;
    }

    const chainEvent: VastDataEngineCompletionEvent = {
      specversion: "1.0",
      type: "vast.dataengine.pipeline.completed",
      source: `spaceharbor/chain-orchestrator`,
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      data: {
        asset_id: assetId,
        job_id: jobId,
        function_id: nextFunctionId,
        success: true,
        // Embed the prior function's output so the DataEngine container can
        // surface it as the PREVIOUS_RESULT env var.
        metadata: {
          ...(metadata ?? {}),
          previousResult: metadata ?? {},
          triggeredBy: functionId,
        },
      },
    };

    console.info(
      `[ChainOrchestrator] Chain transition: ${functionId} → ${nextFunctionId} (asset ${assetId})`,
    );

    await this.producer.send({
      topic: this.topic,
      key: assetId,
      value: JSON.stringify(chainEvent),
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _resolveNext(
    next: ChainNext,
    functionId: string,
    metadata: Record<string, unknown>,
  ): string | null {
    if (typeof next === "string") {
      return next;
    }

    // Branching: require file_extension in the completion metadata.
    const ext =
      typeof metadata["file_extension"] === "string"
        ? metadata["file_extension"].toLowerCase().replace(/^\./, "")
        : null;

    if (!ext) {
      return null;
    }

    return next[ext] ?? null;
  }
}
