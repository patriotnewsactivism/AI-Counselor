import type { Profile } from "@workspace/db";

/**
 * Profile response schema includes booleans derived from secret-holding
 * columns (historyPinHash, phoneAccessCodeHash) -- the raw hashes themselves
 * must never reach the client, and the response Zod schemas strip unknown
 * keys, so this only needs to compute the derived fields and let `.parse()`
 * drop the rest.
 */
export function toProfileResponse(profile: Profile) {
  return {
    ...profile,
    historyPinEnabled: Boolean(profile.historyPinHash),
    phoneAccessCodeEnabled: Boolean(profile.phoneAccessCodeHash),
  };
}
