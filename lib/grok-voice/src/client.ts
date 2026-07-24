if (!process.env.XAI_API_KEY) {
  throw new Error(
    "XAI_API_KEY must be set. This service uses xAI's Grok streaming STT/TTS APIs.",
  );
}

export const XAI_API_KEY = process.env.XAI_API_KEY;
export const XAI_REST_BASE = "https://api.x.ai/v1";
export const XAI_STT_WS_URL = "wss://api.x.ai/v1/stt";
