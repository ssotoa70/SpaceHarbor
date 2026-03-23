// ---------------------------------------------------------------------------
// Phase 2.3.2: Local User Authentication — Password Hashing Utility
// ---------------------------------------------------------------------------

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

/**
 * Hash a password using crypto.scrypt with a random 16-byte salt.
 * Returns a string in the format `salt:hash` (hex-encoded).
 */
export function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);

  return new Promise((resolve, reject) => {
    scrypt(
      plaintext,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt.toString("hex")}:${derivedKey.toString("hex")}`);
      },
    );
  });
}

/**
 * Verify a plaintext password against a stored `salt:hash` string.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyPassword(
  plaintext: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return Promise.resolve(false);

  const [saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  return new Promise((resolve, reject) => {
    scrypt(
      plaintext,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        if (derivedKey.length !== expected.length) {
          resolve(false);
          return;
        }
        resolve(timingSafeEqual(derivedKey, expected));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Password policy enforcement
// ---------------------------------------------------------------------------

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a password against the SpaceHarbor password policy:
 * - Minimum 12 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 */
export function validatePasswordPolicy(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push("password must be at least 12 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("password must contain at least 1 uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("password must contain at least 1 lowercase letter");
  }
  if (!/\d/.test(password)) {
    errors.push("password must contain at least 1 digit");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Login throttling (per-email sliding window)
// ---------------------------------------------------------------------------

interface ThrottleEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

export class LoginThrottler {
  private entries = new Map<string, ThrottleEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;

  constructor(options?: { maxAttempts?: number; windowMs?: number; lockoutMs?: number }) {
    this.maxAttempts = options?.maxAttempts ?? 5;
    this.windowMs = options?.windowMs ?? 15 * 60 * 1000; // 15 minutes
    this.lockoutMs = options?.lockoutMs ?? 15 * 60 * 1000; // 15 minutes
  }

  /**
   * Check if a login attempt is allowed for the given email.
   * Returns false if the email is throttled.
   */
  isAllowed(email: string): boolean {
    const entry = this.entries.get(email);
    if (!entry) return true;

    const now = Date.now();

    // Check lockout
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return false;
    }

    // Reset if lockout expired or window expired
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      this.entries.delete(email);
      return true;
    }

    if (now - entry.firstAttemptAt > this.windowMs) {
      this.entries.delete(email);
      return true;
    }

    return entry.attempts < this.maxAttempts;
  }

  /**
   * Record a failed login attempt for the given email.
   * Returns the number of attempts in the current window.
   */
  recordFailure(email: string): number {
    const now = Date.now();
    const entry = this.entries.get(email);

    if (!entry || now - entry.firstAttemptAt > this.windowMs) {
      const newEntry: ThrottleEntry = {
        attempts: 1,
        firstAttemptAt: now,
        lockedUntil: null,
      };
      this.entries.set(email, newEntry);
      return 1;
    }

    entry.attempts++;

    if (entry.attempts >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockoutMs;
    }

    return entry.attempts;
  }

  /**
   * Reset throttle state for an email (e.g., after successful login).
   */
  reset(email: string): void {
    this.entries.delete(email);
  }

  /**
   * Returns the total number of failed attempts for an email in the current window.
   */
  getAttempts(email: string): number {
    const entry = this.entries.get(email);
    if (!entry) return 0;
    const now = Date.now();
    if (now - entry.firstAttemptAt > this.windowMs) return 0;
    return entry.attempts;
  }
}
