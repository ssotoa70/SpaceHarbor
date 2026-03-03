import type { OutboundPayloadEnvelope, OutboundWebhookTarget } from "./types.js";

export interface OutboundNotifier {
  notify(target: OutboundWebhookTarget, payload: OutboundPayloadEnvelope): Promise<void>;
}
