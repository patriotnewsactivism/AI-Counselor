import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Send, Volume2, ShieldCheck, KeyboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Live, hands-free conversation built on the browser's native speech engine.
 *
 * Why native Web Speech instead of the old MediaRecorder + server STT/TTS path:
 * `SpeechRecognition` has real, built-in endpointing — it knows when you stop
 * talking — which is precisely the piece the old hand-rolled volume-threshold
 * VAD kept getting wrong (mic not opening, cutting off mid-sentence, or never
 * firing a turn). `speechSynthesis` speaks the reply locally, so there is no
 * audio upload, no server transcription, no server text-to-speech, and no
 * audio-element playback/resume races. The only network call is the text LLM
 * turn, which is the same proven endpoint the typed path uses.
 */

type Phase = "idle" | "listening" | "thinking" | "speaking";

// Minimal Web Speech API typings — these interfaces are not present in every
// TS DOM lib version, so we describe just the surface we use.
interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  isFinal: boolean;
  0: SpeechAlternativeLike;
  length: number;
}
interface SpeechEventLike extends Event {
  results: ArrayLike<SpeechResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(getRecognitionCtor()) &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

interface LiveConversationProps {
  /** Sends the user's turn to the companion and resolves with the reply text
   *  so it can be spoken aloud. Should throw on failure. */
  onSendTurn: (text: string) => Promise<string>;
  companionName: string;
}

export function LiveConversation({ onSendTurn, companionName }: LiveConversationProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState("");
  const [supported] = useState<boolean>(() => speechSupported());

  const activeRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const busyRef = useRef(false); // true while thinking or speaking — mic must stay off
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const updatePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // Voices load asynchronously in most browsers; keep a fresh copy around.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      try {
        window.speechSynthesis.onvoiceschanged = null;
      } catch {
        /* ignore */
      }
    };
  }, []);

  const pickVoice = (): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current;
    if (!voices.length) return null;
    const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
    const pool = english.length ? english : voices;
    const warm = pool.find((voice) =>
      /female|samantha|karen|moira|tessa|jenny|aria|zira|google us english|natural/i.test(voice.name),
    );
    return warm ?? pool[0];
  };

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const scheduleRestart = (delay = 250) => {
    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      startRecognition();
    }, delay);
  };

  const startRecognition = () => {
    if (!activeRef.current || busyRef.current || recognitionRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onstart = () => {
      if (activeRef.current && !busyRef.current) updatePhase("listening");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      setPartial((interim || finalText).trim());
    };

    recognition.onerror = (event) => {
      const errorKind = event.error;
      if (errorKind === "not-allowed" || errorKind === "service-not-allowed") {
        setError(
          "Microphone access is blocked. Enable the mic permission for this site in your browser, then tap Start again.",
        );
        stop();
      }
      // "no-speech", "aborted", "network", etc. fall through to onend, which
      // decides whether to loop the mic again.
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      const said = finalText.trim();
      setPartial("");
      if (!activeRef.current) return;
      if (said) {
        void handleUtterance(said);
      } else if (!busyRef.current) {
        scheduleRestart(300);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if called too soon after the previous session ended.
      recognitionRef.current = null;
      scheduleRestart(400);
    }
  };

  const speak = (toSpeak: string): Promise<void> =>
    new Promise((resolve) => {
      if (!toSpeak || typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      updatePhase("speaking");
      const utterance = new SpeechSynthesisUtterance(toSpeak);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    });

  const handleUtterance = async (said: string) => {
    busyRef.current = true;
    updatePhase("thinking");
    setError(null);
    try {
      const reply = await onSendTurn(said);
      if (!activeRef.current) return;
      await speak(reply);
    } catch (sendError) {
      console.error("Live turn failed", sendError);
      if (activeRef.current) {
        setError("That turn didn't go through — I'm still here and listening. Try saying it again.");
      }
    } finally {
      busyRef.current = false;
      if (activeRef.current) {
        updatePhase("listening");
        scheduleRestart(150);
      }
    }
  };

  const start = () => {
    if (!supported) {
      setTextMode(true);
      return;
    }
    setError(null);
    activeRef.current = true;
    busyRef.current = false;
    setActive(true);
    updatePhase("listening");
    // Priming a (silent) utterance inside the tap keeps mobile browsers from
    // blocking the first real spoken reply as un-gestured audio.
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    startRecognition();
  };

  const stop = () => {
    activeRef.current = false;
    busyRef.current = false;
    clearRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    setPartial("");
    setActive(false);
    updatePhase("idle");
  };

  // Cancel her reply and hand the floor straight back to the user, without
  // ending the session.
  const interrupt = () => {
    if (!activeRef.current) return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    busyRef.current = false;
    updatePhase("listening");
    scheduleRestart(120);
  };

  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearRestartTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try {
          recognition.onend = null;
          recognition.abort();
        } catch {
          /* ignore */
        }
      }
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const handleTextSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || phaseRef.current === "thinking") return;
    setText("");
    busyRef.current = true;
    updatePhase("thinking");
    try {
      const reply = await onSendTurn(content);
      if (supported && active) await speak(reply);
    } catch (sendError) {
      console.error("Text turn failed", sendError);
      setError("That message didn't go through. Please try again.");
    } finally {
      busyRef.current = false;
      if (active && supported) {
        updatePhase("listening");
        scheduleRestart(150);
      } else {
        updatePhase("idle");
      }
    }
  };

  const statusLine = (() => {
    switch (phase) {
      case "listening":
        return partial ? partial : "Listening… speak naturally.";
      case "thinking":
        return `${companionName} is thinking…`;
      case "speaking":
        return `${companionName} is speaking…`;
      default:
        return "Start a live conversation and just talk.";
    }
  })();

  if (textMode || !supported) {
    return (
      <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-4">
        {!supported && (
          <p className="text-xs text-muted-foreground text-center max-w-md">
            Live voice isn't supported in this browser. You can still type below — for hands-free
            voice, open this in Chrome on Android or desktop.
          </p>
        )}
        <form onSubmit={handleTextSubmit} className="w-full flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type your message…"
            className="flex-1 min-h-[60px] max-h-[200px] resize-y bg-card border border-input rounded-2xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleTextSubmit(event);
              }
            }}
            disabled={phase === "thinking"}
          />
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              size="icon"
              className="h-12 w-12 rounded-full rounded-br-md shrink-0 bg-primary text-primary-foreground hover:opacity-90"
              disabled={!text.trim() || phase === "thinking"}
            >
              {phase === "thinking" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-1" />}
            </Button>
            {supported && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-8 text-muted-foreground hover:text-foreground"
                onClick={() => setTextMode(false)}
              >
                Voice
              </Button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-5">
      <div
        className="w-full max-w-md rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 shadow-sm min-h-[64px] flex items-center"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 w-full">
          <div
            className={cn(
              "h-3 w-3 rounded-full shrink-0",
              phase === "listening"
                ? "bg-emerald-500 animate-pulse"
                : phase === "thinking"
                  ? "bg-amber-500 animate-pulse"
                  : phase === "speaking"
                    ? "bg-primary animate-pulse"
                    : "bg-muted-foreground/40",
            )}
          />
          <p className="text-sm text-foreground flex-1 min-w-0 break-words">{statusLine}</p>
          {phase === "speaking" ? (
            <Volume2 className="h-4 w-4 text-primary shrink-0" />
          ) : (
            <Mic className="h-4 w-4 text-primary shrink-0" />
          )}
        </div>
      </div>

      <div className="relative">
        {active && phase !== "thinking" && (
          <>
            <div className="absolute inset-0 bg-primary/20 rounded-full scale-[2] animate-pulse pointer-events-none" />
            <div
              className="absolute inset-0 bg-primary/30 rounded-full scale-[1.5] animate-ping pointer-events-none"
              style={{ animationDuration: "3s" }}
            />
          </>
        )}
        <button
          onClick={() => (active ? stop() : start())}
          aria-label={active ? "End live conversation" : "Start live conversation"}
          className={cn(
            "relative z-10 flex items-center justify-center h-24 w-24 rounded-full transition-all duration-300 shadow-lg",
            active
              ? "bg-destructive text-destructive-foreground scale-110"
              : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
          )}
        >
          {active ? <Square className="h-8 w-8 fill-current" /> : <Mic className="h-10 w-10" />}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 text-center min-h-10">
        <span className={cn("text-sm font-medium", active ? "text-primary" : "text-muted-foreground")}>
          {active ? "End live conversation" : "Start live conversation"}
        </span>
        {active && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Microphone stays on until you end the session
          </span>
        )}
        {active && phase === "speaking" && (
          <Button variant="outline" size="sm" className="gap-1.5 mt-1" onClick={interrupt}>
            <Mic className="h-3.5 w-3.5" /> Cut in
          </Button>
        )}
        {error && <span className="max-w-sm text-xs text-destructive">{error}</span>}
      </div>

      {!active && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
          onClick={() => setTextMode(true)}
        >
          <KeyboardIcon className="h-3.5 w-3.5" /> Or type a message
        </Button>
      )}
    </div>
  );
}
