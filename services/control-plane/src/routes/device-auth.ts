// ---------------------------------------------------------------------------
// Phase 3.5: Device Authorization Grant (RFC 8628)
// For DCC plugins (Maya, Nuke, Houdini) that can't do browser redirects.
// ---------------------------------------------------------------------------

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { withPrefix } from "../http/routes.js";
import type { RoleBindingService } from "../iam/role-binding.js";
import type { PersistentRoleBindingService } from "../iam/persistent-role-binding.js";
import { getEffectivePermissionsForRoles } from "../iam/permissions.js";
import type { RequestContext } from "../iam/types.js";

type RoleService = RoleBindingService | PersistentRoleBindingService;

// Resolve result from sync or async role binding service
async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

// ---------------------------------------------------------------------------
// Device code state
// ---------------------------------------------------------------------------

interface DeviceCodeEntry {
  userCode: string;
  userId: string | null;
  status: "pending" | "approved" | "expired";
  expiresAt: number;
  createdAt: number;
}

// deviceCode -> DeviceCodeEntry
const deviceCodeStore = new Map<string, DeviceCodeEntry>();

// userCode -> deviceCode (reverse lookup for authorization)
const userCodeIndex = new Map<string, string>();

// Import the refreshTokenStore from iam routes (shared state)
// We re-export from iam.ts so device-auth can issue compatible refresh tokens
import { refreshTokenStore } from "./iam.js";

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_SEC = 5;

