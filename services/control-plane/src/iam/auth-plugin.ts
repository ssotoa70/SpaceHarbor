// ---------------------------------------------------------------------------
// Phase 8: Auth Plugin — OIDC SSO Connector & Claims Mapping
// SERGIO-101 (Slice 4)
// ---------------------------------------------------------------------------
//
// Evaluates three auth strategies in priority order:
//   1. JWT bearer token (Authorization: Bearer <jwt>)
//   2. API key (x-api-key header)
//   3. Service token (x-service-token header)
// Falls back to anonymous context when no credentials are provided.
// ---------------------------------------------------------------------------

import { createHmac, createPublicKey, createVerify, timingSafeEqual, type KeyObject } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { resolveIamFlags, type IamFeatureFlags } from "./feature-flags.js";
import { getEffectivePermissionsForRoles } from "./permissions.js";
import type { AuthStrategy, RequestContext, Role } from "./types.js";
import type { RoleBindingService } from "./role-binding.js";
import type { PersistentRoleBindingService } from "./persistent-role-binding.js";

// ---------------------------------------------------------------------------
// JIT User Provisioning — Module-level role binding service reference
// ---------------------------------------------------------------------------

type RoleService = RoleBindingService | PersistentRoleBindingService;

let jitRoleBindingService: RoleService | null = null;

/**
 * Set the role binding service for JIT user provisioning.
 * Called from app.ts after the service is created.
 */
export function setRoleBindingService(svc: RoleService | null): void {
  jitRoleBindingService = svc;
}

/** Resolve result from sync or async role binding service. */
async function resolveRbs<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

/**
 * Parse the group-to-role mapping from SPACEHARBOR_IAM_GROUP_ROLE_MAP env var.
 * Expected format: JSON object mapping group names to role names.
 * Example: {"vfx-supers": "supervisor", "artists": "artist"}
 */
function parseGroupRoleMap(): Record<string, string> {
  const raw = process.env.SPACEHARBOR_IAM_GROUP_ROLE_MAP?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Invalid JSON — ignore
  }
  return {};
}

/**
 * JIT (Just-In-Time) user provisioning: if a JWT-authenticated user
 * doesn't have a matching user record, auto-create from JWT claims.
 */
async function jitProvisionUser(claims: ExtractedClaims): Promise<void> {
  if (!jitRoleBindingService) return;

  const svc = jitRoleBindingService;

  // Check if user already exists by externalId (sub claim) or email
  const byExtId = await resolveRbs(svc.getUserByExternalId(claims.externalId));
  if (byExtId) return;

  if (claims.email) {
    const byEmail = await resolveRbs(svc.getUserByEmail(claims.email));
    if (byEmail) return;
  }

  // Auto-create user from JWT claims
  const user = await resolveRbs(svc.createUser({
    email: claims.email ?? `${claims.externalId}@unknown`,
    displayName: claims.displayName,
    externalId: claims.externalId,
    status: "active",
  }));

  // Determine default role
  const defaultRole = process.env.SPACEHARBOR_IAM_DEFAULT_ROLE?.trim() || "viewer";

  // Apply group-to-role mapping
  const groupRoleMap = parseGroupRoleMap();
  const mappedRoles = new Set<string>();

  for (const group of claims.groups) {
    const mappedRole = groupRoleMap[group];
    if (mappedRole) {
      mappedRoles.add(mappedRole);
    }
  }

  // If no group mapping matched, use default role
  if (mappedRoles.size === 0) {
    mappedRoles.add(defaultRole);
  }

  // Grant roles as project memberships on the default project
  const defaultProject = process.env.SPACEHARBOR_DEFAULT_PROJECT ?? "default";
  for (const role of mappedRoles) {
    await resolveRbs(svc.grantProjectRole({
      userId: user.id,
      projectId: defaultProject,
      tenantId: claims.tenantId,
      role: role as any,
      grantedBy: "jit-provisioning",
    }));
  }
}

