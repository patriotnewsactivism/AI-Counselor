import { pgTable, text, timestamp, boolean, real, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Voice ID — an MFCC-based voice-biometric alternative to the History PIN.
 * Kept in its own table (not columns on `profiles`) so the sensitive
 * template blob is physically separate from the rest of the profile row,
 * mirroring the "isolated schema for biometric data" principle even though
 * this is a single-database app without Supabase-style schema-level RLS.
 *
 * `templateEncrypted` is AES-256-GCM ciphertext (see
 * artifacts/api-server/src/lib/voiceAuthCrypto.ts) of a JSON-serialized
 * numeric feature vector -- never store the raw vector or raw audio here.
 */
export const voiceAuthTemplatesTable = pgTable("voice_auth_templates", {
  userId: text("user_id").primaryKey(),
  templateEncrypted: text("template_encrypted").notNull(),
  modelVersion: text("model_version").notNull().default("mfcc-stat-v1"),
  sampleCount: integer("sample_count").notNull().default(1),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Append-only audit log of verification attempts -- lets you see (and lets
 * Don ask for) exactly how a Voice ID rejection happened: phrase mismatch
 * vs. low voice-similarity score vs. an expired/replayed challenge.
 */
export const voiceAuthAttemptsTable = pgTable("voice_auth_attempts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  success: boolean("success").notNull(),
  score: real("score"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVoiceAuthTemplateSchema = createInsertSchema(voiceAuthTemplatesTable).omit({
  enrolledAt: true,
  updatedAt: true,
});
export type InsertVoiceAuthTemplate = z.infer<typeof insertVoiceAuthTemplateSchema>;
export type VoiceAuthTemplate = typeof voiceAuthTemplatesTable.$inferSelect;

export const insertVoiceAuthAttemptSchema = createInsertSchema(voiceAuthAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVoiceAuthAttempt = z.infer<typeof insertVoiceAuthAttemptSchema>;
export type VoiceAuthAttempt = typeof voiceAuthAttemptsTable.$inferSelect;
