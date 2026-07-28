import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  preferredName: text("preferred_name"),
  companionName: text("companion_name").notNull().default("Clara"),
  // Salted+hashed PIN gating access to past conversations (see
  // artifacts/api-server/src/lib/historyAccess.ts). Null means the user
  // hasn't opted into a History PIN yet.
  historyPinHash: text("history_pin_hash"),
  // Salted+hashed 6-digit code identifying this account to the phone-hosted
  // xAI Voice Agent (see artifacts/api-server/src/routes/mcpBridge.ts) — the
  // phone-call equivalent of a Clerk session, since a call has no browser to
  // authenticate with. Null means phone access isn't set up for this account.
  phoneAccessCodeHash: text("phone_access_code_hash"),
  // Turn-taking preference for live voice: when true, keep listening across
  // pauses until `wakeWord` is heard as a sign-off (e.g. "over") instead of
  // ending the turn on the first silence. See live-conversation.tsx.
  wakeWordEnabled: boolean("wake_word_enabled").notNull().default(false),
  wakeWord: text("wake_word"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