// ---------------------------------------------------------------------------
// OIDC configuration (resolved from environment)
// ---------------------------------------------------------------------------

export interface OidcConfig {
  /** OIDC issuer URL (e.g. https://idp.example.com/realms/spaceharbor). */
  issuer: string | null;
  /** Expected audience claim. */
  audience: string | null;
  /** JWKS URI for signature validation (production only). */
  jwksUri: string | null;
}

function resolveOidcConfig(): OidcConfig {
  return {
    issuer: process.env.SPACEHARBOR_OIDC_ISSUER ?? null,
    audience: process.env.SPACEHARBOR_OIDC_AUDIENCE ?? null,
    jwksUri: process.env.SPACEHARBOR_OIDC_JWKS_URI ?? null,
  };
}

// ---------------------------------------------------------------------------
// JWKS fetcher with caching (Phase 1.1)
// ---------------------------------------------------------------------------

interface JwksCacheEntry {
  keys: Map<string, { keyObject: KeyObject; alg: string }>;
  fetchedAt: number;
}

/** Default JWKS cache TTL: 1 hour. */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

let jwksCache: JwksCacheEntry | null = null;

/** Exported for testing — reset the JWKS cache. */
export function resetJwksCache(): void {
  jwksCache = null;
}

/** Exported for testing — inject a fetch function for JWKS. */
export type JwksFetchFn = (url: string) => Promise<{ keys: Record<string, unknown>[] }>;

let jwksFetchOverride: JwksFetchFn | null = null;

/** Override the JWKS fetch function (for testing). */
export function setJwksFetchFn(fn: JwksFetchFn | null): void {
  jwksFetchOverride = fn;
}

interface JwkEntry {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
  [key: string]: unknown;
}

function jwkToKeyObject(jwk: JwkEntry): KeyObject {
  return createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
}