// Periodic cleanup of expired device codes to prevent unbounded memory growth.
// Runs every 60 seconds; removes entries past their TTL.
setInterval(() => {
  const now = Date.now();
  for (const [deviceCode, entry] of deviceCodeStore) {
    if (now > entry.expiresAt) {
      userCodeIndex.delete(entry.userCode);
      deviceCodeStore.delete(deviceCode);
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// JWT generation (same as iam.ts — shared utility)
// ---------------------------------------------------------------------------

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function createHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number = 3600,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  const signature = hmac.digest("base64url");

  return `${data}.${signature}`;
}

/**
 * Generate a human-readable 8-character alphanumeric user code.
 */
function generateUserCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 to avoid confusion
  let code = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerDeviceAuthRoutes(
  app: FastifyInstance,
  getRoleService: () => RoleService,
  prefixes: string[] = ["", "/api/v1"],
): void {
  for (const prefix of prefixes) {
    // -----------------------------------------------------------------------
    // POST /auth/device/code — Request device + user code
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/device/code"), {
      schema: {
        tags: ["iam"],
        operationId: "deviceAuthCode",
        summary: "RFC 8628 — Request device and user codes for DCC plugin authentication",
        security: [],
        body: {
          type: "object",
          properties: {
            client_id: { type: "string", description: "Optional client identifier" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              deviceCode: { type: "string" },
              userCode: { type: "string" },
              verificationUri: { type: "string" },
              expiresIn: { type: "number" },
              interval: { type: "number" },
            },
          },
        },
      },
    }, async (request, reply) => {
      const deviceCode = randomBytes(32).toString("hex");
      const userCode = generateUserCode();
      const now = Date.now();

      const baseUrl = process.env.SPACEHARBOR_BASE_URL ?? `${request.protocol}://${request.hostname}`;

      deviceCodeStore.set(deviceCode, {
        userCode,
        userId: null,
        status: "pending",
        expiresAt: now + DEVICE_CODE_TTL_MS,
        createdAt: now,
      });

      userCodeIndex.set(userCode, deviceCode);

      return reply.send({
        deviceCode,
        userCode,
        verificationUri: `${baseUrl}/auth/device`,
        expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
        interval: POLL_INTERVAL_SEC,
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/device/token — DCC plugin polls this with deviceCode
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/device/token"), {
      schema: {
        tags: ["iam"],
        operationId: "deviceAuthToken",
        summary: "RFC 8628 — Poll for access token after user authorization",
        security: [],
        body: {
          type: "object",
          required: ["deviceCode"],
          properties: {
            deviceCode: { type: "string" },
            grant_type: { type: "string", description: "Must be urn:ietf:params:oauth:grant-type:device_code" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              accessToken: { type: "string" },
              refreshToken: { type: "string" },
              expiresIn: { type: "number" },
              tokenType: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              error_description: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
              error_description: { type: "string" },
            },
          },
        },
      },
    }, async (request, reply) => {
      const body = request.body as { deviceCode?: string } | null;
      if (!body?.deviceCode) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "deviceCode is required",
          requestId: request.id,
          details: null,
        });
      }

      const entry = deviceCodeStore.get(body.deviceCode);
      if (!entry) {
        return reply.status(400).send({
          error: "invalid_grant",
          error_description: "unknown device code",
        });
      }

      // Check expiration
      if (Date.now() > entry.expiresAt || entry.status === "expired") {
        entry.status = "expired";
        return reply.status(400).send({
          error: "expired_token",
          error_description: "device code has expired",
        });
      }

      // Still pending
      if (entry.status === "pending") {
        return reply.status(400).send({
          error: "authorization_pending",
          error_description: "waiting for user authorization",
        });
      }

      // Approved — issue tokens
      if (entry.status === "approved" && entry.userId) {
        const svc = getRoleService();
        const user = await resolve(svc.getUserById(entry.userId));
        if (!user) {
          return reply.status(400).send({
            error: "server_error",
            error_description: "user not found",
          });
        }

        const roles = await resolve(svc.getEffectiveRoles(user.id, null));
        // Fail-closed: refuse to issue tokens without a configured secret
        const jwtSecret = process.env.SPACEHARBOR_JWT_SECRET?.trim();
        if (!jwtSecret) {
          return reply.status(500).send({
            error: "server_error",
            error_description: "JWT secret is not configured — cannot issue tokens",
          });
        }

        const accessToken = createHs256Jwt(
          {
            sub: user.id,
            email: user.email,
            display_name: user.displayName,
            roles,
            device_flow: true,
          },
          jwtSecret,
          3600,
        );

        // Long-lived 30-day refresh token for DCC plugins
        const refreshHash = randomBytes(16).toString("hex");
        refreshTokenStore.set(refreshHash, {
          userId: user.id,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
          revokedAt: null,
        });

        // Clean up device code after successful token issuance
        deviceCodeStore.delete(body.deviceCode);
        userCodeIndex.delete(entry.userCode);

        return reply.send({
          accessToken,
          refreshToken: refreshHash,
          expiresIn: 3600,
          tokenType: "Bearer",
        });
      }

      return reply.status(400).send({
        error: "server_error",
        error_description: "unexpected state",
      });
    });

    // -----------------------------------------------------------------------
    // POST /auth/device/authorize — User approves from browser
    // -----------------------------------------------------------------------
    app.post(withPrefix(prefix, "/auth/device/authorize"), {
      schema: {
        tags: ["iam"],
        operationId: "deviceAuthAuthorize",
        summary: "Approve a pending device authorization — requires authenticated browser session",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["userCode"],
          properties: {
            userCode: { type: "string", description: "8-character code displayed on the device" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
              userCode: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          401: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
          404: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {},
            },
          },
        },
      },
    }, async (request, reply) => {
      // Requires authenticated session
      const ctx = (request as any).iamContext as RequestContext | undefined;
      if (!ctx || ctx.authStrategy === "anonymous") {
        return reply.status(401).send({
          code: "UNAUTHORIZED",
          message: "authentication required to authorize device",
          requestId: request.id,
          details: null,
        });
      }

      const body = request.body as { userCode?: string } | null;
      if (!body?.userCode) {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "userCode is required",
          requestId: request.id,
          details: null,
        });
      }

      const deviceCode = userCodeIndex.get(body.userCode);
      if (!deviceCode) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "invalid user code",
          requestId: request.id,
          details: null,
        });
      }

      const entry = deviceCodeStore.get(deviceCode);
      if (!entry) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "device code not found",
          requestId: request.id,
          details: null,
        });
      }

      if (Date.now() > entry.expiresAt) {
        entry.status = "expired";
        return reply.status(400).send({
          code: "EXPIRED",
          message: "device code has expired",
          requestId: request.id,
          details: null,
        });
      }

      if (entry.status !== "pending") {
        return reply.status(400).send({
          code: "BAD_REQUEST",
          message: "device code already used",
          requestId: request.id,
          details: null,
        });
      }

      // Link device code to user
      entry.userId = ctx.userId;
      entry.status = "approved";

      return reply.send({
        message: "device authorized successfully",
        userCode: body.userCode,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { deviceCodeStore, userCodeIndex };

/** Reset all device auth state (for tests). */
export function resetDeviceAuthState(): void {
  deviceCodeStore.clear();
  userCodeIndex.clear();
}
