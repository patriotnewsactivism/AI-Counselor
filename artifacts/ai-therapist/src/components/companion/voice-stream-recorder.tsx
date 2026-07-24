import { forwardRef, useImperativeHandle, useRef, useState } from "react";

/**
 * NEW Grok-powered live voice component. Built ALONGSIDE the existing
 * `voice-recorder.tsx` (MediaRecorder + HTTP + Deepgram) -- nothing old has
 * been removed or wired in yet. This file is not imported by companion.tsx
 * yet; it exists so it can be reviewed, typechecked, and wired in during a
 * session where the user can live-test with a real microphone.
 *
 * Talks to the `/ws/voice-stream` route (see
 * artifacts/api-server/src/routes/conversations/voiceStream.ts) which
 * replaces the old client-side silence-timer VAD with Grok's own
 * server-side streaming STT + endpointing -- this component just streams
 * raw mic audio continuously and reacts to server-sent events. No client
 * VAD math, no "how long was that pause" guessing.
 *
 * Protocol (must match the server exactly):
 *   Client -> server: binary PCM16LE mono 16kHz frames, plus
 *                      {type:"barge-in"} JSON control frames.
 *   Server -> client: {type:"transcript", text, isFinal}
 *                      {type:"assistant-sentence", text}
 *                      <binary audio/mpeg frame(s)>
 *                      {type:"assistant-done"}
 *                      {type:"error", message}
 */

export type StreamTurnState = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface VoiceStreamRecorderHandle {
  /** conversationId must be the freshly-resolved id (e.g. from
   * ensureConversation()), passed directly rather than as a prop, since
   * async navigation to a brand-new conversation's URL would otherwise
   * still be stale at the instant start() runs. */
  start: (conversationId: number) => Promise<void>;
  stop: () => void;
}

interface VoiceStreamRecorderProps {
  /** Base WS URL for the API, e.g. wss://therapist-api.up.railway.app (no path). */
  wsBaseUrl: string;
  /** Returns a fresh Clerk session JWT, or null if unavailable. */
  getToken: () => Promise<string | null>;
  onTurnStateChange?: (state: StreamTurnState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAssistantSentence?: (text: string) => void;
  /** Fired once the assistant has finished a full reply -- caller should
   * refetch/invalidate the messages list, since messages are persisted
   * server-side regardless of transport. */
  onAssistantDone?: () => void;
  onError?: (message: string) => void;
}

type ServerEvent =
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "assistant-sentence"; text: string }
  | { type: "assistant-done" }
  | { type: "error"; message: string };

const TARGET_SAMPLE_RATE = 16000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

/** Downsamples a Float32 buffer from `inRate` to 16kHz and converts to
 * signed 16-bit PCM, little-endian -- the exact format Grok's streaming STT
 * expects. Simple linear-interpolation resampler; audio quality is more
 * than sufficient for speech recognition. */
function floatTo16kPcm(input: Float32Array, inRate: number): ArrayBuffer {
  if (inRate === TARGET_SAMPLE_RATE) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  }

  const ratio = inRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const buffer = new ArrayBuffer(outLength * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const frac = srcIndex - srcIndexFloor;
    const sample = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

export const VoiceStreamRecorder = forwardRef<VoiceStreamRecorderHandle, VoiceStreamRecorderProps>(
  function VoiceStreamRecorder(
    { wsBaseUrl, getToken, onTurnStateChange, onTranscript, onAssistantSentence, onAssistantDone, onError },
    ref,
  ) {
    const [, setTurnStateState] = useState<StreamTurnState>("idle");
    const wsRef = useRef<WebSocket | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mutedRef = useRef(false);
    const playbackQueueRef = useRef<Blob[]>([]);
    const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
    const isPlayingRef = useRef(false);
    const activeRef = useRef(false);

    const setTurnState = (next: StreamTurnState) => {
      setTurnStateState(next);
      onTurnStateChange?.(next);
    };

    const releaseAudioCapture = () => {
      processorRef.current?.disconnect();
      processorRef.current = null;
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };

    const playNextInQueue = () => {
      if (isPlayingRef.current) return;
      const next = playbackQueueRef.current.shift();
      if (!next) return;
      isPlayingRef.current = true;
      mutedRef.current = true; // don't let the mic pick up Aura's own voice
      setTurnState("speaking");
      const url = URL.createObjectURL(next);
      const audio = playbackAudioRef.current ?? new Audio();
      playbackAudioRef.current = audio;
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        isPlayingRef.current = false;
        if (playbackQueueRef.current.length > 0) {
          playNextInQueue();
        } else if (activeRef.current) {
          mutedRef.current = false;
          setTurnState("listening");
        }
      };
      void audio.play().catch((err) => {
        console.error("Failed to play assistant audio chunk", err);
        isPlayingRef.current = false;
      });
    };

    const stop = () => {
      activeRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      releaseAudioCapture();
      playbackQueueRef.current = [];
      setTurnState("idle");
    };

    const start = async (conversationId: number) => {
      if (activeRef.current) return;
      setTurnState("connecting");
      try {
        const token = await getToken();
        if (!token) {
          onError?.("Not signed in.");
          setTurnState("error");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;

        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error("AudioContext unavailable");
        const context = new AudioContextClass();
        await context.resume();
        audioContextRef.current = context;

        const wsUrl = `${wsBaseUrl}/ws/voice-stream?conversationId=${encodeURIComponent(String(conversationId))}&token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          activeRef.current = true;
          mutedRef.current = false;
          setTurnState("listening");

          const source = context.createMediaStreamSource(stream);
          sourceRef.current = source;
          // ScriptProcessorNode is deprecated but universally supported and
          // far simpler to ship correctly than an AudioWorklet module under
          // time pressure; fine for speech-only capture at this volume.
          const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (event) => {
            if (!activeRef.current || mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            const pcm = floatTo16kPcm(input, context.sampleRate);
            ws.send(pcm);
          };
          source.connect(processor);
          processor.connect(context.destination);
        };

        ws.onmessage = (event) => {
          if (typeof event.data === "string") {
            let parsed: ServerEvent;
            try {
              parsed = JSON.parse(event.data);
            } catch {
              return;
            }
            if (parsed.type === "transcript") {
              onTranscript?.(parsed.text, parsed.isFinal);
            } else if (parsed.type === "assistant-sentence") {
              onAssistantSentence?.(parsed.text);
            } else if (parsed.type === "assistant-done") {
              onAssistantDone?.();
              if (playbackQueueRef.current.length === 0 && !isPlayingRef.current) {
                mutedRef.current = false;
                setTurnState("listening");
              }
            } else if (parsed.type === "error") {
              onError?.(parsed.message);
            }
            return;
          }
          const blob = new Blob([event.data as ArrayBuffer], { type: "audio/mpeg" });
          playbackQueueRef.current.push(blob);
          playNextInQueue();
        };

        ws.onerror = () => {
          onError?.("Voice connection error.");
        };

        ws.onclose = () => {
          if (activeRef.current) {
            activeRef.current = false;
            releaseAudioCapture();
            setTurnState("idle");
          }
        };
      } catch (err) {
        console.error("Failed to start live voice stream", err);
        onError?.(err instanceof Error ? err.message : "Could not start the microphone.");
        releaseAudioCapture();
        setTurnState("error");
      }
    };

    useImperativeHandle(ref, () => ({ start, stop }));

    return null;
  },
);
