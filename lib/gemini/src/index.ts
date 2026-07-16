import { ai, GEMINI_MODEL } from "./client";
import { buildSystemInstruction, MEMORY_EXTRACTION_INSTRUCTION } from "./persona";

export { ai, GEMINI_MODEL };
export { identifyOrEnrollSpeaker, type EnrolledProfile, type SpeakerResult } from "./speaker";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const GROQ_MODEL = "llama-3.3-70b-versatile";

async function groqChat(params: {
  systemInstruction: string;
  messages: { role: "user" | "assistant"; content: string }[];
  jsonMode?: boolean;
  maxTokens?: number;
}): Promise<string> {
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

  return groqChat({ systemInstruction, messages, maxTokens: 8192 });
}

export async function extractMemories(params: {
  userMessage: string;
  assistantReply: string;
  existingMemories: string[];
}): Promise<string[]> {
  const prompt = `Existing remembered facts:\n${params.existingMemories.map((m) => `- ${m}`).join("\n") || "(none yet)"}\n\nNew exchange:\nPerson: ${params.userMessage}\nCompanion: ${params.assistantReply}\n\nReturn only NEW facts not already covered above.`;

  try {
    const text = await groqChat({
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
