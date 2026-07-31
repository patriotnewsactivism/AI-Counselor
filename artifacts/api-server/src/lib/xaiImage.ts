/**
 * xAI Grok image generation client. Uses the same XAI_API_KEY the voice
 * pipeline (lib/grok-voice) already requires — no new secret needed.
 */
const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_IMAGE_URL = "https://api.x.ai/v1/images/generations";

export async function generateImage(prompt: string): Promise<string> {
  if (!XAI_API_KEY) {
    throw new Error("XAI_API_KEY must be set to use image generation.");
  }

  const res = await fetch(XAI_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-image-1212",
      prompt,
      n: 1,
      response_format: "url",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI image generation failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { data?: Array<{ url?: string }> };
  const url = data.data?.[0]?.url;
  if (!url) {
    throw new Error("xAI image generation returned no image url");
  }
  return url;
}
