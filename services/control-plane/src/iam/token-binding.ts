// ---------------------------------------------------------------------------
// Phase 3.2: Token Binding — bind tokens to client fingerprint
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

// In-memory store: tokenId -> fingerprint hash
const tokenBindings = new Map<string, string>();

/**
 * Create a fingerprint from user-agent and IP address.
 * Uses the /24 subnet of the IP to allow minor IP changes within the same network.
 */
export function createTokenFingerprint(userAgent: string, ip: string): string {
  // Extract /24 subnet: for IPv4 "1.2.3.4" -> "1.2.3"
  const subnet = extractSubnet(ip);
  const input = `${userAgent}|${subnet}`;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Extract /24 subnet from an IP address.
 * For IPv4: strips last octet ("1.2.3.4" -> "1.2.3")
 * For IPv6 or other formats: uses full address
 */
function extractSubnet(ip: string): string {
  // Handle IPv4
  const parts = ip.split(".");
  if (parts.length === 4) {
    return parts.slice(0, 3).join(".");
  }
  // IPv6 or other — use as-is
  return ip;
}

/**
 * Bind a token to a client fingerprint.
 */
export function bindToken(tokenId: string, fingerprint: string): void {
  tokenBindings.set(tokenId, fingerprint);
}

/**
 * Verify that a token's fingerprint matches the stored binding.
 * Returns true if:
 * - No binding exists (token was not bound)
 * - Binding exists and matches the provided fingerprint
 * Returns false if binding exists but doesn't match.
 */
export function verifyTokenBinding(tokenId: string, fingerprint: string): boolean {
  const stored = tokenBindings.get(tokenId);
  if (!stored) return true; // No binding — allow
  return stored === fingerprint;
}

/**
 * Remove a token binding (on revocation).
 */
export function removeTokenBinding(tokenId: string): void {
  tokenBindings.delete(tokenId);
}

/** Reset all token binding state (for tests). */
export function resetTokenBindingState(): void {
  tokenBindings.clear();
}

export { tokenBindings };
