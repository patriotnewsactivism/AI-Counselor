import { ai, GEMINI_MODEL } from "./client";
import { buildSystemInstruction, MEMORY_EXTRACTION_INSTRUCTION } from "./persona";

export { ai, GEMINI_MODEL };
export { identifyOrEnrollSpeaker, type EnrolledProfile, type SpeakerResult } from "./speaker";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const MISTRAL_MODEL = "mistral-small-2506";
const GROQ_MODEL = "llama-3.3-70b-versatile";

type ChatParams = {
  systemInstruction: string;
  messages: { role: "user" | "assistant"; content: string }[];
  jsonMode?: boolean;
  maxTokens?: number;
};

async function mistralChat(params: ChatParams): Promise<string> {
  if (!process.env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY not set");
  }

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: params.systemInstruction },
        ...params.messages,
      ],
      max_tokens: params.maxTokens ?? 2048,
      ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Mistral API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Mistral returned an empty response");
  }
  return text;
}

async function groqChat(params: ChatParams): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY must be set to generate companion replies.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: params.systemInstruction },
        ...params.messages,
      ],
      max_tokens: params.maxTokens ?? 2048,
      ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Groq returned an empty response");
  }
  return text;
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
 * Streams a chat completion from an OpenAI-compatible SSE endpoint
 * (Mistral / Groq both implement this), calling onSentence(text) as soon as
 * each complete sentence appears in the stream — well before the full reply
 * finishes generating. Returns the full accumulated text at the end.
 */
async function streamChatCompletion(
  url: string,
  apiKey: string,
  model: string,
  params: ChatParams,
  onSentence: (sentence: string) => void,
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: params.systemInstruction },
        ...params.messages,
      ],
      max_tokens: params.maxTokens ?? 2048,
      stream: true,
      ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(`Streaming API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let sentenceBuffer = "";
  let sseLineBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseLineBuffer += decoder.decode(value, { stream: true });
    const lines = sseLineBuffer.split("\n");
    sseLineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (!delta) continue;
        full += delta;
        sentenceBuffer += delta;
        const { sentences, remainder } = extractCompleteSentences(sentenceBuffer);
        sentenceBuffer = remainder;
        for (const sentence of sentences) onSentence(sentence);
      } catch {
        // Ignore malformed/partial SSE chunks — next chunk will complete it
      }
    }
  }

  if (sentenceBuffer.trim().length > 0) onSentence(sentenceBuffer.trim());
  if (!full.trim()) throw new Error("Streamed response was empty");
  return full;
}

/**
 * Streaming variant of chatWithFallback: same Mistral-primary/Groq-fallback
 * behavior, but calls onSentence(text) progressively so callers can start
 * TTS synthesis on early sentences while later ones are still generating.
 */
async function chatWithFallbackStream(
  params: ChatParams,
  onSentence: (sentence: string) => void,
): Promise<string> {
  if (process.env.MISTRAL_API_KEY) {
    try {
      return await streamChatCompletion(
        "https://api.mistral.ai/v1/chat/completions",
        process.env.MISTRAL_API_KEY,
        MISTRAL_MODEL,
        params,
        onSentence,
      );
    } catch (mistralErr) {
      if (!process.env.GROQ_API_KEY) throw mistralErr;
      return streamChatCompletion(
        "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY,
        GROQ_MODEL,
        params,
        onSentence,
      );
    }
  }
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Neither MISTRAL_API_KEY nor GROQ_API_KEY is set");
  }
  return streamChatCompletion(
    "https://api.groq.com/openai/v1/chat/completions",
    process.env.GROQ_API_KEY,
    GROQ_MODEL,
    params,
    onSentence,
  );
}

/**
 * Mistral (1B tokens/month free tier) is primary; Groq is the fallback if
 * Mistral errors or is rate-limited. Keeps the companion up even if either
 * single provider's free-tier cap gets hit.
 */
async function chatWithFallback(params: ChatParams): Promise<string> {
  try {
    return await mistralChat(params);
  } catch (mistralErr) {
    try {
      return await groqChat(params);
    } catch (groqErr) {
      throw new Error(
        `All LLM providers failed. Mistral: ${
          mistralErr instanceof Error ? mistralErr.message : String(mistralErr)
        } | Groq: ${groqErr instanceof Error ? groqErr.message : String(groqErr)}`,
      );
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

  return chatWithFallback({ systemInstruction, messages, maxTokens: 8192 });
}

/**
 * Streaming/pipelined variant of generateCompanionReply: calls
 * onSentence(text) as each sentence of the reply is generated, so the
 * caller can kick off TTS synthesis per-sentence in parallel with ongoing
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

  return chatWithFallbackStream({ systemInstruction, messages, maxTokens: 8192 }, onSentence);
}

export async function extractMemories(params: {
  userMessage: string;
  assistantReply: string;
  existingMemories: string[];
}): Promise<string[]> {
  const prompt = `Existing remembered facts:\n${params.existingMemories.map((m) => `- ${m}`).join("\n") || "(none yet)"}\n\nNew exchange:\nPerson: ${params.userMessage}\nCompanion: ${params.assistantReply}\n\nReturn only NEW facts not already covered above.`;

  try {
    const text = await chatWithFallback({
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
