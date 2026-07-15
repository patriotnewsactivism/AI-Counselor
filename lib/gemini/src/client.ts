import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY must be set. This service uses the user's own Gemini API key.",
  );
}

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const GEMINI_MODEL = "gemini-2.5-flash";
