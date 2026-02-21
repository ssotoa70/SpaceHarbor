import { createHmac } from "node:crypto";

export function buildOutboundSignature(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
}): string {
  const payload = `${input.timestamp}.${input.body}`;
  const digest = createHmac("sha256", input.signingSecret).update(payload).digest("hex");
  return `sha256=${digest}`;
}
