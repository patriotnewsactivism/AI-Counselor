import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, voiceAuthTemplatesTable, voiceAuthAttemptsTable } from "@workspace/db";
import { transcribeAudio } from "@workspace/deepgram";
import {
  GetVoiceAuthStatusResponse,
  CreateVoiceAuthChallengeResponse,
  EnrollVoiceAuthBody,
  EnrollVoiceAuthResponse,
  VerifyVoiceAuthBody,
  VerifyVoiceAuthResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { parseWav } from "../lib/wav";
import { extractMfccStatVector, averageVectors, cosineSimilarity } from "../lib/mfcc";
import { encryptVector, decryptVector } from "../lib/voiceAuthCrypto";
import { createChallenge, consumeChallenge, transcriptMatchesDigits } from "../lib/voiceAuthChallenge";
import { createHistoryToken } from "../lib/historyAccess";
import { createLockoutTracker } from "../lib/pinCrypto";

/**
 * Voice ID -- an MFCC-based voice-biometric alternative to the History PIN
 * (see routes/history.ts). It is NOT available on phone calls: the
 * phone-hosted xAI Voice Agent only ever gets text back from tool calls, no
 * raw audio, so there is nothing here for it to analyze. This is web-app
 * only, gating the same "unlock history" flow a PIN gates, and issuing the
 * exact same HistoryTokenResponse on success so the frontend can treat a
 * voice match and a correct PIN as equivalent unlocks.
 *
 * Honest tier disclosure: this is classical MFCC statistics-pooling, not a
 * deep neural speaker embedding (ECAPA-TDNN/x-vector/etc.) -- weaker
 * separation between similar-sounding speakers than a production ASV
 * system would give you. The real defense against replay/spoofing here is
 * the spoken challenge phrase (a fresh random 4-digit sequence, checked via
 * Deepgram ASR) combined with the MFCC voice match, not the MFCC match by
 * itself. Treat this as a second factor layered on top of the Clerk
 * session, same trust tier as the History PIN it replaces -- not a
 * cryptographic-grade biometric system.
 */

const router: IRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const verifyLockout = createLockoutTracker(MAX_FAILED_ATTEMPTS, LOCKOUT_MS);

// Cosine similarity threshold for the statistics-pooled MFCC vector. This is
// a conservative starting point for a classical (non-neural) feature space --
// tune against real enrollment/verification data once a few accounts have
// used this for a while (see notes to Don in the PR description).
const SIMILARITY_THRESHOLD = 0.9;

async function logAttempt(userId: string, success: boolean, score: number | null, reason: string): Promise<void> {
  await db.insert(voiceAuthAttemptsTable).values({ userId, success, score: score ?? undefined, reason });
}

router.get("/voice-auth/status", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const [template] = await db
    .select()
    .from(voiceAuthTemplatesTable)
    .where(eq(voiceAuthTemplatesTable.userId, userId));

  res.json(
    GetVoiceAuthStatusResponse.parse({
      enrolled: Boolean(template),
      enrolledAt: template?.enrolledAt ?? null,
      modelVersion: template?.modelVersion ?? null,
    }),
  );
});

router.post("/voice-auth/challenge", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const challenge = createChallenge(userId);
  res.json(CreateVoiceAuthChallengeResponse.parse(challenge));
});

router.post("/voice-auth/enroll", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  const parsed = EnrollVoiceAuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const vectors: number[][] = [];

  for (const sample of parsed.data.samples) {
    const challenge = consumeChallenge(sample.challengeId, userId);
    if (!challenge) {
      res.status(400).json({ error: "Challenge expired or invalid -- request a new one and try again" });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(sample.audioBase64, "base64");
    } catch {
      res.status(400).json({ error: "audioBase64 is not valid base64" });
      return;
    }

    let transcript: string;
    try {
      transcript = await transcribeAudio(buffer, sample.mimeType);
    } catch (err) {
      res.status(400).json({ error: `Could not transcribe recording: ${(err as Error).message}` });
      return;
    }

    if (!transcriptMatchesDigits(transcript, challenge.digits)) {
      res.status(400).json({ error: "The spoken phrase didn't match the challenge -- please try again" });
      return;
    }

    try {
      const wav = parseWav(buffer);
      vectors.push(extractMfccStatVector(wav.samples, wav.sampleRate));
    } catch (err) {
      res.status(400).json({ error: `Could not analyze recording: ${(err as Error).message}` });
      return;
    }
  }

  const templateVector = averageVectors(vectors);
  const encrypted = encryptVector(templateVector);

  await db
    .insert(voiceAuthTemplatesTable)
    .values({ userId, templateEncrypted: encrypted, sampleCount: vectors.length })
    .onConflictDoUpdate({
      target: voiceAuthTemplatesTable.userId,
      set: { templateEncrypted: encrypted, sampleCount: vectors.length },
    });

  res.json(EnrollVoiceAuthResponse.parse({ enrolled: true, sampleCount: vectors.length }));
});

router.post("/voice-auth/verify", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;

  if (verifyLockout.isLockedOut(userId)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const parsed = VerifyVoiceAuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .select()
    .from(voiceAuthTemplatesTable)
    .where(eq(voiceAuthTemplatesTable.userId, userId));

  if (!template) {
    res.status(400).json({ error: "Voice ID is not enrolled for this account" });
    return;
  }

  const challenge = consumeChallenge(parsed.data.challengeId, userId);
  if (!challenge) {
    res.status(400).json({ error: "Challenge expired or invalid -- request a new one and try again" });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(parsed.data.audioBase64, "base64");
  } catch {
    res.status(400).json({ error: "audioBase64 is not valid base64" });
    return;
  }

  let transcript: string;
  try {
    transcript = await transcribeAudio(buffer, parsed.data.mimeType);
  } catch (err) {
    await logAttempt(userId, false, null, "transcription_failed");
    verifyLockout.recordFailedAttempt(userId);
    res.status(401).json({ error: `Could not understand the recording: ${(err as Error).message}` });
    return;
  }

  if (!transcriptMatchesDigits(transcript, challenge.digits)) {
    await logAttempt(userId, false, null, "phrase_mismatch");
    verifyLockout.recordFailedAttempt(userId);
    res.status(401).json({ error: "Spoken phrase didn't match" });
    return;
  }

  let candidateVector: number[];
  try {
    const wav = parseWav(buffer);
    candidateVector = extractMfccStatVector(wav.samples, wav.sampleRate);
  } catch (err) {
    await logAttempt(userId, false, null, "feature_extraction_failed");
    verifyLockout.recordFailedAttempt(userId);
    res.status(401).json({ error: `Could not analyze recording: ${(err as Error).message}` });
    return;
  }

  const storedVector = decryptVector(template.templateEncrypted);
  const score = cosineSimilarity(storedVector, candidateVector);

  if (score < SIMILARITY_THRESHOLD) {
    await logAttempt(userId, false, score, "low_similarity");
    verifyLockout.recordFailedAttempt(userId);
    res.status(401).json({ error: "Voice didn't match closely enough" });
    return;
  }

  await logAttempt(userId, true, score, "accept");
  verifyLockout.clearFailedAttempts(userId);
  res.json(VerifyVoiceAuthResponse.parse(createHistoryToken(userId)));
});

router.delete("/voice-auth", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthedRequest).userId;
  await db.delete(voiceAuthTemplatesTable).where(eq(voiceAuthTemplatesTable.userId, userId));
  res.sendStatus(204);
});

export default router;
