import { createHmac, timingSafeEqual } from "node:crypto";

export function buildOutboundSignature(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
}): string {
  const payload = `${input.timestamp}.${input.body}`;
  const digest = createHmac("sha256", input.signingSecret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function verifyOutboundSignature(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
  providedSignature: string;
}): boolean {
  const expected = buildOutboundSignature({
    signingSecret: input.signingSecret,
    timestamp: input.timestamp,
    body: input.body,
  });
  const a = Buffer.from(input.providedSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
