export type OutboundTarget = "slack" | "teams" | "production";

export interface OutboundWebhookTarget {
  target: OutboundTarget;
  url: string;
}

export interface OutboundConfig {
  strictMode: boolean;
  signingSecret: string;
  targets: OutboundWebhookTarget[];
}

export interface OutboundPayloadEnvelope {
  eventType: string;
  occurredAt: string;
  correlationId: string;
  assetId: string;
  jobId: string;
  status: string;
  summary: string;
  schemaVersion: string;
}
