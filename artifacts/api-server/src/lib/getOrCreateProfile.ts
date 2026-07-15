import { eq } from "drizzle-orm";
import { db, profilesTable, type Profile } from "@workspace/db";

/**
 * Fetches the profile for a Clerk user, auto-creating one on first access
 * (JIT provisioning) so every authenticated request has a companion identity
 * to work with without a separate signup step.
 */
export async function getOrCreateProfile(userId: string): Promise<Profile> {
  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (existing) return existing;

  const [created] = await db
    .insert(profilesTable)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // Lost a race with a concurrent request that inserted first.
  const [afterRace] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!afterRace) {
    throw new Error(`Failed to create or fetch profile for user ${userId}`);
  }
  return afterRace;
}
