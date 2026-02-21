import type { OutboundConfig, OutboundTarget, OutboundWebhookTarget } from "./types.js";

const TARGET_CONFIG: Array<{ target: OutboundTarget; envKey: string }> = [
  { target: "slack", envKey: "ASSETHARBOR_WEBHOOK_SLACK_URL" },
  { target: "teams", envKey: "ASSETHARBOR_WEBHOOK_TEAMS_URL" },
  { target: "production", envKey: "ASSETHARBOR_WEBHOOK_PRODUCTION_URL" }
];

export class OutboundConfigError extends Error {
  readonly code = "OUTBOUND_CONFIG_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "OutboundConfigError";
  }
}

export function resolveOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  const strictMode = parseStrictBoolean(env.ASSETHARBOR_WEBHOOK_STRICT_MODE);
  const signingSecret = (env.ASSETHARBOR_WEBHOOK_SIGNING_SECRET ?? "").trim();

  const targets: OutboundWebhookTarget[] = [];
  for (const targetConfig of TARGET_CONFIG) {
    const url = (env[targetConfig.envKey] ?? "").trim();
    if (!url) {
      continue;
    }
    validateWebhookUrl(url, targetConfig.target);
    targets.push({ target: targetConfig.target, url });
  }

  if (strictMode) {
    for (const targetConfig of TARGET_CONFIG) {
      if (!(env[targetConfig.envKey] ?? "").trim()) {
        throw new OutboundConfigError(`missing required config: ${targetConfig.envKey}`);
      }
    }
  }

  if ((strictMode || targets.length > 0) && !signingSecret) {
    throw new OutboundConfigError("missing required config: ASSETHARBOR_WEBHOOK_SIGNING_SECRET");
  }

  return {
    strictMode,
    signingSecret,
    targets
  };
}

function parseStrictBoolean(input: string | undefined): boolean {
  const value = (input ?? "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new OutboundConfigError("invalid ASSETHARBOR_WEBHOOK_STRICT_MODE value (expected true/false)");
}

function validateWebhookUrl(url: string, target: OutboundTarget): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OutboundConfigError(`invalid ${target} webhook url`);
  }

  if (parsed.protocol !== "https:") {
    throw new OutboundConfigError(`invalid ${target} webhook url protocol`);
  }
}
