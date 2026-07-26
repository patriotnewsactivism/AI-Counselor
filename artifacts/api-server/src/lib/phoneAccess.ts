import { db, profilesTable, type Profile } from "@workspace/db";
import { verifyPin, createLockoutTracker } from "./pinCrypto";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Two separate trackers, two separate attack surfaces:
// - the Settings page (an authenticated Clerk user fumbling their own
//   currentCode), keyed by userId
// - the phone bridge (an unauthenticated caller guessing a code before any
//   identity is known), keyed by a single constant since there's no per-caller
//   identity to key on until a code actually verifies
const settingsLockout = createLockoutTracker(MAX_FAILED_ATTEMPTS, LOCKOUT_MS);
export const isPhoneAccessLockedOut = settingsLockout.isLockedOut;
export const recordFailedPhoneAccessAttempt = settingsLockout.recordFailedAttempt;
export const clearFailedPhoneAccessAttempts = settingsLockout.clearFailedAttempts;

const PHONE_BRIDGE_LOCKOUT_KEY = "phone-bridge";
const bridgeLockout = createLockoutTracker(MAX_FAILED_ATTEMPTS, LOCKOUT_MS);
export const isPhoneBridgeLockedOut = (): boolean => bridgeLockout.isLockedOut(PHONE_BRIDGE_LOCKOUT_KEY);
export const recordFailedPhoneBridgeAttempt = (): void => bridgeLockout.recordFailedAttempt(PHONE_BRIDGE_LOCKOUT_KEY);
export const clearFailedPhoneBridgeAttempts = (): void => bridgeLockout.clearFailedAttempts(PHONE_BRIDGE_LOCKOUT_KEY);

/**
 * Looks up which account a spoken/entered phone access code belongs to.
 * Codes are scrypt-hashed (like the History PIN), which is one-way by
 * design -- there's no way to look up "the profile whose code is X" with an
 * index, so this scans every profile with a code configured and verifies
 * against each. Fine at this app's scale (a handful of accounts); would need
 * a rethink (e.g. a separate lookup table keyed by a non-secret caller
 * identifier) if this app ever has many phone-enabled accounts.
 */
export async function getProfileByAccessCode(code: string): Promise<Profile | undefined> {
  const candidates = await db.select().from(profilesTable);
  for (const profile of candidates) {
    if (profile.phoneAccessCodeHash && verifyPin(code, profile.phoneAccessCodeHash)) {
      return profile;
    }
  }
  return undefined;
}
