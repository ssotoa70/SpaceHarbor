import type { KafkaClient, KafkaConsumer } from "./kafka-types.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
  type VastDataEngineCompletionEvent,
} from "./types.js";
import { processAssetEvent, processVastFunctionCompletion } from "./processor.js";
import { broadcastEvent } from "../routes/events-stream.js";
import type { ChainOrchestrator } from "./chain-orchestrator.js";

export class VastEventSubscriber {
  private consumer: KafkaConsumer;

  constructor(
    private readonly persistence: PersistenceAdapter,
    private readonly kafka: KafkaClient,
    private readonly topic: string,
    private readonly groupId: string,
    private readonly chainOrchestrator?: ChainOrchestrator,
  ) {
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(message.value.toString());
        } catch {
          console.warn("[VastEventSubscriber] Unparseable message — skipping");
          return;
        }

        if (!isVastDataEngineCompletionEvent(parsed)) {
          // Not a VAST DataEngine completion event — skip silently
          return;
        }

        const normalized = normalizeVastDataEngineEvent(parsed);
        const context = {
          correlationId: parsed.id,
          now: parsed.time,
        };

        const result = await processAssetEvent(this.persistence, normalized, context, {
          enableRetryOnFailure: true,
        });

        if (!result.accepted && !result.duplicate) {
          console.warn(
            `[VastEventSubscriber] Event rejected: ${result.reason} — job ${normalized.jobId}`,
          );
          return;
        }

        if (result.duplicate) {
          return; // Idempotency — already processed
        }

        // If success, also persist metadata to the asset record
        if (normalized.eventType === "asset.processing.completed" && normalized.metadata) {
          const job = await this.persistence.getJobById(normalized.jobId);
          if (job) {
            await this.persistence.updateAsset(
              job.assetId,
              { metadata: normalized.metadata },
              context,
            );
          }
        }

        // Route DataEngine function-specific metadata (same logic as vast-events HTTP route)
        const vastEvent = parsed as VastDataEngineCompletionEvent;
        const functionId = vastEvent.data?.function_id;
        if (functionId) {
          try {
            await processVastFunctionCompletion(this.persistence, normalized, functionId, context);
            broadcastEvent("ingest:stage_update", { jobId: normalized.jobId, functionId, status: "done" });
          } catch (err) {
            console.error(`[VastEventSubscriber] processVastFunctionCompletion error for ${functionId}:`, err);
          }

          // After metadata is persisted, trigger the next function in the chain
          // (if one is configured). Only chain on success to avoid cascading failures.
          if (this.chainOrchestrator && vastEvent.data?.success) {
            try {
              await this.chainOrchestrator.triggerNext(vastEvent);
            } catch (err) {
              console.error(`[VastEventSubscriber] ChainOrchestrator.triggerNext error for ${functionId}:`, err);
            }
          }
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
