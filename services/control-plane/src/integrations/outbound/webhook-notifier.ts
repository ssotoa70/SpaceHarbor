import type { OutboundNotifier } from "./notifier.js";
import { buildOutboundSignature } from "./signing.js";
import type { OutboundPayloadEnvelope, OutboundWebhookTarget } from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class WebhookOutboundNotifier implements OutboundNotifier {
  constructor(
    private readonly signingSecret: string,
    private readonly fetchFn: FetchLike = globalThis.fetch
  ) {}

  async notify(target: OutboundWebhookTarget, payload: OutboundPayloadEnvelope): Promise<void> {
    const timestamp = `${Date.now()}`;
    const body = JSON.stringify(payload);
    const signature = buildOutboundSignature({
      signingSecret: this.signingSecret,
      timestamp,
      body
    });

    const response = await this.fetchFn(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assetharbor-target": target.target,
        "x-assetharbor-timestamp": timestamp,
        "x-assetharbor-signature": signature
      },
      body
    });

    if (!response.ok) {
      throw new Error(`webhook delivery failed for ${target.target}: ${response.status}`);
    }
  }
}
