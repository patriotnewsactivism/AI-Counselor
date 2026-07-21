import { buildSystemInstruction, MEMORY_EXTRACTION_INSTRUCTION } from "./persona";
import { fallbackGenerateContent, fallbackGenerateContentStream } from "./fallback";

// Gemini client re-exported ONLY because speaker.ts (multimodal audio
// speaker-ID) still optionally uses it -- the main companion chat/reply
// path below no longer touches Gemini at all as of 2026-07-21.
export { ai, GEMINI_MODEL } from "./client";
export { identifyOrEnrollSpeaker, type EnrolledProfile, type SpeakerResult } from "./speaker";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type ChatParams = {
  systemInstruction: string;
  messages: { role: "user" | "assistant"; content: string }[];
  jsonMode?: boolean;
  maxTokens?: number;
};

/**
 * Generates a non-streaming chat completion via the free/cheap provider
 * chain (Groq -> Cerebras -> Mistral -> Kilo Code -> Qwen Cloud). Gemini is
 * no longer used here at all as of 2026-07-21.
 */
async function generateContent(params: ChatParams): Promise<string> {
  const { text, provider } = await fallbackGenerateContent(params);
  console.log(`[companion-llm] reply generated via ${provider}`);
  return text;
}

/**
 * Streams a chat completion via the free/cheap provider chain, calling
 * onSentence(text) as soon as each complete sentence appears -- well before
 * the full reply finishes generating. Returns the full accumulated text at
 * the end. Gemini is no longer used here at all as of 2026-07-21.
 */
async function generateContentStream(
  params: ChatParams,
  onSentence: (sentence: string) => void,
): Promise<string> {
  const { text, provider } = await fallbackGenerateContentStream(params, onSentence);
  console.log(`[companion-llm] streamed reply generated via ${provider}`);
  return text;
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

  const messages = [
    ...params.history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user" as const, content: params.userMessage },
  ];

  return generateContent({ systemInstruction, messages, maxTokens: 8192 });
}

/**
 * Streaming/pipelined variant of generateCompanionReply: streams the LLM reply and
 * calls onSentence(text) as each sentence is generated, so the caller (the
 * voice-messages route) can kick off TTS synthesis per-sentence in parallel with ongoing
 * generation instead of waiting for the full reply before synthesizing
 * anything. Returns the full reply text once generation completes.
 */
export async function generateCompanionReplyPipelined(
  params: {
    companionName: string;
    preferredName: string | null;
    memories: string[];
    history: ChatTurn[];
    userMessage: string;
    speakerName?: string | null;
  },
  onSentence: (sentence: string) => void,
): Promise<string> {
  const systemInstruction = buildSystemInstruction(params);

  const messages = [
    ...params.history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user" as const, content: params.userMessage },
  ];

  return generateContentStream({ systemInstruction, messages, maxTokens: 8192 }, onSentence);
}

export async function extractMemories(params: {
  userMessage: string;
  assistantReply: string;
  existingMemories: string[];
}): Promise<string[]> {
  const prompt = `Existing remembered facts:\n${params.existingMemories.map((m) => `- ${m}`).join("\n") || "(none yet)"}\n\nNew exchange:\nPerson: ${params.userMessage}\nCompanion: ${params.assistantReply}\n\nReturn only NEW facts not already covered above.`;

  try {
    const text = await generateContent({
      systemInstruction: MEMORY_EXTRACTION_INSTRUCTION,
      messages: [{ role: "user", content: prompt }],
      jsonMode: true,
      maxTokens: 1024,
    });

    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 5);
  } catch {
    // Memory extraction is a best-effort enhancement -- never fail the main reply over it.
    return [];
  }
}
