import { ai, GEMINI_MODEL } from "./client";
import { buildSystemInstruction, MEMORY_EXTRACTION_INSTRUCTION } from "./persona";
import { fallbackGenerateContent, fallbackGenerateContentStream } from "./fallback";

export { ai, GEMINI_MODEL };
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
 * Generates a non-streaming chat completion. Tries Gemini first; on any
 * Gemini failure (rate limit, quota, transient error) falls through to the
 * free-tier fallback chain (Groq -> Cerebras -> Mistral) so a single
 * provider outage never takes the whole companion down.
 */
async function generateContent(params: ChatParams): Promise<string> {
  const contents = params.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: params.systemInstruction,
        maxOutputTokens: params.maxTokens ?? 2048,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  } catch (geminiErr) {
    console.warn("[gemini] primary call failed, trying fallback chain:", String(geminiErr));
    try {
      const { text, provider } = await fallbackGenerateContent(params);
      console.warn(`[gemini] fallback succeeded via ${provider}`);
      return text;
    } catch (fallbackErr) {
      console.error("[gemini] all providers (Gemini + fallback chain) failed:", String(fallbackErr));
      throw geminiErr; // surface the original Gemini error, it's the primary path
    }
  }
}

/**
 * Splits accumulated streamed text into complete sentences plus a trailing
 * remainder that isn't terminated yet. Used to fire off TTS per-sentence
 * while the LLM is still generating the rest of the reply.
 */
function extractCompleteSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let lastCut = 0;
  const re = /[.!?]+[\s"')\]]*(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(buffer)) !== null) {
    const cut = match.index + match[0].length;
    const sentence = buffer.slice(lastCut, cut).trim();
    if (sentence.length > 0) sentences.push(sentence);
    lastCut = cut;
  }
  return { sentences, remainder: buffer.slice(lastCut) };
}

/**
 * Streams a chat completion using Gemini, calling onSentence(text) as soon as
 * each complete sentence appears in the stream — well before the full reply
 * finishes generating. Returns the full accumulated text at the end.
 * Falls through to the streaming fallback chain if Gemini fails before
 * producing any output.
 */
async function generateContentStream(
  params: ChatParams,
  onSentence: (sentence: string) => void,
): Promise<string> {
  const contents = [
    ...params.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  ];

  try {
    const response = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: params.systemInstruction,
        maxOutputTokens: params.maxTokens ?? 2048,
      },
    });

    let full = "";
    let sentenceBuffer = "";

    for await (const chunk of response) {
      const delta = chunk.text ?? "";
      if (!delta) continue;
      full += delta;
      sentenceBuffer += delta;
      const { sentences, remainder } = extractCompleteSentences(sentenceBuffer);
      sentenceBuffer = remainder;
      for (const sentence of sentences) onSentence(sentence);
    }

    if (sentenceBuffer.trim().length > 0) onSentence(sentenceBuffer.trim());
    if (!full.trim()) throw new Error("Streamed response was empty");
    return full;
  } catch (geminiErr) {
    console.warn("[gemini] primary stream failed, trying fallback chain:", String(geminiErr));
    try {
      const { text, provider } = await fallbackGenerateContentStream(params, onSentence);
      console.warn(`[gemini] fallback stream succeeded via ${provider}`);
      return text;
    } catch (fallbackErr) {
      console.error("[gemini] all streaming providers (Gemini + fallback chain) failed:", String(fallbackErr));
      throw geminiErr;
    }
  }
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
