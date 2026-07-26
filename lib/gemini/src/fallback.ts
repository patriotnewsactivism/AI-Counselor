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

/** Per-provider request cap. The chain is sequential, so this bounds how
 * long a user waits before the next provider is tried. It was 20s, which
 * meant a fully-down chain could hang a voice turn for ~100s before
 * surfacing an error. */
const REQUEST_TIMEOUT_MS = 8000;
const STREAM_TIMEOUT_MS = 10000;

/** Ceiling on the whole sequential walk. Without this, the per-provider cap
 * multiplies by the provider count — 11 entries would let a fully-dead chain
 * hang a voice turn for ~88s. Better to surface a failure the caller can
 * speak aloud than to leave someone waiting in silence. */
const CHAIN_BUDGET_MS = 25000;

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Ordered smartest -> weakest across the free providers we hold keys for,
 * with the one paid provider pinned last. Parameter counts are the ranking
 * signal; both hosts are fast enough that the biggest model is still well
 * inside voice-latency budget (Cerebras serves GLM 4.7 at ~1000 tok/s and
 * gpt-oss-120b at ~3000 tok/s).
 *
 * Several IDs here are on announced shutdown schedules (Groq retires
 * llama-3.3-70b-versatile on 2026-08-16; Cerebras retires zai-glm-4.7 on
 * 2026-08-17 and recommends moving off llama3.1-8b). Rather than swap them
 * blind, each successor is listed AHEAD of the model it replaces — if the
 * newer ID is good we use it, and if it isn't we fall through to the old one
 * until its shutdown date. The cutovers then need no code change.
 */
const PROVIDERS: Provider[] = [
  // 355B — largest model available on any of these free tiers.
  {
    name: "cerebras-glm-4.7",
    baseUrl: CEREBRAS_URL,
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "zai-glm-4.7",
    supportsJsonMode: false,
  },
  // 120B, ~3000 tok/s, and Cerebras's only *production* (non-preview) tier —
  // the steadiest of the large options, so it backs the 355B preview model.
  {
    name: "cerebras-gpt-oss-120b",
    baseUrl: CEREBRAS_URL,
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "gpt-oss-120b",
    supportsJsonMode: false,
  },
  // Same 120B weights on separate infrastructure and a separate quota, so a
  // Cerebras outage or daily-cap exhaustion doesn't take this tier with it.
  {
    name: "groq-gpt-oss-120b",
    baseUrl: GROQ_URL,
    apiKeyEnv: "GROQ_API_KEY",
    model: "openai/gpt-oss-120b",
    supportsJsonMode: true,
  },
  // 70B, but an OpenRouter ":free" pool — capable yet aggressively throttled,
  // so it sits below the dedicated 120B tiers.
  {
    // kilocode.ai migrated to kilo.ai -- old host 308-redirects and silently
    // eats POST bodies on most HTTP clients, so this MUST be kilo.ai directly.
    name: "kilocode",
    baseUrl: "https://kilo.ai/api/openrouter/v1/chat/completions",
    apiKeyEnv: "KILOCODE_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    supportsJsonMode: true,
  },
  // 70B — Groq's outgoing flagship, still serving until 2026-08-16.
  {
    name: "groq-llama-3.3-70b",
    baseUrl: GROQ_URL,
    apiKeyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    supportsJsonMode: true,
  },
  // 31B
  {
    name: "cerebras-gemma-4-31b",
    baseUrl: CEREBRAS_URL,
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "gemma-4-31b",
    supportsJsonMode: false,
  },
  // ~27B
  {
    name: "groq-qwen3.6-27b",
    baseUrl: GROQ_URL,
    apiKeyEnv: "GROQ_API_KEY",
    model: "qwen/qwen3.6-27b",
    supportsJsonMode: true,
  },
  // ~24B
  {
    name: "mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    apiKeyEnv: "MISTRAL_API_KEY",
    model: "mistral-small-latest",
    supportsJsonMode: true,
  },
  // 8B — weakest, and deprecated. Last free rung before we start paying.
  {
    name: "cerebras-llama3.1-8b",
    baseUrl: CEREBRAS_URL,
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "llama3.1-8b",
    supportsJsonMode: false,
  },
  // Alibaba Cloud Model Studio, international endpoint (not the mainland
  // Bailian console -- separate account/URL). PAID pay-as-you-go, kept last
  // since every provider above it is free. qwen3-coder-plus is a
  // code-specialised model and a poor fit for an empathetic companion, so a
  // general chat model leads and the coder model stays only as a backstop.
  {
    name: "qwen-plus",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKeyEnv: "QWENCLOUD_API_KEY",
    model: "qwen-plus",
    supportsJsonMode: false,
  },
  {
    name: "qwen-coder",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKeyEnv: "QWENCLOUD_API_KEY",
    model: "qwen3-coder-plus",
    supportsJsonMode: false,
  },
];

function availableProviders(): Provider[] {
  return PROVIDERS.filter((p) => !!process.env[p.apiKeyEnv]);
}

export interface ProviderProbe {
  name: string;
  model: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

/**
 * Pings every provider with a throwaway 1-token completion and reports which
 * ones actually answer. Exists because a failing chain is otherwise invisible
 * from outside the server: the UI collapses every cause into one generic
 * message, so "wrong key" and "model decommissioned" and "daily cap hit" all
 * look identical. Probes run concurrently — this is a diagnostic, not the
 * request path, so there's no reason to walk it in priority order.
 *
 * Never returns key material: only the provider name, model ID, HTTP status,
 * and a truncated response body.
 */
export async function probeProviders(): Promise<ProviderProbe[]> {
  return Promise.all(
    PROVIDERS.map(async (provider): Promise<ProviderProbe> => {
      const key = process.env[provider.apiKeyEnv];
      if (!key) {
        return {
          name: provider.name,
          model: provider.model,
          configured: false,
          ok: false,
          status: null,
          latencyMs: null,
          error: `${provider.apiKeyEnv} not set`,
        };
      }

      const startedAt = Date.now();
      try {
        const res = await fetch(provider.baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(6000),
        });
        const latencyMs = Date.now() - startedAt;
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return {
            name: provider.name,
            model: provider.model,
            configured: true,
            ok: false,
            status: res.status,
            latencyMs,
            error: body.slice(0, 200) || res.statusText,
          };
        }
        return {
          name: provider.name,
          model: provider.model,
          configured: true,
          ok: true,
          status: res.status,
          latencyMs,
          error: null,
        };
      } catch (err) {
        return {
          name: provider.name,
          model: provider.model,
          configured: true,
          ok: false,
          status: null,
          latencyMs: Date.now() - startedAt,
          error: String(err).slice(0, 200),
        };
      }
    }),
  );
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
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  for (const provider of providers) {
    if (Date.now() > deadline) {
      console.warn(`[companion-llm] chain budget exhausted before trying ${provider.name}`);
      break;
    }
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      // Previously swallowed silently, which is why a fully-dead chain looked
      // like an unexplained generic error with nothing in the logs.
      console.warn(`[companion-llm] ${provider.name} (${provider.model}) failed: ${String(err)}`);
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
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  for (const provider of providers) {
    if (Date.now() > deadline) {
      console.warn(`[companion-llm] chain budget exhausted before trying ${provider.name}`);
      break;
    }
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
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
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
      console.warn(`[companion-llm] ${provider.name} (${provider.model}) stream failed: ${String(err)}`);
      continue; // try next provider
    }
  }
  throw new Error(`All fallback streaming providers failed. Last error: ${String(lastError)}`);
}
