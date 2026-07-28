import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Send, Volume2, KeyboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Live conversation component rebuilt from scratch for reliability.
 * 
 * Architecture: Simple state machine with mutually exclusive states.
 * - IDLE: Ready to start
 * - LISTENING: Mic active, waiting for speech
 * - THINKING: Sent to AI, waiting for response
 * - SPEAKING: Playing AI response
 * 
 * Optional keyword activation: If a keyword is set, the counselor will only
 * respond when that keyword is spoken. Otherwise works like a normal phone call.
 */

type Phase = "idle" | "listening" | "thinking" | "speaking";

<<<<<<< Updated upstream
=======
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Radio-protocol style: the trigger word is a sign-off said at the END of
// what the user wants to say (e.g. "...that's all, over."), not a wake-up
// call said before it. Only matches when it's the last word in the text
// (optionally followed by punctuation), so ordinary sentences that happen to
// contain the word midway ("moreover", "over the moon") don't false-trigger.
function splitOnTriggerWord(text: string, trigger: string): string | null {
  if (!trigger) return null;
  const match = new RegExp(`\\b${escapeRegExp(trigger)}\\b[.,!?]*\\s*$`, "i").exec(text);
  if (!match) return null;
  return text.slice(0, match.index).trim();
}

// Minimal Web Speech API typings — these interfaces are not present in every
// TS DOM lib version, so we describe just the surface we use.
>>>>>>> Stashed changes
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
  onSendTurn: (text: string) => Promise<string>;
  companionName: string;
<<<<<<< Updated upstream
  keyword?: string; // Optional keyword that must be said to trigger response
}

export function LiveConversation({ onSendTurn, companionName, keyword }: LiveConversationProps) {
=======
  /** When true, the mic keeps transcribing through pauses and multiple
   *  sentences without replying — a turn is only sent once `wakeWord` is
   *  said as a sign-off (e.g. "over"), and saying it again while she's
   *  speaking interrupts her. */
  wakeWordEnabled: boolean;
  wakeWord: string;
}

export function LiveConversation({
  onSendTurn,
  companionName,
  wakeWordEnabled,
  wakeWord,
}: LiveConversationProps) {
>>>>>>> Stashed changes
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState("");
  const [supported] = useState<boolean>(() => speechSupported());
  const [keywordDetected, setKeywordDetected] = useState(false); // Track if keyword was said in current turn

  const phaseRef = useRef<Phase>("idle");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const isListeningRef = useRef(false);
  const keywordRef = useRef(false); // Track keyword detection within current utterance

  const wakeWordEnabledRef = useRef(false);
  const wakeWordRef = useRef("");
  const wakeRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRestartTimerRef = useRef<number | null>(null);
  // Accumulates finalized speech across pauses/recognizer restarts until the
  // trigger word ends a turn. Only used when wakeWordEnabled is true.
  const pendingTranscriptRef = useRef("");

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
    wakeWordRef.current = (wakeWord || "over").trim().toLocaleLowerCase();
  }, [wakeWordEnabled, wakeWord]);

  const updatePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // Load voices asynchronously
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

