/**
 * Primary LLM chain for the companion's text replies. Gemini was removed
 * entirely as of 2026-07-21 -- its free-tier RPM/RPD cap was the direct
 * cause of repeated "rate limit" errors during voice chats. Every provider
 * below exposes an OpenAI-compatible /chat/completions endpoint, so one
 * shared implementation covers all of them (both non-streaming and
 * streaming variants).
 *
 * Priority order (fastest/most-generous free tiers first, paid last resort):
 *   1. Groq        - fast, generous per-model daily caps
 *   2. Cerebras    - equally fast, separate infra (no shared failure point with Groq)
 *   3. Mistral     - much larger raw token budget (~1B tokens/month), used after the two fastest
 *   4. Kilo Code   - separate free-tier account/quota, proxies the OpenRouter model catalog
 *   5. Qwen Cloud  - PAID pay-as-you-go (Alibaba Cloud Model Studio) -- only reached if every
 *                    free provider above is down/misconfigured
 */

type OAMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  supportsJsonMode: boolean;
};

const PROVIDERS: Provider[] = [
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    supportsJsonMode: true,
  },
  {
    name: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "llama3.1-8b",
    supportsJsonMode: false,
  },
  {
    name: "mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    apiKeyEnv: "MISTRAL_API_KEY",
    model: "mistral-small-latest",
    supportsJsonMode: true,
  },
  {
    // kilocode.ai migrated to kilo.ai -- old host 308-redirects and silently
    // eats POST bodies on most HTTP clients, so this MUST be kilo.ai directly.
    name: "kilocode",
    baseUrl: "https://kilo.ai/api/openrouter/v1/chat/completions",
    apiKeyEnv: "KILOCODE_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    supportsJsonMode: true,
  },
  {
    // Alibaba Cloud Model Studio, international endpoint (not the mainland
    // Bailian console -- separate account/URL). PAID pay-as-you-go, kept
    // last since every provider above it is free.
    name: "qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKeyEnv: "QWENCLOUD_API_KEY",
    model: "qwen3-coder-plus",
    supportsJsonMode: false,
  },
];

function availableProviders(): Provider[] {
  return PROVIDERS.filter((p) => !!process.env[p.apiKeyEnv]);
}

/**
 * Non-streaming fallback completion. Tries each configured provider in
 * priority order, returning the first successful response. Throws only if
 * every configured provider fails (or none are configured).
 */
export async function fallbackGenerateContent(params: {
  systemInstruction: string;
  messages: { role: "user" | "assistant"; content: string }[];
  jsonMode?: boolean;
  maxTokens?: number;
}): Promise<{ text: string; provider: string }> {
  const providers = availableProviders();
  if (providers.length === 0) {
    throw new Error("No LLM providers configured (GROQ_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY / KILOCODE_API_KEY / QWENCLOUD_API_KEY all missing)");
  }

  const oaMessages: OAMessage[] = [
    { role: "system", content: params.systemInstruction },
    ...params.messages,
  ];

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const body: Record<string, unknown> = {
        model: provider.model,
        messages: oaMessages,
        max_tokens: params.maxTokens ?? 2048,
      };
      if (params.jsonMode && provider.supportsJsonMode) {
        body.response_format = { type: "json_object" };
      }

      const res = await fetch(provider.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env[provider.apiKeyEnv]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${provider.name} HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = (await res.json()) as any;
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error(`${provider.name} returned no content`);
      return { text, provider: provider.name };
    } catch (err) {
      lastError = err;
      continue; // try next provider
    }
  }
  throw new Error(`All fallback providers failed. Last error: ${String(lastError)}`);
}

/**
 * Streaming fallback completion. Tries each configured provider in
 * priority order until one starts streaming successfully; calls
 * onSentence(text) as complete sentences accumulate, mirroring the Gemini
 * streaming behavior in index.ts.
 */
export async function fallbackGenerateContentStream(
  params: {
    systemInstruction: string;
    messages: { role: "user" | "assistant"; content: string }[];
    maxTokens?: number;
  },
  onSentence: (sentence: string) => void,
): Promise<{ text: string; provider: string }> {
  const providers = availableProviders();
  if (providers.length === 0) {
    throw new Error("No LLM providers configured (GROQ_API_KEY / CEREBRAS_API_KEY / MISTRAL_API_KEY / KILOCODE_API_KEY / QWENCLOUD_API_KEY all missing)");
  }

  const oaMessages: OAMessage[] = [
    { role: "system", content: params.systemInstruction },
    ...params.messages,
  ];

  let lastError: unknown;
  for (const provider of providers) {
    try {
      const res = await fetch(provider.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env[provider.apiKeyEnv]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          messages: oaMessages,
          max_tokens: params.maxTokens ?? 2048,
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${provider.name} HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let sentenceBuffer = "";
      let leftover = "";
      const sentenceRe = /[.!?]+[\s"')\]]*(?=\s|$)/g;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = leftover + decoder.decode(value, { stream: true });
        const lines = chunkText.split("\n");
        leftover = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content ?? "";
            if (!delta) continue;
            full += delta;
            sentenceBuffer += delta;
            let match: RegExpExecArray | null;
            let lastCut = 0;
            sentenceRe.lastIndex = 0;
            while ((match = sentenceRe.exec(sentenceBuffer)) !== null) {
              const cut = match.index + match[0].length;
              const sentence = sentenceBuffer.slice(lastCut, cut).trim();
              if (sentence.length > 0) onSentence(sentence);
              lastCut = cut;
            }
            sentenceBuffer = sentenceBuffer.slice(lastCut);
          } catch {
            // ignore malformed SSE fragment, keep going
          }
        }
      }
      if (sentenceBuffer.trim().length > 0) onSentence(sentenceBuffer.trim());
      if (!full.trim()) throw new Error(`${provider.name} streamed empty response`);
      return { text: full, provider: provider.name };
    } catch (err) {
      lastError = err;
      continue; // try next provider
    }
  }
  throw new Error(`All fallback streaming providers failed. Last error: ${String(lastError)}`);
}
