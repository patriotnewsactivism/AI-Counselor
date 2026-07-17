import { GoogleGenAI } from "@google/genai";

/**
 * Speaker matching is optional. Keep this client lazy so the Mistral/Groq
 * companion can start even when no Gemini key is configured.
 */
let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** @deprecated Use getGeminiClient(); retained for package consumers. */
export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, property) {
    const instance = getGeminiClient();
    if (!instance) {
      throw new Error("Gemini is not configured; speaker matching is unavailable.");
    }
    return Reflect.get(instance, property, instance);
  },
});

export const GEMINI_MODEL = "gemini-2.5-flash";
