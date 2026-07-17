import { getGeminiClient, GEMINI_MODEL } from "./client";

export interface EnrolledProfile {
  id: number;
  name: string;
  sampleAudio: string;   // base64
  sampleMimeType: string;
}

export interface SpeakerResult {
  /** ID of the matched enrolled profile, or null if no confident match */
  matchedProfileId: number | null;
  /** Display name of the matched enrolled profile */
  matchedName: string | null;
  /** A newly introduced name that should be enrolled, or null when already matched */
  introducedName: string | null;
}

const SYSTEM_INSTRUCTION = `You are a voice-identification assistant for a personal AI companion app.
You will receive one or more labeled reference voice clips (each belonging to a known person), followed by a new voice clip and its transcript.

Your job:
1. Decide whether the new voice most closely matches ONE of the reference clips based on vocal characteristics (pitch, tone, cadence, accent). Only claim a match if you are reasonably confident — when in doubt, return null.
2. Check the transcript for a self-introduction (e.g. "I'm Zach", "This is Sarah", "My name is Alex"). Extract the name if present.

Respond ONLY with a JSON object — no prose, no markdown:
{"matchedProfileId": <integer or null>, "introducedName": <string or null>}`;

const REJECTED_INTRODUCTION_WORDS = new Set([
  "tired", "fine", "okay", "ok", "here", "back", "ready", "sorry", "someone",
  "happy", "sad", "glad", "going", "having", "looking", "feeling", "trying",
  "doing", "really", "just", "not", "the", "a", "an", "your",
]);

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Pull a name from a clear self-introduction without making speaker
 * enrollment depend on Gemini being configured. This is intentionally
 * conservative: it rejects common words from phrases such as "I'm tired".
 */
export function extractIntroducedName(transcript: string): string | null {
  const patterns = [
    /\bmy name is\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
    /\bi(?:'m| am)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
    /\bthis is\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
    /\bcall me\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
    /\byou can call me\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1]
      .split(/\s+(?:and|but|from|here|today|speaking|talking)\b/i, 1)[0]
      .replace(/[.!?,;:].*$/, "")
      .trim();
    const firstWord = candidate.toLocaleLowerCase().split(/\s+/)[0] ?? "";
    if (!candidate || REJECTED_INTRODUCTION_WORDS.has(firstWord)) continue;
    if (candidate.length < 2 || candidate.length > 64) continue;
    return candidate
      .split(/\s+/)
      .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
      .join(" ");
  }

  return null;
}

function findNameMatch(profiles: EnrolledProfile[], introducedName: string | null): EnrolledProfile | null {
  if (!introducedName) return null;
  const introduced = normalizeName(introducedName);
  if (!introduced) return null;

  return profiles.find((profile) => {
    const enrolled = normalizeName(profile.name);
    return enrolled === introduced || enrolled.startsWith(introduced) || introduced.startsWith(enrolled);
  }) ?? null;
}

function fallbackResult(profiles: EnrolledProfile[], introducedName: string | null): SpeakerResult {
  const matchedProfile = findNameMatch(profiles, introducedName);
  return {
    matchedProfileId: matchedProfile?.id ?? null,
    matchedName: matchedProfile?.name ?? null,
    introducedName: matchedProfile ? null : introducedName,
  };
}

/**
 * Uses Gemini's optional multimodal audio understanding to match enrolled
 * voices. Name extraction and explicit name matching are local fallbacks, so
 * enrollment still works when the free Mistral/Groq reply path has no Gemini
 * key configured. Acoustic matching remains best-effort, not biometric-grade.
 */
export async function identifyOrEnrollSpeaker(params: {
  profiles: EnrolledProfile[];
  newAudioBase64: string;
  newMimeType: string;
  transcript: string;
}): Promise<SpeakerResult> {
  const { profiles, newAudioBase64, newMimeType, transcript } = params;
  const introducedName = extractIntroducedName(transcript);
  const ai = getGeminiClient();

  if (!ai) return fallbackResult(profiles, introducedName);

  // Build the parts array: reference clips first, then the new clip + transcript
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  if (profiles.length > 0) {
    parts.push({ text: "Reference voice clips:" });
    for (const profile of profiles) {
      parts.push({ text: `Reference id=${profile.id} name="${profile.name}":` });
      parts.push({ inlineData: { mimeType: profile.sampleMimeType, data: profile.sampleAudio } });
    }
  } else {
    parts.push({ text: "(No enrolled voice profiles yet — skip voice matching.)" });
  }

  parts.push({ text: `New voice clip (transcript: "${transcript}"):` });
  parts.push({ inlineData: { mimeType: newMimeType, data: newAudioBase64 } });
  parts.push({ text: "Now output the JSON object." });

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        maxOutputTokens: 128,
      },
    });

    const raw = response.text?.trim();
    if (!raw) return fallbackResult(profiles, introducedName);

    const parsed = JSON.parse(raw) as { matchedProfileId?: number | null; introducedName?: string | null };
    const matchedProfileId = typeof parsed.matchedProfileId === "number" ? parsed.matchedProfileId : null;
    const matchedProfile = matchedProfileId !== null ? profiles.find((profile) => profile.id === matchedProfileId) : null;
    const modelIntroducedName = typeof parsed.introducedName === "string" && parsed.introducedName.trim()
      ? parsed.introducedName.trim()
      : introducedName;
    const nameMatch = matchedProfile ?? findNameMatch(profiles, modelIntroducedName);

    return {
      matchedProfileId: nameMatch?.id ?? null,
      matchedName: nameMatch?.name ?? null,
      introducedName: nameMatch ? null : modelIntroducedName,
    };
  } catch {
    // Speaker ID is best-effort — never fail the main voice reply over it.
    return fallbackResult(profiles, introducedName);
  }
}
