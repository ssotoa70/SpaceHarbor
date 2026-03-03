export type OutboundTargetKind = "slack" | "teams" | "production";

export interface OutboundWebhookTarget {
  kind: OutboundTargetKind;
  url: string;
}

export interface OutboundConfig {
  strictMode: boolean;
  signingSecret: string;
  targets: OutboundWebhookTarget[];
}
