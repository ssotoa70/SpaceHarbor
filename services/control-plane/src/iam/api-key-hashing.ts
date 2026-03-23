// ---------------------------------------------------------------------------
// Phase 1.3: API Key Hashing with crypto.scrypt
// ---------------------------------------------------------------------------

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export interface HashedApiKey {
  hash: string; // hex-encoded
  salt: string; // hex-encoded
}

/**
 * Hash an API key using scrypt with a random 16-byte salt.
 * Returns the hash and salt as hex strings.
 */
export function hashApiKey(plaintext: string): Promise<HashedApiKey> {
  const salt = randomBytes(SALT_LENGTH);

  return new Promise((resolve, reject) => {
    scrypt(
      plaintext,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve({
          hash: derivedKey.toString("hex"),
          salt: salt.toString("hex"),
        });
      },
    );
  });
}

/**
 * Verify an API key against a stored hash and salt.
 * Uses constant-time comparison.
 */
/**
 * Check if an API key has expired.
 * Returns true if the key is expired.
 */
export function isApiKeyExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false; // no expiration set
  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * Calculate expiration date for a new API key.
 * Uses SPACEHARBOR_API_KEY_MAX_AGE_DAYS env var (default: 365).
 */
export function calculateApiKeyExpiration(): string {
  const maxAgeDays = parseInt(process.env.SPACEHARBOR_API_KEY_MAX_AGE_DAYS ?? "365", 10);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + maxAgeDays);
  return expiresAt.toISOString();
}

export function verifyApiKey(
  plaintext: string,
  storedHash: string,
  storedSalt: string,
): Promise<boolean> {
  const salt = Buffer.from(storedSalt, "hex");

  return new Promise((resolve, reject) => {
    scrypt(
      plaintext,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (err, derivedKey) => {
        if (err) return reject(err);
        const expected = Buffer.from(storedHash, "hex");
        if (derivedKey.length !== expected.length) {
          resolve(false);
          return;
        }
        resolve(timingSafeEqual(derivedKey, expected));
      },
    );
  });
}
