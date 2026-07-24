import { GoogleGenAI } from "@google/genai";

// Gemini is now OPTIONAL. The main companion-reply path no longer uses it at
// all (see fallback.ts / index.ts) -- it was removed as the primary provider
// because its free-tier RPM/RPD cap was the direct cause of repeated
// "rate limit" errors during voice chats. It remains available, best-effort,
// ONLY for the multimodal audio speaker-identification feature in speaker.ts,
// since none of the free/cheap text-only chat providers (Mistral, Kilo Code,
// Groq, Cerebras, Qwen Cloud) can do raw audio understanding. If
// GEMINI_API_KEY isn't set, speaker ID is silently disabled (it already
// fails safe) -- nothing else in this service depends on Gemini anymore.
export const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export const GEMINI_MODEL = "gemini-2.5-flash";
