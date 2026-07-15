import { DeepgramClient } from "@deepgram/sdk";

if (!process.env.DEEPGRAM_API_KEY) {
  throw new Error(
    "DEEPGRAM_API_KEY must be set. This service uses the user's own Deepgram API key.",
  );
}

export const deepgram = new DeepgramClient({
  apiKey: process.env.DEEPGRAM_API_KEY,
});
