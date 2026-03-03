import type { OutboundWebhookTarget } from "./types";

export interface OutboundNotification {
  eventType: string;
  payload: unknown;
  occurredAt: string;
  correlationId?: string;
}

export interface OutboundNotifier {
  notify(
    target: OutboundWebhookTarget,
    notification: OutboundNotification,
    signingSecret: string
  ): Promise<void>;
}
