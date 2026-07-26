import { randomUUID } from "node:crypto";
import { db, profilesTable, type Profile } from "@workspace/db";
import { hashPin, verifyPin, createLockoutTracker } from "./pinCrypto";

/** Phone access codes are exactly 6 digits -- enforced here so an unclaimed
 * code doesn't silently self-register an account for arbitrary garbage
 * (a mis-transcribed word, an empty string, etc). */
export const PHONE_ACCESS_CODE_PATTERN = /^[0-9]{6}$/;

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

/**
 * Self-service phone-only account creation: called when a caller gives a
 * code that doesn't match anything (mcpBridge.ts's verify_caller). There is
 * no Clerk account behind this profile -- userId is a synthetic
 * `phone_<uuid>`, deliberately shaped so it can never collide with (or be
 * confused for) a real Clerk user id, since this profile is unreachable from
 * the web app (every /api/* route except the MCP bridge and healthz
 * requires a real Clerk session). It's reachable only by calling back in
 * with the same code.
 *
 * Known race: two callers picking the identical unclaimed code at the same
 * instant could both pass the "not found" check before either insert lands,
 * creating two profiles for one plaintext code (harmless but confusing --
 * whichever row getProfileByAccessCode happens to scan first "wins" future
 * lookups). Not worth a locking scheme for a personal phone line's traffic;
 * revisit if this app ever fields concurrent first-time callers at scale.
 */
export async function createProfileForAccessCode(code: string): Promise<Profile> {
  const userId = `phone_${randomUUID()}`;
  const [profile] = await db
    .insert(profilesTable)
    .values({ userId, phoneAccessCodeHash: hashPin(code) })
    .returning();
  return profile;
}