async function fetchJwksFromUri(uri: string): Promise<{ keys: Record<string, unknown>[] }> {
  if (jwksFetchOverride) {
    return jwksFetchOverride(uri);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(uri, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    }
    return (await res.json()) as { keys: Record<string, unknown>[] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and cache JWKS keys. Returns a Map of kid → { keyObject, alg }.
 * If forceRefresh is true, bypasses the cache TTL.
 */
async function getJwksKeys(
  jwksUri: string,
  forceRefresh = false,
): Promise<Map<string, { keyObject: KeyObject; alg: string }>> {
  const now = Date.now();

  if (!forceRefresh && jwksCache && (now - jwksCache.fetchedAt) < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const jwksData = await fetchJwksFromUri(jwksUri);
  const keys = new Map<string, { keyObject: KeyObject; alg: string }>();

  for (const rawJwk of jwksData.keys) {
    const jwk = rawJwk as JwkEntry;
    // Only process signing keys (not encryption keys)
    if (jwk.use && jwk.use !== "sig") continue;

    const kid = jwk.kid ?? "default";
    const alg = jwk.alg ?? (jwk.kty === "RSA" ? "RS256" : jwk.kty === "EC" ? "ES256" : "");

    if (!alg) continue;

    try {
      const keyObject = jwkToKeyObject(jwk);
      keys.set(kid, { keyObject, alg });
    } catch {
      // Skip malformed JWK entries
    }
  }

  jwksCache = { keys, fetchedAt: now };
  return keys;
}

// ---------------------------------------------------------------------------
// Asymmetric signature verification (RS256 / ES256) — Phase 1.1
// ---------------------------------------------------------------------------

/**
 * Verify an RS256 (RSASSA-PKCS1-v1_5 with SHA-256) JWT signature.
 */
function verifyRS256(signingInput: string, signature: Buffer, publicKey: KeyObject): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(signingInput);
  return verifier.verify(publicKey, signature);
}

/**
 * Verify an ES256 (ECDSA with P-256 and SHA-256) JWT signature.
 * JWT ES256 signatures use the raw R||S format (64 bytes), but Node.js
 * crypto.verify expects DER-encoded signatures. We convert here.
 */
function verifyES256(signingInput: string, signature: Buffer, publicKey: KeyObject): boolean {
  // ES256 raw signature is 64 bytes: 32-byte R + 32-byte S
  if (signature.length !== 64) return false;

  const r = signature.subarray(0, 32);
  const s = signature.subarray(32, 64);

  // Convert R and S to DER-encoded integers
  const derR = toDerInteger(r);
  const derS = toDerInteger(s);

  // Build DER SEQUENCE
  const seqLen = derR.length + derS.length;
  const der = Buffer.alloc(2 + seqLen);
  der[0] = 0x30; // SEQUENCE tag
  der[1] = seqLen;
  derR.copy(der, 2);
  derS.copy(der, 2 + derR.length);

  const verifier = createVerify("SHA256");
  verifier.update(signingInput);
  return verifier.verify(publicKey, der);
}

/**
 * Convert a raw unsigned big-endian integer to DER INTEGER format.
 * Strips leading zeros and adds 0x00 prefix if high bit is set.
 */
function toDerInteger(raw: Buffer): Buffer {
  // Strip leading zeros
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start++;
  const trimmed = raw.subarray(start);

  // If high bit set, prepend 0x00 to indicate positive
  const needsPad = (trimmed[0] & 0x80) !== 0;
  const len = trimmed.length + (needsPad ? 1 : 0);

  const result = Buffer.alloc(2 + len);
  result[0] = 0x02; // INTEGER tag
  result[1] = len;
  if (needsPad) {
    result[2] = 0x00;
    trimmed.copy(result, 3);
  } else {
    trimmed.copy(result, 2);
  }
  return result;
}

// ---------------------------------------------------------------------------
// JWT helpers (no external deps — Node.js crypto + base64)
// ---------------------------------------------------------------------------

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Used for API key, service token, and secret comparisons.
 */
function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Algorithms considered safe for JWT signature verification. */
const ALLOWED_ALGORITHMS = new Set(["RS256", "ES256", "HS256"]);

/** Parse a JWT without verifying the signature. */
function parseJwt(token: string): JwtParts | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;

  try {
    const header = JSON.parse(decodeBase64Url(segments[0]));
    const payload = JSON.parse(decodeBase64Url(segments[1]));
    return { header, payload, signature: segments[2] };
  } catch {
    return null;
  }
}

/**
 * Verify HMAC-SHA256 signature for a JWT.
 * Returns true if the signature is valid, false otherwise.
 */
function verifyHs256Signature(
  token: string,
  secret: string,
): boolean {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;

  const signingInput = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);

  const expectedSig = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  // Constant-time comparison
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate JWT algorithm and signature.
 * - Rejects `alg: "none"` unconditionally
 * - Only allows RS256, ES256, HS256
 * - For HS256: verifies signature using SPACEHARBOR_JWT_SECRET
 * - For RS256/ES256: verifies via JWKS with kid-based key selection
 * - Fail-closed: rejects if no secret/JWKS is configured
 */
async function verifyJwtSignature(
  token: string,
  header: Record<string, unknown>,
  oidc: OidcConfig,
): Promise<string | null> {
  const alg = typeof header.alg === "string" ? header.alg : "";

  // Reject alg: "none" unconditionally
  if (alg.toLowerCase() === "none") {
    return "JWT algorithm 'none' is not allowed";
  }

  // Only allow known-safe algorithms
  if (!ALLOWED_ALGORITHMS.has(alg)) {
    return `JWT algorithm '${alg}' is not supported; allowed: ${[...ALLOWED_ALGORITHMS].join(", ")}`;
  }

  // HS256 — verify with shared secret
  if (alg === "HS256") {
    const secret = process.env.SPACEHARBOR_JWT_SECRET?.trim();
    if (!secret) {
      return "HS256 JWT verification requires SPACEHARBOR_JWT_SECRET to be configured";
    }
    if (!verifyHs256Signature(token, secret)) {
      return "invalid JWT signature";
    }
    return null;
  }

  // RS256/ES256 — require JWKS URI for asymmetric verification
  if (!oidc.jwksUri) {
    return `JWT algorithm '${alg}' requires SPACEHARBOR_OIDC_JWKS_URI to be configured`;
  }

  const kid = typeof header.kid === "string" ? header.kid : "default";
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return "malformed JWT: missing signature segment";

  const signingInput = token.slice(0, lastDot);
  const signatureB64 = token.slice(lastDot + 1);
  const signature = Buffer.from(signatureB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  // Attempt verification with cached keys first
  let keys = await getJwksKeys(oidc.jwksUri);
  let keyEntry = keys.get(kid);

  // If kid not found in cache, refresh JWKS once (handles IdP key rotation)
  if (!keyEntry) {
    keys = await getJwksKeys(oidc.jwksUri, true);
    keyEntry = keys.get(kid);
  }

  if (!keyEntry) {
    return `no matching key found in JWKS for kid '${kid}'`;
  }

  // Enforce algorithm match: reject if token's alg doesn't match the key's alg
  if (keyEntry.alg !== alg) {
    return `algorithm mismatch: token uses '${alg}' but key '${kid}' expects '${keyEntry.alg}'`;
  }

  let valid: boolean;
  if (alg === "RS256") {
    valid = verifyRS256(signingInput, signature, keyEntry.keyObject);
  } else {
    valid = verifyES256(signingInput, signature, keyEntry.keyObject);
  }

  if (!valid) {
    // Refresh JWKS and retry once (transparent key rotation recovery)
    keys = await getJwksKeys(oidc.jwksUri, true);
    keyEntry = keys.get(kid);
    if (!keyEntry || keyEntry.alg !== alg) {
      return "invalid JWT signature";
    }

    valid = alg === "RS256"
      ? verifyRS256(signingInput, signature, keyEntry.keyObject)
      : verifyES256(signingInput, signature, keyEntry.keyObject);

    if (!valid) {
      return "invalid JWT signature";
    }
  }

  return null;
}

/** Validate standard JWT claims (exp, nbf, iss, aud). Returns error string or null. */
function validateClaims(
  payload: Record<string, unknown>,
  oidc: OidcConfig,
): string | null {
  // exp — REQUIRED: tokens without expiration are rejected (CWE-613)
  if (typeof payload.exp !== "number") {
    return "token missing expiration claim (exp)";
  }

  // exp — must not be expired
  {
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      return "token expired";
    }
  }

  // nbf — must not be used before this time (with 30s clock skew tolerance)
  if (typeof payload.nbf === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.nbf > nowSec + 30) {
      return "token not yet valid (nbf)";
    }
  }

  // iss — must match configured issuer (when configured)
  if (oidc.issuer && payload.iss !== oidc.issuer) {
    return `issuer mismatch: expected ${oidc.issuer}`;
  }

  // aud — must match configured audience (when configured)
  if (oidc.audience) {
    const aud = payload.aud;
    const matches =
      aud === oidc.audience ||
      (Array.isArray(aud) && aud.includes(oidc.audience));
    if (!matches) {
      return `audience mismatch: expected ${oidc.audience}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

interface ExtractedClaims {
  externalId: string;
  email: string | null;
  displayName: string;
  groups: string[];
  tenantId: string;
  roles: Role[];
}

function extractClaims(payload: Record<string, unknown>): ExtractedClaims {
  const sub = typeof payload.sub === "string" ? payload.sub : "unknown";
  const email = typeof payload.email === "string" ? payload.email : null;
  const displayName =
    typeof payload.display_name === "string"
      ? payload.display_name
      : typeof payload.name === "string"
        ? payload.name
        : email ?? sub;

  const rawGroups = payload.groups;
  const groups: string[] = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : [];

  const tenantId =
    typeof payload.tenant_id === "string"
      ? payload.tenant_id
      : "default";

  // Map group claims to roles where they match known role names
  const knownRoles = new Set<string>([
    "viewer", "artist", "reviewer", "librarian",
    "supervisor", "production", "pipeline_td",
    "platform_operator", "administrator", "super_admin",
  ]);
  const roles: Role[] = [];
  const rawRoles = payload.roles;
  if (Array.isArray(rawRoles)) {
    for (const r of rawRoles) {
      if (typeof r === "string" && knownRoles.has(r)) {
        roles.push(r as Role);
      }
    }
  }
  // Never derive administrator/super_admin from group claims — these must come
  // from explicit role assignments via RoleBindingService or the token's roles claim.
  const PRIVILEGED_ROLES = new Set(["administrator", "super_admin"]);
  for (const g of groups) {
    if (knownRoles.has(g) && !PRIVILEGED_ROLES.has(g) && !roles.includes(g as Role)) {
      roles.push(g as Role);
    }
  }

  // Default to viewer if no roles resolved
  if (roles.length === 0) {
    roles.push("viewer");
  }

  return { externalId: sub, email, displayName, groups, tenantId, roles };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function buildAnonymousContext(): RequestContext {
  return {
    userId: "anonymous",
    displayName: "Anonymous",
    email: null,
    authStrategy: "anonymous",
    scope: { tenantId: "default", projectId: null, source: "default" },
    roles: [],
    permissions: new Set(),
    externalId: null,
    groups: [],
    tokenClaims: null,
  };
}

function buildApiKeyContext(configuredKey: string): RequestContext {
  return {
    userId: "api-key-user",
    displayName: "API Key",
    email: null,
    authStrategy: "api_key",
    scope: { tenantId: "default", projectId: null, source: "default" },
    roles: ["administrator"],
    permissions: getEffectivePermissionsForRoles(["administrator"]),
    externalId: null,
    groups: [],
    tokenClaims: null,
  };
}

function buildServiceTokenContext(token: string): RequestContext {
  return {
    userId: "service-account",
    displayName: "Service Account",
    email: null,
    authStrategy: "service_token",
    scope: { tenantId: "default", projectId: null, source: "default" },
    roles: ["administrator"],
    permissions: getEffectivePermissionsForRoles(["administrator"]),
    externalId: null,
    groups: [],
    tokenClaims: null,
  };
}

function buildJwtContext(
  claims: ExtractedClaims,
  rawPayload: Record<string, unknown>,
): RequestContext {
  return {
    userId: claims.externalId,
    displayName: claims.displayName,
    email: claims.email,
    authStrategy: "jwt",
    scope: {
      tenantId: claims.tenantId,
      projectId: null,
      source: "token",
    },
    roles: claims.roles,
    permissions: getEffectivePermissionsForRoles(claims.roles),
    externalId: claims.externalId,
    groups: claims.groups,
    tokenClaims: rawPayload,
  };
}

// ---------------------------------------------------------------------------
// Per-service credential support
// ---------------------------------------------------------------------------

/**
 * Resolves the full list of valid API keys from the environment.
 *
 * Supports two env vars (both can be used simultaneously):
 *   - `SPACEHARBOR_API_KEY`  — single key (backward compat)
 *   - `SPACEHARBOR_API_KEYS` — comma-separated list of per-service keys
 *
 * Returns a deduplicated array of non-empty trimmed keys.
 */
export function resolveValidApiKeys(): string[] {
  const keys = new Set<string>();

  // Legacy single key
  const singleKey = process.env.SPACEHARBOR_API_KEY?.trim();
  if (singleKey) keys.add(singleKey);

  // Per-service comma-separated keys
  const multiKeys = process.env.SPACEHARBOR_API_KEYS?.trim();
  if (multiKeys) {
    for (const raw of multiKeys.split(",")) {
      const k = raw.trim();
      if (k) keys.add(k);
    }
  }

  return [...keys];
}

/**
 * Check whether a provided API key matches any configured valid key.
 * Uses constant-time comparison for each candidate.
 */
export function isValidApiKey(provided: string): boolean {
  const validKeys = resolveValidApiKeys();
  return validKeys.some((k) => safeCompare(provided, k));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AuthResult =
  | { ok: true; context: RequestContext }
  | { ok: false; statusCode: number; code: string; message: string };

/**
 * Resolves authentication for a request. Evaluates strategies in order:
 * JWT bearer > API key > service token > anonymous fallback.
 *
 * When IAM is disabled (feature flag), returns anonymous context immediately.
 */
export async function resolveAuth(
  headers: Record<string, string | string[] | undefined>,
  flags?: IamFeatureFlags,
  oidcOverride?: OidcConfig,
): Promise<AuthResult> {
  const iamFlags = flags ?? resolveIamFlags();

  // When IAM is disabled, return anonymous context (skip all auth)
  if (!iamFlags.iamEnabled) {
    return { ok: true, context: buildAnonymousContext() };
  }

  const oidc = oidcOverride ?? resolveOidcConfig();

  // --- Strategy 1: JWT bearer token ---
  const authHeader = normalizeHeader(headers["authorization"]);
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!token) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: "empty bearer token" };
    }

    const jwt = parseJwt(token);
    if (!jwt) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: "malformed JWT" };
    }

    // Verify JWT algorithm and signature (fail-closed)
    const sigError = await verifyJwtSignature(token, jwt.header, oidc);
    if (sigError) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: sigError };
    }

    // Validate standard claims
    const claimError = validateClaims(jwt.payload, oidc);
    if (claimError) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: claimError };
    }

    const claims = extractClaims(jwt.payload);

    // JIT provisioning: auto-create user record if not found (non-fatal)
    try { await jitProvisionUser(claims); } catch { /* JIT failure is non-fatal */ }

    return { ok: true, context: buildJwtContext(claims, jwt.payload) };
  }

  // --- Strategy 2: API key ---
  // Supports per-service credentials: SPACEHARBOR_API_KEYS (comma-separated)
  // with backward-compatible fallback to single SPACEHARBOR_API_KEY.
  const apiKey = normalizeHeader(headers["x-api-key"]);
  if (apiKey) {
    const validKeys = resolveValidApiKeys();
    if (validKeys.length === 0) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: "API key auth not configured" };
    }
    const matched = validKeys.some((k) => safeCompare(apiKey, k));
    if (!matched) {
      return { ok: false, statusCode: 403, code: "FORBIDDEN", message: "invalid API key" };
    }
    return { ok: true, context: buildApiKeyContext(apiKey) };
  }

  // --- Strategy 3: Service token ---
  const serviceToken = normalizeHeader(headers["x-service-token"]);
  if (serviceToken) {
    const configuredToken = process.env.SPACEHARBOR_SERVICE_TOKEN?.trim();
    if (!configuredToken) {
      return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: "service token auth not configured" };
    }
    if (!safeCompare(serviceToken, configuredToken)) {
      return { ok: false, statusCode: 403, code: "FORBIDDEN", message: "invalid service token" };
    }
    return { ok: true, context: buildServiceTokenContext(serviceToken) };
  }

  // --- No credentials: deny when IAM is enabled ---
  return { ok: false, statusCode: 401, code: "UNAUTHORIZED", message: "authentication required" };
}

/**
 * Fastify-compatible hook that resolves auth and attaches RequestContext
 * to the request. Sends error response and short-circuits on failure.
 */
export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await resolveAuth(
    request.headers as Record<string, string | string[] | undefined>,
  );

  if (!result.ok) {
    reply.status(result.statusCode).send({
      code: result.code,
      message: result.message,
      requestId: request.id,
      details: null,
    });
    return;
  }

  // Attach context to request for downstream handlers and guards
  (request as any).iamContext = result.context;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
