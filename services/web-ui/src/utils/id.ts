/**
 * Generate a unique ID. Uses crypto.randomUUID() when available (secure
 * contexts: HTTPS or localhost), falls back to a Math.random-based UUID
 * for plain HTTP deployments where crypto.randomUUID is unavailable.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: RFC 4122 v4 UUID via Math.random (not cryptographically secure,
  // but sufficient for client-side UI element IDs).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
