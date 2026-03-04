import { Kafka, type Consumer } from "kafkajs";
import type { PersistenceAdapter } from "../persistence/types.js";
import {
  isVastDataEngineCompletionEvent,
  normalizeVastDataEngineEvent,
} from "./types.js";
import { processAssetEvent } from "../events/processor.js";

export class VastEventSubscriber {
  private consumer: Consumer;

  constructor(
    private readonly persistence: PersistenceAdapter,
    private readonly kafka: Kafka,
    private readonly topic: string,
    private readonly groupId: string,
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

        const result = processAssetEvent(this.persistence, normalized, context, {
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
          const job = this.persistence.getJobById(normalized.jobId);
          if (job) {
            this.persistence.updateAsset(
              job.assetId,
              { metadata: normalized.metadata },
              context,
            );
          }
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
