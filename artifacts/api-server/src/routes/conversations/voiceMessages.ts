import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, voiceProfilesTable } from "@workspace/db";
import { SendVoiceMessageParams, SendVoiceMessageBody, SendVoiceMessageResponse } from "@workspace/api-zod";
import { transcribeAudio, synthesizeSpeech } from "@workspace/deepgram";
import { identifyOrEnrollSpeaker, extractIntroducedName } from "@workspace/gemini";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { getOrCreateProfile } from "../../lib/getOrCreateProfile";
import { runCompanionExchange } from "../../lib/companionExchange";
import { findOwnedConversation } from "./shared";

const router: IRouter = Router();

router.post("/conversations/:id/voice-messages", requireAuth, async (req, res): Promise<void> => {
  const params = SendVoiceMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendVoiceMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = (req as AuthedRequest).userId;
  const conversation = await findOwnedConversation(params.data.id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const profile = await getOrCreateProfile(userId);

  // ── 1. Transcribe ────────────────────────────────────────────────────────
  let transcript: string;
  const audioBuffer = Buffer.from(body.data.audioBase64, "base64");
  try {
    transcript = await transcribeAudio(audioBuffer, body.data.mimeType);
  } catch (err) {
    req.log.warn({ err }, "Voice transcription failed");
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not transcribe audio",
    });
    return;
  }

  // ── 2. Speaker identification (best-effort, never blocks the reply) ──────
  let speakerName: string | null = null;
  let autoEnrolled = false;

  try {
    const enrolledProfiles = await db
      .select({
        id: voiceProfilesTable.id,
        name: voiceProfilesTable.name,
        sampleAudio: voiceProfilesTable.sampleAudio,
        sampleMimeType: voiceProfilesTable.sampleMimeType,
      })
      .from(voiceProfilesTable)
      .where(eq(voiceProfilesTable.userId, userId));

    const result = await identifyOrEnrollSpeaker({
      profiles: enrolledProfiles,
      newAudioBase64: body.data.audioBase64,
      newMimeType: body.data.mimeType,
      transcript,
    });

    if (result.matchedProfileId !== null) {
      // Known voice — update lastHeardAt and carry the name forward
      speakerName = result.matchedName;
      db.update(voiceProfilesTable)
        .set({ lastHeardAt: new Date() })
        .where(eq(voiceProfilesTable.id, result.matchedProfileId))
        .execute()
        .catch(() => { /* non-critical */ });
    } else if (result.introducedName) {
      // New person introduced themselves — auto-enrol their voice once. A
      // same-name check protects against duplicate mobile retries.
      const [existing] = await db
        .select({ id: voiceProfilesTable.id, name: voiceProfilesTable.name })
        .from(voiceProfilesTable)
        .where(and(eq(voiceProfilesTable.userId, userId), eq(voiceProfilesTable.name, result.introducedName)));
      if (existing) {
        speakerName = existing.name;
        autoEnrolled = false;
        db.update(voiceProfilesTable)
          .set({ lastHeardAt: new Date() })
          .where(and(eq(voiceProfilesTable.id, existing.id), eq(voiceProfilesTable.userId, userId)))
          .execute()
          .catch(() => { /* non-critical */ });
      } else {
        const [newProfile] = await db
          .insert(voiceProfilesTable)
          .values({
            userId,
            name: result.introducedName,
            sampleAudio: body.data.audioBase64,
            sampleMimeType: body.data.mimeType,
          })
          .returning({ id: voiceProfilesTable.id, name: voiceProfilesTable.name });
        speakerName = newProfile.name;
        autoEnrolled = true;
        req.log.info({ name: result.introducedName }, "Auto-enrolled new voice profile from self-introduction");
      }
    }
  } catch (err) {
    // Speaker ID is completely optional — log and continue
    req.log.warn({ err }, "Speaker identification failed, continuing without it");
  }

  // Retries can happen when a mobile turn is replayed. Reuse a profile created
  // by the previous request instead of inserting duplicate voice rows.
  if (!speakerName) {
    const introducedName = extractIntroducedName(transcript);
    if (introducedName) {
      const [existing] = await db
        .select({ id: voiceProfilesTable.id, name: voiceProfilesTable.name })
        .from(voiceProfilesTable)
        .where(and(eq(voiceProfilesTable.userId, userId), eq(voiceProfilesTable.name, introducedName)));
      if (existing) speakerName = existing.name;
    }
  }

  // ── 3. Companion exchange ────────────────────────────────────────────────
  const { userMessage, assistantMessage } = await runCompanionExchange({
    conversationId: params.data.id,
    profile,
    userContent: transcript,
    audioMimeType: body.data.mimeType,
    speakerName,
  });

  // ── 4. Synthesise reply as speech ────────────────────────────────────────
  const { audio, mimeType } = await synthesizeSpeech(assistantMessage.content);

  res.status(201).json(
    SendVoiceMessageResponse.parse({
      userMessage,
      assistantMessage,
      audioBase64: audio.toString("base64"),
      audioMimeType: mimeType,
      speakerName,
      autoEnrolled,
    }),
  );
});

export default router;
