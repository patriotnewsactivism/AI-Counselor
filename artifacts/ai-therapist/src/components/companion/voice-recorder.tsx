import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Mic, Square, Loader2, Send, Radio, ShieldCheck, Volume2, Hand, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type LiveListenMode = "always" | "wake";

type TurnState = "idle" | "starting" | "listening" | "recording" | "processing" | "speaking";

type WakeRecognitionResult = {
  isFinal?: boolean;
  0?: { transcript?: string };
};

type WakeRecognitionEvent = Event & {
  results: ArrayLike<WakeRecognitionResult>;
};

type WakeRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: WakeRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type WakeRecognitionConstructor = new () => WakeRecognition;

export interface VoiceRecorderHandle {
  /** Start a hands-free conversation session. */
  startRecording: () => Promise<void>;
  /** Pause VAD while Aura is speaking without releasing the microphone. */
  pauseForPlayback: () => void;
  /** Resume turn detection after Aura finishes speaking. */
  resumeListening: () => void;
  /** End the hands-free conversation session and release the microphone. */
  stopRecording: () => void;
}

interface VoiceRecorderProps {
  onSendAudio: (base64: string, mimeType: string) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
  /** Keep true while the companion is transcribing or thinking. */
  isProcessing: boolean;
  /** Keep true while Aura's reply audio is playing. */
  isSpeaking: boolean;
  /** Called immediately when the user's voice interrupts reply playback. */
  onBargeIn?: () => void;
  /** Whether Aura's reply audio is currently playing or paused. */
  playbackActive?: boolean;
  /** Whether the current reply is paused at its current audio position. */
  playbackPaused?: boolean;
  /** Stop reply playback and open the microphone for a fresh turn. */
  onInterruptPlayback?: () => void;
  /** Pause reply playback without discarding the unplayed reply. */
  onPausePlayback?: () => void;
  /** Resume a paused reply. */
  onResumePlayback?: () => void;
  mode: LiveListenMode;
  wakeWord: string;
  onModeChange: (mode: LiveListenMode) => void;
  onWakeWordChange: (wakeWord: string) => void;
  onSessionChange?: (active: boolean) => void;
}

const START_THRESHOLD = 0.035;
const SILENCE_THRESHOLD = 0.022;
const START_HOLD_MS = 140;
const SILENCE_HOLD_MS = 1050;
const MIN_TURN_MS = 420;
const MAX_TURN_MS = 45_000;

function supportedMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read recording"));
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(
  function VoiceRecorder(
    {
      onSendAudio,
      onSendText,
      isProcessing,
      isSpeaking,
      onBargeIn,
      playbackActive = false,
      playbackPaused = false,
      onInterruptPlayback,
      onPausePlayback,
      onResumePlayback,
      mode,
      wakeWord,
      onModeChange,
      onWakeWordChange,
      onSessionChange,
    },
    ref,
  ) {
    const [sessionActive, setSessionActive] = useState(false);
    const [turnState, setTurnState] = useState<TurnState>("idle");
    const [textMode, setTextMode] = useState(false);
    const [text, setText] = useState("");
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [micError, setMicError] = useState<string | null>(null);
    const sessionActiveRef = useRef(false);
    const startInFlightRef = useRef(false);
    const turnStateRef = useRef<TurnState>("idle");
    const isProcessingRef = useRef(isProcessing);
    const isSpeakingRef = useRef(isSpeaking);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sampleBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const speechStartedAtRef = useRef<number | null>(null);
    const silenceStartedAtRef = useRef<number | null>(null);
    const turnStartedAtRef = useRef<number | null>(null);
    const discardTurnRef = useRef(false);
    const playbackPausedRef = useRef(false);
    const durationTimerRef = useRef<number | null>(null);
    const wakeRecognitionRef = useRef<WakeRecognition | null>(null);
    const wakeRestartTimerRef = useRef<number | null>(null);
    const wakeArmedRef = useRef(mode === "always");
    const wakeWordRef = useRef(wakeWord);
    const modeRef = useRef(mode);
    const onSessionChangeRef = useRef(onSessionChange);
    const onBargeInRef = useRef(onBargeIn);

    useEffect(() => {
      wakeWordRef.current = wakeWord;
      modeRef.current = mode;
      onSessionChangeRef.current = onSessionChange;
      onBargeInRef.current = onBargeIn;
    }, [mode, onBargeIn, onSessionChange, wakeWord]);

    useEffect(() => {
      isProcessingRef.current = isProcessing;
      isSpeakingRef.current = isSpeaking;
      if (isProcessing) {
        stopWakeRecognition();
        if (turnStateRef.current !== "processing") {
          turnStateRef.current = "processing";
          setTurnState("processing");
        }
      }
    }, [isProcessing, isSpeaking]);

    useEffect(() => {
      modeRef.current = mode;
      if (!sessionActiveRef.current) return;
      if (mode === "always") {
        wakeArmedRef.current = true;
        stopWakeRecognition();
        if (!isProcessingRef.current && !recorderRef.current) setTurn("listening");
      } else {
        wakeArmedRef.current = false;
        if (!isProcessingRef.current && !recorderRef.current) {
          setTurn("listening");
          startWakeRecognition();
        }
      }
    }, [mode]);

    const setTurn = (next: TurnState) => {
      turnStateRef.current = next;
      setTurnState(next);
    };

    const stopMonitor = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const stopWakeRecognition = () => {
      if (wakeRestartTimerRef.current !== null) {
        window.clearTimeout(wakeRestartTimerRef.current);
        wakeRestartTimerRef.current = null;
      }
      const recognition = wakeRecognitionRef.current;
      wakeRecognitionRef.current = null;
      if (recognition) {
        try { recognition.onend = null; recognition.abort(); } catch { /* already stopped */ }
      }
    };

    const wakeRecognitionConstructor = () => {
      if (typeof window === "undefined") return undefined;
      const browserWindow = window as typeof window & {
        SpeechRecognition?: WakeRecognitionConstructor;
        webkitSpeechRecognition?: WakeRecognitionConstructor;
      };
      return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    };

    const startWakeRecognition = () => {
      if (!sessionActiveRef.current || modeRef.current !== "wake" || isProcessingRef.current || wakeRecognitionRef.current) return;
      const Recognition = wakeRecognitionConstructor();
      if (!Recognition) return;

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        const configuredWakeWord = wakeWordRef.current.trim().toLocaleLowerCase() || "aura";
        for (let index = 0; index < event.results.length; index += 1) {
          const transcript = event.results[index]?.[0]?.transcript?.trim().toLocaleLowerCase() || "";
          if (transcript.includes(configuredWakeWord)) {
            wakeArmedRef.current = true;
            stopWakeRecognition();
            setTurn("listening");
            break;
          }
        }
      };
      recognition.onerror = (event) => {
        if (event.error !== "not-allowed" && event.error !== "service-not-allowed") {
          wakeRestartTimerRef.current = window.setTimeout(() => {
            wakeRecognitionRef.current = null;
            startWakeRecognition();
          }, 500);
        }
      };
      recognition.onend = () => {
        wakeRecognitionRef.current = null;
        if (sessionActiveRef.current && modeRef.current === "wake" && !isProcessingRef.current) {
          wakeRestartTimerRef.current = window.setTimeout(startWakeRecognition, 300);
        }
      };
      wakeRecognitionRef.current = recognition;
      try { recognition.start(); } catch { wakeRecognitionRef.current = null; }
    };

    const releaseMicrophone = () => {
      stopWakeRecognition();
      stopMonitor();
      if (durationTimerRef.current !== null) {
        window.clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };

    const stopTurn = (send: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== "recording") return;
      discardTurnRef.current = !send;
      // Keep recorderRef occupied until onstop has flushed the audio and
      // released it. This prevents a second recorder from starting mid-stop.
      recorder.stop();
      speechStartedAtRef.current = null;
      silenceStartedAtRef.current = null;
      turnStartedAtRef.current = null;
      setTurn(send ? "processing" : sessionActiveRef.current ? "listening" : "idle");
      setRecordingDuration(0);
    };

    const beginTurn = () => {
      if (!sessionActiveRef.current || isProcessingRef.current || playbackPausedRef.current || recorderRef.current) return;
      if (modeRef.current === "wake" && !wakeArmedRef.current) return;
      const stream = streamRef.current;
      if (!stream) return;

      const mimeType = supportedMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        console.error("Could not create audio recorder", error);
        setMicError("This browser could not start a live recording.");
        return;
      }

      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      chunksRef.current = chunks;
      discardTurnRef.current = false;
      turnStartedAtRef.current = performance.now();
      setRecordingDuration(0);
      setTurn("recording");

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        // MediaRecorder.stop() is asynchronous. Keep the ref occupied until
        // this callback runs so VAD cannot start a second recorder while the
        // previous one is still flushing its final audio chunk.
        if (recorderRef.current === recorder) recorderRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        const shouldSend = !discardTurnRef.current && sessionActiveRef.current && blob.size > 0;
        if (!shouldSend) chunksRef.current = [];

        if (!shouldSend) {
          if (sessionActiveRef.current && !isProcessingRef.current) setTurn("listening");
          return;
        }
        // Reserve the request before yielding to FileReader so a stop/start
        // race cannot queue the same captured turn twice.
        if (isProcessingRef.current) {
          if (sessionActiveRef.current) setTurn("listening");
          return;
        }
        if (modeRef.current === "wake") wakeArmedRef.current = false;
        chunksRef.current = [];
        setMicError(null);

        void (async () => {
          try {
            const base64 = await blobToBase64(blob);
            await onSendAudio(base64, blob.type || mimeType || "audio/webm");
          } catch (error) {
            console.error("Failed to send live voice turn", error);
            setMicError("I couldn't send that turn. Please try again.");
          } finally {
            if (sessionActiveRef.current && !isProcessingRef.current) setTurn("listening");
          }
        })();
      };

      // Emit chunks while recording. Mobile browsers can otherwise lose the
      // only final chunk when stop() races the MediaRecorder flush event.
      try {
        recorder.start(250);
      } catch (error) {
        recorderRef.current = null;
        console.error("Could not start audio recorder", error);
        setTurn("listening");
        setMicError("This browser could not start a live recording.");
        return;
      }
      if (durationTimerRef.current !== null) window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = window.setInterval(() => {
        setRecordingDuration((value) => value + 1);
      }, 1000);
    };

    const monitor = () => {
      if (!sessionActiveRef.current) return;
      const analyser = analyserRef.current;
      if (!analyser) return;

      if (!sampleBufferRef.current || sampleBufferRef.current.length !== analyser.fftSize) {
        sampleBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      const sampleBuffer = sampleBufferRef.current;
      analyser.getByteTimeDomainData(sampleBuffer);

      let sum = 0;
      for (const value of sampleBuffer) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const level = Math.sqrt(sum / sampleBuffer.length);

      if (playbackPausedRef.current && isSpeakingRef.current) {
        // Keep the analyser hot during playback. If the person starts talking,
        // cut Aura off immediately and then record that fresh turn.
        if (level >= START_THRESHOLD) {
          playbackPausedRef.current = false;
          isSpeakingRef.current = false;
          onBargeInRef.current?.();
          setTurn("listening");
        } else {
          animationFrameRef.current = requestAnimationFrame(monitor);
          return;
        }
      }
      if (playbackPausedRef.current) {
        animationFrameRef.current = requestAnimationFrame(monitor);
        return;
      }

      const now = performance.now();
      const recorder = recorderRef.current;

      if (!isProcessingRef.current && turnStateRef.current === "listening" && !recorder) {
        if (level >= START_THRESHOLD) {
          speechStartedAtRef.current ??= now;
          if (now - speechStartedAtRef.current >= START_HOLD_MS) beginTurn();
        } else {
          speechStartedAtRef.current = null;
        }
      } else if (!isProcessingRef.current && turnStateRef.current === "recording" && recorder) {
        const turnStartedAt = turnStartedAtRef.current ?? now;
        if (level < SILENCE_THRESHOLD) {
          silenceStartedAtRef.current ??= now;
          const hasMinimumLength = now - turnStartedAt >= MIN_TURN_MS;
          const heldLongEnough = now - silenceStartedAtRef.current >= SILENCE_HOLD_MS;
          const reachedMaximum = now - turnStartedAt >= MAX_TURN_MS;
          if ((hasMinimumLength && heldLongEnough) || reachedMaximum) stopTurn(true);
        } else {
          silenceStartedAtRef.current = null;
        }
      }

      animationFrameRef.current = requestAnimationFrame(monitor);
    };

    const startRecording = async () => {
      if (sessionActiveRef.current || startInFlightRef.current || isProcessingRef.current) return;
      startInFlightRef.current = true;
      setMicError(null);
      setTurn("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) throw new Error("AudioContext unavailable");
        const context = new AudioContextClass();
        await context.resume();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.25;
        source.connect(analyser);

        streamRef.current = stream;
        audioContextRef.current = context;
        analyserRef.current = analyser;
        sessionActiveRef.current = true;
        isSpeakingRef.current = false;
        playbackPausedRef.current = false;
        setSessionActive(true);
        onSessionChangeRef.current?.(true);
        wakeArmedRef.current = modeRef.current === "always";
        setTurn("listening");
        if (modeRef.current === "wake") startWakeRecognition();
        animationFrameRef.current = requestAnimationFrame(monitor);
      } catch (error) {
        console.error("Error accessing microphone:", error);
        releaseMicrophone();
        setTurn("idle");
        setMicError("Microphone access is needed for a live conversation. Check your browser permission and try again.");
      } finally {
        startInFlightRef.current = false;
      }
    };

    const stopRecording = () => {
      startInFlightRef.current = false;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") stopTurn(false);
      sessionActiveRef.current = false;
      isSpeakingRef.current = false;
      playbackPausedRef.current = false;
      discardTurnRef.current = true;
      setSessionActive(false);
      onSessionChangeRef.current?.(false);
      setTurn("idle");
      releaseMicrophone();
      setRecordingDuration(0);
    };

    const pauseForPlayback = () => {
      if (!sessionActiveRef.current) return;
      isSpeakingRef.current = true;
      playbackPausedRef.current = true;
      stopWakeRecognition();
      if (recorderRef.current?.state === "recording") stopTurn(false);
      setTurn("speaking");
    };

    const resumeListening = () => {
      if (!sessionActiveRef.current) return;
      isSpeakingRef.current = false;
      playbackPausedRef.current = false;
      isProcessingRef.current = false;
      wakeArmedRef.current = modeRef.current === "always";
      setTurn("listening");
      if (modeRef.current === "wake") startWakeRecognition();
      if (animationFrameRef.current === null) animationFrameRef.current = requestAnimationFrame(monitor);
    };

    useImperativeHandle(ref, () => ({ startRecording, pauseForPlayback, resumeListening, stopRecording }));

    useEffect(() => {
      return () => {
        sessionActiveRef.current = false;
        discardTurnRef.current = true;
        onSessionChangeRef.current?.(false);
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        releaseMicrophone();
      };
    }, []);

    const formatTime = (seconds: number) => {
      const minutes = Math.floor(seconds / 60);
      const remaining = seconds % 60;
      return `${minutes}:${remaining.toString().padStart(2, "0")}`;
    };

    const handleTextSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      if (!text.trim() || isProcessing) return;
      void onSendText(text.trim());
      setText("");
    };

    const handleInterruptPlayback = () => {
      onInterruptPlayback?.();
    };

    const handlePausePlayback = () => {
      if (!playbackActive) return;
      onPausePlayback?.();
    };

    const handleResumePlayback = () => {
      onResumePlayback?.();
    };

    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-4">
        {textMode ? (
          <form onSubmit={handleTextSubmit} className="w-full flex gap-2 items-end">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Type your message..."
              className="flex-1 min-h-[60px] max-h-[200px] resize-y bg-card border border-input rounded-2xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleTextSubmit(event);
                }
              }}
              disabled={isProcessing}
            />
            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="icon"
                className="h-12 w-12 rounded-full rounded-br-md shrink-0 bg-primary text-primary-foreground hover:opacity-90"
                disabled={!text.trim() || isProcessing}
              >
                {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-1" />}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-8 text-muted-foreground hover:text-foreground" onClick={() => setTextMode(false)}>
                Voice
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-5 w-full">
            {!sessionActive ? (
              <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/70 p-4 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Radio className="h-4 w-4 text-primary" />
                  <span>How should Aura listen?</span>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/60 p-1">
                  <button
                    type="button"
                    onClick={() => onModeChange("always")}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm transition-colors",
                      mode === "always" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Always live
                  </button>
                  <button
                    type="button"
                    onClick={() => onModeChange("wake")}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm transition-colors",
                      mode === "wake" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Say my name first
                  </button>
                </div>
                {mode === "wake" && (
                  <div className="space-y-2">
                    <label htmlFor="wake-word" className="text-xs font-medium text-muted-foreground">Wake name</label>
                    <Input
                      id="wake-word"
                      value={wakeWord}
                      onChange={(event) => onWakeWordChange(event.target.value)}
                      placeholder="Aura"
                      maxLength={32}
                      className="h-10 bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">Start a turn with “{wakeWord.trim() || "Aura"}” when you want a reply.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full max-w-md rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 shadow-sm" aria-live="polite">
                <div className="flex items-center gap-3">
                  <div className={cn("h-3 w-3 rounded-full", turnState === "recording" ? "bg-destructive animate-pulse" : turnState === "processing" ? "bg-amber-500 animate-pulse" : turnState === "speaking" ? "bg-sky-500 animate-pulse" : turnState === "starting" ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {turnState === "starting" ? "Starting microphone…" : turnState === "recording" ? "I’m listening…" : turnState === "processing" ? "Aura is thinking…" : turnState === "speaking" ? "Aura is speaking — talk to interrupt" : mode === "wake" ? `Say “${wakeWord.trim() || "Aura"}” when you’re ready` : "Listening for you"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {turnState === "recording" ? formatTime(recordingDuration) : "You can set your phone down. No tap is needed between turns."}
                    </p>
                  </div>
                  {turnState === "processing" || turnState === "speaking" ? <Volume2 className="h-4 w-4 text-amber-600 shrink-0" /> : <Mic className="h-4 w-4 text-primary shrink-0" />}
                </div>
              </div>
            )}

            {sessionActive && playbackActive && (
              <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Aura playback controls">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleInterruptPlayback}
                  title="Stop Aura now and start listening"
                  aria-label="Interrupt Aura and speak now"
                >
                  <Hand className="h-4 w-4" />
                  Interrupt Aura
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={playbackPaused ? handleResumePlayback : handlePausePlayback}
                  title={playbackPaused ? "Resume Aura's reply" : "Pause Aura so you can speak"}
                  aria-label={playbackPaused ? "Resume Aura" : "Pause Aura and speak now"}
                >
                  {playbackPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {playbackPaused ? "Resume Aura" : "Pause & speak"}
                </Button>
              </div>
            )}

            <div className="relative">
              {sessionActive && turnState !== "processing" && (
                <>
                  <div className="absolute inset-0 bg-primary/20 rounded-full scale-[2] animate-pulse pointer-events-none" />
                  <div className="absolute inset-0 bg-primary/30 rounded-full scale-[1.5] animate-ping pointer-events-none" style={{ animationDuration: "3s" }} />
                </>
              )}
              <button
                onClick={sessionActive ? stopRecording : () => { void startRecording(); }}
                disabled={!sessionActive && (isProcessing || startInFlightRef.current || turnState === "starting")}
                aria-label={sessionActive ? "End live conversation" : "Start live conversation"}
                className={cn(
                  "relative z-10 flex items-center justify-center h-24 w-24 rounded-full transition-all duration-300 shadow-lg",
                  sessionActive ? "bg-destructive text-destructive-foreground scale-110" : isProcessing ? "bg-card border-2 border-border text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
                )}
              >
                {sessionActive ? <Square className="h-8 w-8 fill-current" /> : isProcessing ? <Loader2 className="h-10 w-10 animate-spin" /> : <Mic className="h-10 w-10" />}
              </button>
            </div>

            <div className="flex flex-col items-center gap-1 text-center min-h-10">
              <span className={cn("text-sm font-medium", sessionActive ? "text-primary" : "text-muted-foreground")}>
                {sessionActive ? "End live conversation" : "Start live conversation"}
              </span>
              {sessionActive && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" /> Microphone is on until you end the session
                </span>
              )}
              {micError && <span className="max-w-sm text-xs text-destructive">{micError}</span>}
            </div>

            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setTextMode(true)} disabled={sessionActive || isProcessing}>
              Or type a message
            </Button>
          </div>
        )}
      </div>
    );
  },
);
