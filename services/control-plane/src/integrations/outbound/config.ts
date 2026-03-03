import type { OutboundConfig, OutboundTargetKind, OutboundWebhookTarget } from "./types";

const TARGETS: Array<{ kind: OutboundTargetKind; envKey: keyof NodeJS.ProcessEnv }> = [
  { kind: "slack", envKey: "ASSETHARBOR_WEBHOOK_SLACK_URL" },
  { kind: "teams", envKey: "ASSETHARBOR_WEBHOOK_TEAMS_URL" },
  { kind: "production", envKey: "ASSETHARBOR_WEBHOOK_PRODUCTION_URL" }
];

const STRICT_MODE_ENV_KEY = "ASSETHARBOR_WEBHOOK_STRICT_MODE" as const;
const SIGNING_SECRET_ENV_KEY = "ASSETHARBOR_WEBHOOK_SIGNING_SECRET" as const;

export class OutboundConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundConfigError";
  }
}

export function resolveOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  const strictMode = parseBooleanFlag(env[STRICT_MODE_ENV_KEY]);
  const targets: OutboundWebhookTarget[] = [];

  for (const target of TARGETS) {
    const url = normalizeValue(env[target.envKey]);

    if (url.length > 0) {
      targets.push({ kind: target.kind, url });
      continue;
    }

    if (strictMode) {
      throw new OutboundConfigError(
        `Outbound config validation failed: missing ${target.envKey} for target ${target.kind}`
      );
    }
  }

  const signingSecret = normalizeValue(env[SIGNING_SECRET_ENV_KEY]);
  if ((strictMode || targets.length > 0) && signingSecret.length === 0) {
    throw new OutboundConfigError(
      `Outbound config validation failed: missing ${SIGNING_SECRET_ENV_KEY}`
    );
  }

  return {
    strictMode,
    signingSecret,
    targets
  };
}

function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = normalizeValue(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeValue(value: string | undefined): string {
  return (value ?? "").trim();
}
