import { ai, GEMINI_MODEL } from "./client";
import { buildSystemInstruction, MEMORY_EXTRACTION_INSTRUCTION } from "./persona";

export { ai, GEMINI_MODEL };
export { identifyOrEnrollSpeaker, type EnrolledProfile, type SpeakerResult } from "./speaker";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function generateCompanionReply(params: {
  companionName: string;
  preferredName: string | null;
  memories: string[];
  history: ChatTurn[];
  userMessage: string;
  speakerName?: string | null;
}): Promise<string> {
  const systemInstruction = buildSystemInstruction(params);

  const contents = [
    ...params.history.map((turn) => ({
      role: turn.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: turn.content }],
    })),
    { role: "user" as const, parts: [{ text: params.userMessage }] },
  ];

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
      maxOutputTokens: 8192,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return text;
}

export async function extractMemories(params: {
  userMessage: string;
  assistantReply: string;
  existingMemories: string[];
}): Promise<string[]> {
  const prompt = `Existing remembered facts:\n${params.existingMemories.map((m) => `- ${m}`).join("\n") || "(none yet)"}\n\nNew exchange:\nPerson: ${params.userMessage}\nCompanion: ${params.assistantReply}\n\nReturn only NEW facts not already covered above.`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: MEMORY_EXTRACTION_INSTRUCTION,
        responseMimeType: "application/json",
        maxOutputTokens: 1024,
      },
    });

    const text = response.text?.trim();
    if (!text) return [];

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 5);
  } catch {
    // Memory extraction is a best-effort enhancement -- never fail the main reply over it.
    return [];
  }
}