<<<<<<< Updated upstream
=======
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
    if (!activeRef.current || busyRef.current || recognitionRef.current || wakeRecognitionRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // Fixed for the lifetime of this recognizer instance, so a mid-utterance
    // settings change can't flip behavior underneath an in-flight session.
    const gated = wakeWordEnabledRef.current;

    const recognition = new Ctor();
    recognition.continuous = gated;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let finalText = ""; // only used in the non-gated (default) path

    recognition.onstart = () => {
      if (activeRef.current && !busyRef.current) updatePhase("listening");
    };

    recognition.onresult = (event) => {
      if (!gated) {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript ?? "";
          if (result?.isFinal) finalText += transcript;
          else interim += transcript;
        }
        setPartial((interim || finalText).trim());
        return;
      }

      // Gated: keep accumulating finalized speech across pauses until the
      // trigger word closes out the turn.
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (!result?.isFinal) {
          interim += transcript;
          continue;
        }
        const combined = pendingTranscriptRef.current
          ? `${pendingTranscriptRef.current} ${transcript.trim()}`.trim()
          : transcript.trim();
        const said = splitOnTriggerWord(combined, wakeWordRef.current);
        if (said !== null) {
          pendingTranscriptRef.current = "";
          setPartial("");
          recognition.onend = null;
          recognitionRef.current = null;
          try {
            recognition.abort();
          } catch {
            /* already stopped */
          }
          if (said) {
            void handleUtterance(said);
          } else if (activeRef.current) {
            // Trigger word said with nothing meaningful before it — keep listening.
            scheduleRestart(150);
          }
          return;
        }
        pendingTranscriptRef.current = combined;
      }
      setPartial(interim ? `${pendingTranscriptRef.current} ${interim}`.trim() : pendingTranscriptRef.current);
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
      if (gated) {
        // Natural end (silence gap, browser session limit) without hearing
        // the trigger word yet — resume, keeping whatever was accumulated.
        if (!activeRef.current) return;
        if (!busyRef.current) scheduleRestart(300);
        return;
      }
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

  const clearWakeRestartTimer = () => {
    if (wakeRestartTimerRef.current !== null) {
      window.clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  };

  const scheduleWakeRestart = (delay = 300) => {
    clearWakeRestartTimer();
    wakeRestartTimerRef.current = window.setTimeout(() => {
      wakeRestartTimerRef.current = null;
      startWakeRecognition();
    }, delay);
  };

  const stopWakeRecognition = () => {
    clearWakeRestartTimer();
    const recognition = wakeRecognitionRef.current;
    wakeRecognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
  };

  // Runs only while the companion is thinking/speaking (mic is otherwise off
  // during that window) so saying the trigger word again barges in on her.
  const startWakeRecognition = () => {
    if (
      !activeRef.current ||
      !wakeWordEnabledRef.current ||
      !busyRef.current ||
      recognitionRef.current ||
      wakeRecognitionRef.current
    ) {
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const target = wakeWordRef.current;
      if (!target) return;
      const triggerPattern = new RegExp(`\\b${escapeRegExp(target)}\\b`, "i");
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = (event.results[index]?.[0]?.transcript ?? "").trim();
        if (transcript && triggerPattern.test(transcript)) {
          stopWakeRecognition();
          interrupt();
          break;
        }
      }
    };

    recognition.onerror = (event) => {
      const errorKind = event.error;
      if (errorKind === "not-allowed" || errorKind === "service-not-allowed") {
        setError(
          "Microphone access is blocked. Enable the mic permission for this site in your browser, then tap Start again.",
        );
        stop();
      }
      // Other errors fall through to onend, which decides whether to loop.
    };

    recognition.onend = () => {
      wakeRecognitionRef.current = null;
      if (!activeRef.current || !wakeWordEnabledRef.current || !busyRef.current) return;
      scheduleWakeRestart();
    };

    wakeRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      wakeRecognitionRef.current = null;
      scheduleWakeRestart(400);
    }
  };

