import WebSocket from "ws";
import { XAI_API_KEY, XAI_REST_BASE, XAI_STT_WS_URL } from "./client";

export { XAI_API_KEY };

/**
 * Synthesizes speech from text using xAI's Grok TTS REST endpoint.
 * Called once per finished sentence by the pipelined companion exchange,
 * so audio starts streaming back to the caller well before the full reply
 * has finished generating. Mirrors @workspace/deepgram's synthesizeSpeech
 * shape so callers can treat the two providers interchangeably.
 */
export async function synthesizeSpeechGrok(
  text: string,
  voice = "eve",
): Promise<{ audio: Buffer; mimeType: string }> {
  const response = await fetch(`${XAI_REST_BASE}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      language: "en",
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      optimize_streaming_latency: 1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Grok TTS error: ${response.status} - ${errText.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer), mimeType: "audio/mpeg" };
}

export interface GrokTranscriptEvent {
  /** Best-effort parse of xAI's streaming STT event shape — field names are
   * defensive (`text`/`transcript`, `is_final`/`isFinal`) since the exact
   * wire shape should be confirmed against a live connection before this
   * goes to production. */
  text: string;
  isFinal: boolean;
  raw: unknown;
}

/**
 * Thin wrapper around xAI's streaming STT WebSocket
 * (wss://api.x.ai/v1/stt). Caller streams raw 16-bit PCM audio frames in via
 * sendAudio(), and receives parsed transcript events via onTranscript.
 *
 * Per xAI's own docs: never expose XAI_API_KEY client-side — this class is
 * meant to run server-side, proxying a client's raw mic audio through our
 * own backend WebSocket connection.
 */
export class GrokTranscriptionStream {
  private ws: WebSocket;
  private closed = false;

  constructor(opts: {
    sampleRate?: number;
    onTranscript: (event: GrokTranscriptEvent) => void;
    onError: (err: Error) => void;
    onClose?: () => void;
  }) {
    const sampleRate = opts.sampleRate ?? 16000;
    const url = `${XAI_STT_WS_URL}?sample_rate=${sampleRate}&encoding=pcm&interim_results=true&endpointing=300`;

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${XAI_API_KEY}` },
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        const text: string = parsed.text ?? parsed.transcript ?? "";
        const isFinal: boolean = parsed.is_final ?? parsed.isFinal ?? false;
        if (text) {
          opts.onTranscript({ text, isFinal, raw: parsed });
        }
      } catch (err) {
        opts.onError(
          err instanceof Error ? err : new Error("Failed to parse Grok STT event"),
        );
      }
    });

    this.ws.on("error", (err: Error) => opts.onError(err));
    this.ws.on("close", () => {
      this.closed = true;
      opts.onClose?.();
    });
  }

  /** Send a raw PCM16LE audio chunk to Grok for transcription. */
  sendAudio(chunk: Buffer): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(chunk);
  }

  close(): void {
    if (!this.closed) this.ws.close();
  }
}
