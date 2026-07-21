import { ai, GEMINI_MODEL } from "./client";

export interface EnrolledProfile {
  id: number;
  name: string;
  sampleAudio: string;   // base64
  sampleMimeType: string;
}

export interface SpeakerResult {
  /** ID of the matched enrolled profile, or null if no confident match */
  matchedProfileId: number | null;
  /** Display name of the matched profile */
  matchedName: string | null;
  /**
   * If the speaker introduced their own name in the transcript
   * (e.g. "Hi, I'm Zach") and no profile matched, this is that name
   * — use it to auto-enroll a new profile.
   */
  introducedName: string | null;
}

const SYSTEM_INSTRUCTION = `You are a voice-identification assistant for a personal AI companion app.
You will receive one or more labeled reference voice clips (each belonging to a known person), followed by a new voice clip and its transcript.

Your job:
1. Decide whether the new voice most closely matches ONE of the reference clips based on vocal characteristics (pitch, tone, cadence, accent). Only claim a match if you are reasonably confident — when in doubt, return null.
2. Check the transcript for a self-introduction (e.g. "I'm Zach", "This is Sarah", "My name is Alex"). Extract the name if present.

Respond ONLY with a JSON object — no prose, no markdown:
{"matchedProfileId": <integer or null>, "introducedName": <string or null>}`;

/**
 * Uses Gemini's multimodal audio understanding to:
 * - Match the new audio clip against enrolled voice profiles (best-effort heuristic, not biometric-grade)
 * - Detect if the speaker introduced their own name in the transcript
 */
export async function identifyOrEnrollSpeaker(params: {
  profiles: EnrolledProfile[];
  newAudioBase64: string;
  newMimeType: string;
  transcript: string;
}): Promise<SpeakerResult> {
  const { profiles, newAudioBase64, newMimeType, transcript } = params;

  // Build the parts array: reference clips first, then the new clip + transcript
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  if (profiles.length > 0) {
    parts.push({ text: "Reference voice clips:" });
    for (const p of profiles) {
      parts.push({ text: `Reference id=${p.id} name="${p.name}":` });
      parts.push({ inlineData: { mimeType: p.sampleMimeType, data: p.sampleAudio } });
    }
  } else {
    parts.push({ text: "(No enrolled voice profiles yet — skip voice matching.)" });
  }

  parts.push({ text: `New voice clip (transcript: "${transcript}"):` });
  parts.push({ inlineData: { mimeType: newMimeType, data: newAudioBase64 } });
  parts.push({ text: 'Now output the JSON object.' });

  if (!ai) {
    // No GEMINI_API_KEY configured -- voice speaker-ID is a best-effort
    // enhancement layered on top of the main text chat, which no longer
    // depends on Gemini at all. Skip cleanly rather than erroring.
    return { matchedProfileId: null, matchedName: null, introducedName: null };
  }

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
    if (!raw) return { matchedProfileId: null, matchedName: null, introducedName: null };

    const parsed = JSON.parse(raw) as { matchedProfileId?: number | null; introducedName?: string | null };
    const matchedProfileId = typeof parsed.matchedProfileId === "number" ? parsed.matchedProfileId : null;
    const matchedProfile = matchedProfileId !== null ? profiles.find((p) => p.id === matchedProfileId) : null;

    return {
      matchedProfileId: matchedProfile ? matchedProfileId : null,
      matchedName: matchedProfile ? matchedProfile.name : null,
      introducedName: typeof parsed.introducedName === "string" && parsed.introducedName.trim()
        ? parsed.introducedName.trim()
        : null,
    };
  } catch {
    // Speaker ID is best-effort — never fail the main voice reply over it
    return { matchedProfileId: null, matchedName: null, introducedName: null };
  }
}