>>>>>>> Stashed changes
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
      if (wakeWordEnabledRef.current) startWakeRecognition(); // arm barge-in-by-wake-word
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
        updatePhase("listening");
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

  const stopRecognition = () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    isListeningRef.current = false;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
  };

  const startRecognition = () => {
    if (isListeningRef.current || recognitionRef.current) return;
    
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let finalText = "";

    recognition.onstart = () => {
      isListeningRef.current = true;
      keywordRef.current = false; // Reset keyword detection for new utterance
      if (phaseRef.current === "idle" || phaseRef.current === "listening") {
        updatePhase("listening");
      }
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      const combined = `${finalText} ${interim}`.trim();
      setPartial(combined);
      
      // Check for keyword if one is set
      if (keyword && combined.toLowerCase().includes(keyword.toLowerCase())) {
        keywordRef.current = true;
        setKeywordDetected(true);
      }
    };

    recognition.onerror = (event) => {
      const errorKind = event.error;
      if (errorKind === "not-allowed") {
        setError("Microphone access denied. Please enable mic permission and try again.");
        stopRecognition();
        updatePhase("idle");
        return;
      }
      if (errorKind === "service-not-allowed") {
        setError("Speech service unavailable. Try Chrome or use keyboard input.");
        stopRecognition();
        updatePhase("idle");
        return;
      }
      // For other errors (no-speech, network, etc.), just end quietly
      // The user can tap again if needed
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      isListeningRef.current = false;
      
      const said = finalText.trim();
      setPartial("");
      setKeywordDetected(false); // Reset visual indicator
      
      // Only process if we have speech and we're still in a listening state
      if (said && (phaseRef.current === "listening" || phaseRef.current === "idle")) {
        // If keyword is set and not empty, only respond if keyword was detected
        if (keyword && keyword.trim() && !keywordRef.current) {
          // Keyword not detected, stay listening without sending to AI
          updatePhase("listening");
          return;
        }
        void handleUtterance(said);
      } else if (phaseRef.current === "listening") {
        // No speech detected, stay in listening mode
        updatePhase("listening");
      }
    };

    recognitionRef.current = recognition;
    
    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      isListeningRef.current = false;
      console.error("Failed to start recognition", err);
      setError("Could not start microphone. Please try again.");
      updatePhase("idle");
    }
  };

  const handleUtterance = async (said: string) => {
    // Lock out further input while processing
    stopRecognition();
    updatePhase("thinking");
    setError(null);
    
    try {
      const reply = await onSendTurn(said);
      if (phaseRef.current === "thinking") {
        await speak(reply);
      }
    } catch (sendError) {
      console.error("Live turn failed", sendError);
      setError("That didn't go through. I'm still here — try saying it again.");
      updatePhase("listening");
    }
  };

  const start = () => {
    if (!supported) {
      setTextMode(true);
      return;
    }
    setError(null);
<<<<<<< Updated upstream
=======
    activeRef.current = true;
    busyRef.current = false;
    pendingTranscriptRef.current = "";
    setActive(true);
>>>>>>> Stashed changes
    updatePhase("listening");
    
    // Prime speech synthesis to avoid blocking on mobile
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    
    startRecognition();
  };

  const stop = () => {
<<<<<<< Updated upstream
    stopRecognition();
=======
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
    stopWakeRecognition();
    pendingTranscriptRef.current = "";
>>>>>>> Stashed changes
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    setPartial("");
    setError(null);
    updatePhase("idle");
  };

  const interrupt = () => {
    if (phaseRef.current !== "speaking") return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    updatePhase("listening");
    startRecognition();
  };

  useEffect(() => {
    return () => {
<<<<<<< Updated upstream
      stopRecognition();
=======
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
      stopWakeRecognition();
>>>>>>> Stashed changes
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
    updatePhase("thinking");
    
    try {
      const reply = await onSendTurn(content);
      if (supported && phaseRef.current === "thinking") {
        await speak(reply);
      } else {
        updatePhase("idle");
      }
    } catch (sendError) {
      console.error("Text turn failed", sendError);
      setError("That message didn't go through. Please try again.");
      updatePhase("idle");
    }
  };

  const statusLine = (() => {
    switch (phase) {
      case "listening":
        if (partial) return partial;
<<<<<<< Updated upstream
        if (keyword && keyword.trim()) return keywordDetected ? `Keyword "${keyword}" detected - speak now.` : `Listening... say "${keyword}" to talk to ${companionName}.`;
        return "Listening… speak naturally.";
=======
        return wakeWordEnabled
          ? `Listening… say "${wakeWord || "over"}" when you're done talking.`
          : "Listening… speak naturally.";
>>>>>>> Stashed changes
      case "thinking":
        return `${companionName} is thinking…`;
      case "speaking":
        return `${companionName} is speaking…`;
      default:
        return "Tap the microphone to start talking.";
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
        {phase !== "idle" && phase !== "thinking" && (
          <>
            <div className="absolute inset-0 bg-primary/20 rounded-full scale-[2] animate-pulse pointer-events-none" />
            <div
              className="absolute inset-0 bg-primary/30 rounded-full scale-[1.5] animate-ping pointer-events-none"
              style={{ animationDuration: "3s" }}
            />
          </>
        )}
        <button
          onClick={() => (phase !== "idle" ? stop() : start())}
          aria-label={phase !== "idle" ? "End conversation" : "Start conversation"}
          className={cn(
            "relative z-10 flex items-center justify-center h-24 w-24 rounded-full transition-all duration-300 shadow-lg",
            phase !== "idle"
              ? "bg-destructive text-destructive-foreground scale-110"
              : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
          )}
        >
          {phase !== "idle" ? <Square className="h-8 w-8 fill-current" /> : <Mic className="h-10 w-10" />}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 text-center min-h-10">
        <span className={cn("text-sm font-medium", phase !== "idle" ? "text-primary" : "text-muted-foreground")}>
          {phase !== "idle" ? "Tap to end conversation" : "Tap to start conversation"}
        </span>
        {phase === "speaking" && (
          <Button variant="outline" size="sm" className="gap-1.5 mt-1" onClick={interrupt}>
            <Mic className="h-3.5 w-3.5" /> Cut in
          </Button>
        )}
        {error && <span className="max-w-sm text-xs text-destructive">{error}</span>}
      </div>

      {phase === "idle" && (
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
