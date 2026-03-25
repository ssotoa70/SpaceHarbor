// ---------------------------------------------------------------------------
// Phase 8: Feature Flags for IAM Gradual Rollout
// SERGIO-98 (Slice 1) — secure-by-default: IAM enabled, shadow mode off.
// Disable explicitly via SPACEHARBOR_IAM_ENABLED=false plus
// SPACEHARBOR_ALLOW_INSECURE_MODE=true.
// ---------------------------------------------------------------------------

import type { RolloutRing } from "./types.js";

export interface IamFeatureFlags {
  /** Master switch: enable IAM module (default: true). */
  iamEnabled: boolean;
  /** Shadow mode: evaluate authz but don't enforce (default: false). */
  shadowMode: boolean;
  /** Enforce read-scope entitlements (Slice 6). */
  enforceReadScope: boolean;
  /** Enforce write-scope entitlements (Slice 7). */
  enforceWriteScope: boolean;
  /** Enforce approval separation-of-duties (Slice 8). */
  enforceApprovalSod: boolean;
  /** Enable lock-state enforcement (Slice 9). */
  enableLockState: boolean;
  /** Enable break-glass elevation (Slice 9). */
  enableBreakGlass: boolean;
  /** Enable SCIM sync (Slice 10). */
  enableScimSync: boolean;
  /** Current rollout ring. */
  rolloutRing: RolloutRing;
  /** Tenants with IAM enforcement enabled (pilot ring). */
  allowlistedTenants: string[];
}

const ENV_PREFIX = "SPACEHARBOR_IAM_";

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[`${ENV_PREFIX}${key}`];
  if (val === undefined) return fallback;
  return val === "true" || val === "1";
}

function envString(key: string, fallback: string): string {
  return process.env[`${ENV_PREFIX}${key}`] ?? fallback;
}

function envList(key: string): string[] {
  const val = process.env[`${ENV_PREFIX}${key}`];
  if (!val) return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates IAM insecure-mode gating. Throws a startup error when IAM is
 * explicitly disabled but SPACEHARBOR_ALLOW_INSECURE_MODE is not set.
 * Must be called during server startup, before accepting traffic.
 */
export function validateIamInsecureMode(iamEnabled: boolean): void {
  if (!iamEnabled) {
    const allowInsecure = process.env.SPACEHARBOR_ALLOW_INSECURE_MODE === "true";
    if (!allowInsecure) {
      throw new Error(
        "IAM is disabled but SPACEHARBOR_ALLOW_INSECURE_MODE is not set. " +
        "Set SPACEHARBOR_ALLOW_INSECURE_MODE=true to explicitly run without authentication."
      );
    }
    console.warn(
      "WARNING: Running with IAM DISABLED. All endpoints are unauthenticated. " +
      "This is NOT safe for production."
    );
  }
}

// Runtime overrides set from the Settings UI. These merge on top of env defaults
// so admins can toggle flags without restarting the process.
let runtimeOverrides: Partial<IamFeatureFlags> = {};

/**
 * Apply runtime overrides from the Settings UI. Called on startup (from
 * settings store) and on PUT /platform/settings/iam.
 */
export function setIamRuntimeOverrides(overrides: Partial<IamFeatureFlags>): void {
  runtimeOverrides = { ...overrides };
}

/** Returns the current runtime overrides (for serialisation to settings store). */
export function getIamRuntimeOverrides(): Partial<IamFeatureFlags> {
  return { ...runtimeOverrides };
}

/**
 * Resolves IAM feature flags from environment variables, then merges runtime
 * overrides on top. Secure-by-default: IAM is enabled and shadow mode is off.
 * Opt out with SPACEHARBOR_IAM_ENABLED=false + SPACEHARBOR_ALLOW_INSECURE_MODE=true.
 */
export function resolveIamFlags(): IamFeatureFlags {
  const env: IamFeatureFlags = {
    iamEnabled: envBool("ENABLED", true),
    shadowMode: envBool("SHADOW_MODE", false),
    enforceReadScope: envBool("ENFORCE_READ_SCOPE", false),
    enforceWriteScope: envBool("ENFORCE_WRITE_SCOPE", false),
    enforceApprovalSod: envBool("ENFORCE_APPROVAL_SOD", false),
    enableLockState: envBool("ENABLE_LOCK_STATE", false),
    enableBreakGlass: envBool("ENABLE_BREAK_GLASS", false),
    enableScimSync: envBool("ENABLE_SCIM_SYNC", false),
    rolloutRing: envString("ROLLOUT_RING", "internal") as RolloutRing,
    allowlistedTenants: envList("ALLOWLISTED_TENANTS"),
  };
  return { ...env, ...runtimeOverrides };
}

/**
 * Checks whether IAM enforcement applies to a given tenant.
 * Returns true only when IAM is enabled AND the tenant is in the allowlist
 * (or rollout ring is "general" which covers all tenants).
 */
export function isEnforcementActive(flags: IamFeatureFlags, tenantId: string): boolean {
  if (!flags.iamEnabled) return false;
  if (flags.rolloutRing === "general") return true;
  return flags.allowlistedTenants.includes(tenantId);
}
