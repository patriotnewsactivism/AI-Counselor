import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const voiceProfilesTable = pgTable("voice_profiles", {
  id: serial("id").primaryKey(),
  /** Clerk userId of the account owner — all profiles belong to one account */
  userId: text("user_id").notNull(),
  /** Display name for this voice (e.g. "Zach", "Mom") */
  name: text("name").notNull(),
  /** Short enrollment audio clip stored as base64 — used as reference for future matching */
  sampleAudio: text("sample_audio").notNull(),
  sampleMimeType: text("sample_mime_type").notNull(),
  /** Updated whenever this voice is successfully recognised in a conversation */
  lastHeardAt: timestamp("last_heard_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertVoiceProfileSchema = createInsertSchema(voiceProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastHeardAt: true,
});
export type InsertVoiceProfile = z.infer<typeof insertVoiceProfileSchema>;
export type VoiceProfile = typeof voiceProfilesTable.$inferSelect;
