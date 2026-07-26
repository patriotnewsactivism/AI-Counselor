import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Shared salted-hash primitives for short user-chosen secrets (History PIN,
 * phone access code). Extracted out of historyAccess.ts once a second
 * consumer (phoneAccess.ts / mcpBridge.ts) needed the exact same hashing —
 * these are pure functions with no coupling to what the secret gates.
 */

const SCRYPT_KEYLEN = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A per-key lockout tracker (e.g. one instance per feature, keyed by userId
 * or by a fixed constant for a feature with no pre-verification identity).
 * In-memory, single-process only -- see historyAccess.ts's original note;
 * would need a shared store (Redis etc.) behind a multi-instance API server.
 */
export function createLockoutTracker(maxAttempts: number, lockoutMs: number) {
  const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

  return {
    isLockedOut(key: string): boolean {
      const entry = failedAttempts.get(key);
      if (!entry?.lockedUntil) return false;
      if (Date.now() >= entry.lockedUntil) {
        failedAttempts.delete(key);
        return false;
      }
      return true;
    },
    recordFailedAttempt(key: string): void {
      const entry = failedAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= maxAttempts) {
        entry.lockedUntil = Date.now() + lockoutMs;
        entry.count = 0;
      }
      failedAttempts.set(key, entry);
    },
    clearFailedAttempts(key: string): void {
      failedAttempts.delete(key);
    },
  };
}
