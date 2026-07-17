import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, voiceProfilesTable } from "@workspace/db";
import { SendVoiceMessageParams, SendVoiceMessageBody, SendVoiceMessageResponse } from "@workspace/api-zod";
import { transcribeAudio, synthesizeSpeech } from "@workspace/deepgram";
import { identifyOrEnrollSpeaker } from "@workspace/gemini";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { getOrCreateProfile } from "../../lib/getOrCreateProfile";
import { runCompanionExchangePipelined } from "../../lib/companionExchange";
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
      // New person introduced themselves — auto-enrol their voice
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
  } catch (err) {
    // Speaker ID is completely optional — log and continue
    req.log.warn({ err }, "Speaker identification failed, continuing without it");
  }

  // ── 3+4. Companion exchange, pipelined with per-sentence TTS ─────────────
  // The LLM reply streams in; as soon as each sentence is complete we kick
  // off its speech synthesis immediately rather than waiting for the full
  // reply text first. TTS calls run in parallel with continued generation,
  // so wall-clock latency approaches max(generation time, synthesis time)
  // instead of generation time + synthesis time. The client still gets one
  // response with one concatenated audio buffer — no API contract change.
  const ttsJobs: Promise<{ audio: Buffer; mimeType: string }>[] = [];
  let audioMimeType = "audio/mpeg";

  const { userMessage, assistantMessage } = await runCompanionExchangePipelined(
    {
      conversationId: params.data.id,
      profile,
      userContent: transcript,
      audioMimeType: body.data.mimeType,
      speakerName,
    },
    (sentence) => {
      ttsJobs.push(
        synthesizeSpeech(sentence).then((result) => {
          audioMimeType = result.mimeType;
          return result;
        }),
      );
    },
  );

  // Fallback: if streaming produced no sentence boundaries at all (very
  // short reply with no terminal punctuation), synthesize the full text.
  if (ttsJobs.length === 0) {
    ttsJobs.push(synthesizeSpeech(assistantMessage.content));
  }

  const ttsResults = await Promise.all(ttsJobs);
  const combinedAudio = Buffer.concat(ttsResults.map((r) => r.audio));

  res.status(201).json(
    SendVoiceMessageResponse.parse({
      userMessage,
      assistantMessage,
      audioBase64: combinedAudio.toString("base64"),
      audioMimeType,
      speakerName,
      autoEnrolled,
    }),
  );
});

export default router;
