import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetConversation,
  useListMessages,
  useSendMessage,
  useSendVoiceMessage,
  useCreateConversation,
  useGetProfile,
} from "@workspace/api-client-react";
import { VoiceRecorder, type LiveListenMode, type VoiceRecorderHandle } from "@/components/companion/voice-recorder";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, User, Mic, Square, Pause, Play } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const LIVE_MODE_KEY = "ai-therapist:liveListenMode";
const WAKE_WORD_KEY = "ai-therapist:wakeWord";
const RESTART_LISTEN_DELAY_MS = 450;

type VoiceFailureKind = "no-speech" | "rate-limit" | "auth" | "server" | "unknown";

type ErrorLike = {
  message?: unknown;
  status?: unknown;
  data?: unknown;
};

function getVoiceFailure(error: unknown): { kind: VoiceFailureKind; message: string } {
  const value = error && typeof error === "object" ? error as ErrorLike : null;
  const data = value?.data && typeof value.data === "object" ? value.data as Record<string, unknown> : null;
  const status = typeof value?.status === "number" ? value.status : null;
  const messageParts = [
    typeof value?.message === "string" ? value.message : null,
    typeof data?.error === "string" ? data.error : null,
    typeof data?.message === "string" ? data.message : null,
    typeof data?.detail === "string" ? data.detail : null,
  ].filter((part): part is string => Boolean(part));
  const message = messageParts.join(" — ") || "Voice request failed";
  const normalized = message.toLocaleLowerCase();

  if (
    normalized.includes("no speech") ||
    normalized.includes("could not understand the audio") ||
    normalized.includes("empty transcript")
  ) {
    return { kind: "no-speech", message };
  }
  if (
    status === 429 ||
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("daily token") ||
    normalized.includes("tokens per day") ||
    normalized.includes("quota")
  ) {
    return { kind: "rate-limit", message };
  }
  if (
    status === 401 ||
    status === 403 ||
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication") ||
    normalized.includes("sign in")
  ) {
    return { kind: "auth", message };
  }
  if (status !== null && status >= 500) return { kind: "server", message };
  return { kind: "unknown", message };
}

function readableVoiceFailure(message: string): string {
  return message
    .replace(/^HTTP \d+[^:]*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export default function CompanionPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const recorderRef = useRef<VoiceRecorderHandle>(null);
  const liveSessionRef = useRef(false);

  const [listenMode, setListenMode] = useState<LiveListenMode>(() => {
    if (typeof window === "undefined") return "always";
    return window.localStorage.getItem(LIVE_MODE_KEY) === "wake" ? "wake" : "always";
  });
  const [wakeWord, setWakeWord] = useState(() => {
    if (typeof window === "undefined") return "Aura";
    return window.localStorage.getItem(WAKE_WORD_KEY) || "Aura";
  });

  const isNew = !id;
  const conversationId = isNew ? null : parseInt(id, 10);

  const { data: profile } = useGetProfile();
  const { data: conversation, isLoading: isLoadingConv } = useGetConversation(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId || 0) },
  });
  const { data: messages = [], isLoading: isLoadingMessages } = useListMessages(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getListMessagesQueryKey(conversationId || 0) },
  });

  const createConv = useCreateConversation();
  const sendText = useSendMessage();
  const sendVoice = useSendVoiceMessage();

  const companionName = profile?.companionName || "Aura";
  const userName = profile?.preferredName || "You";

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  useEffect(() => {
    window.localStorage.setItem(LIVE_MODE_KEY, listenMode);
  }, [listenMode]);

  useEffect(() => {
    const normalized = wakeWord.trim().replace(/\s+/g, " ").slice(0, 32);
    window.localStorage.setItem(WAKE_WORD_KEY, normalized || "Aura");
  }, [wakeWord]);

  // The recorder owns the microphone. This audio element is deliberately kept
  // separate so Aura never transcribes its own spoken response as a new turn.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      if (liveSessionRef.current) {
        window.setTimeout(() => recorderRef.current?.resumeListening(), RESTART_LISTEN_DELAY_MS);
      }
    };

    audio.onended = handleEnded;
    audio.onerror = resumeAfterPlaybackFailure;
    audio.onpause = () => setIsPlaying(false);
    audio.onplay = () => setIsPlaying(true);
    return () => {
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.onplay = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      liveSessionRef.current = false;
      recorderRef.current?.stopRecording();
    };
  }, []);

  const resumeAfterPlaybackFailure = () => {
    setIsPlaying(false);
    if (liveSessionRef.current) {
      window.setTimeout(() => recorderRef.current?.resumeListening(), RESTART_LISTEN_DELAY_MS);
    }
  };

  const playAudio = (url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = url;
    void audio.play().catch((error) => {
      console.error("Audio play failed", error);
      resumeAfterPlaybackFailure();
    });
  };

  const handleInterruptAura = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
    setIsPausedByUser(false);
    recorderRef.current?.resumeListening();
  };

  const handlePauseAura = () => {
    audioRef.current?.pause();
    setIsPausedByUser(true);
  };

  const handleResumeAura = () => {
    const audio = audioRef.current;
    if (audio) {
      void audio.play().catch((error) => {
        console.error("Resume playback failed", error);
      });
    }
    setIsPausedByUser(false);
  };

  const ensureConversation = async () => {
    let targetId = conversationId;
    if (!targetId) {
      const newConv = await createConv.mutateAsync({ data: { title: "New Conversation" } });
      targetId = newConv.id;
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setLocation(`/companion/${targetId}`);
    }
    return targetId;
  };

  const handleSendText = async (content: string) => {
    setIsProcessing(true);
    try {
      const targetId = await ensureConversation();
      await sendText.mutateAsync({ id: targetId, data: { content } });
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetId) });
    } catch (error) {
      console.error("Failed to send message", error);
      toast({ title: "I couldn't send that message", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendVoice = async (audioBase64: string, mimeType: string) => {
    setIsProcessing(true);
    try {
      const targetId = await ensureConversation();
      const response = await sendVoice.mutateAsync({
        id: targetId,
        data: { audioBase64, mimeType },
      });

      if (response.autoEnrolled && response.speakerName) {
        toast({
          title: "New voice recognized",
          description: `I've learned ${response.speakerName}'s voice — I'll recognise them next time.`,
        });
      }

      if (response.audioBase64 && response.audioMimeType) {
        const url = `data:${response.audioMimeType};base64,${response.audioBase64}`;
        setAudioUrl(url);
        window.setTimeout(() => playAudio(url), 100);
      }

      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetId) });
    } catch (error: unknown) {
      console.error("Failed to send voice message", error);
      const failure = getVoiceFailure(error);
      const description = readableVoiceFailure(failure.message);
      if (failure.kind === "no-speech") {
        toast({ title: "I didn’t catch a clear voice turn", description: "Keep the phone in the foreground and try speaking a little closer to the microphone." });
      } else if (failure.kind === "rate-limit") {
        toast({ title: "Aura’s free AI limit is temporarily full", description: "The voice recording arrived, but Groq’s free-tier limit is exhausted. Try again after the limit resets." , variant: "destructive" });
      } else if (failure.kind === "auth") {
        toast({ title: "Your session needs to be refreshed", description: "Sign out, sign back in, and try the live conversation again.", variant: "destructive" });
      } else {
        toast({ title: "Aura couldn’t complete that voice turn", description, variant: "destructive" });
      }
      if (liveSessionRef.current) window.setTimeout(() => recorderRef.current?.resumeListening(), RESTART_LISTEN_DELAY_MS);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSessionChange = (active: boolean) => {
    liveSessionRef.current = active;
    if (!active) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      setIsPlaying(false);
      setIsPausedByUser(false);
      setIsProcessing(false);
    }
  };

  if (isLoadingConv && !isNew) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-primary">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">Preparing space...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <audio ref={audioRef} className="hidden" />

      <header className="p-4 border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex items-center gap-4 shrink-0">
        <Avatar className="h-10 w-10 border-2 border-primary/20">
          <AvatarFallback className="bg-primary/10 text-primary font-serif">{companionName[0]}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h2 className="font-serif text-lg font-medium leading-none text-foreground">{companionName}</h2>
          <p className="text-xs text-muted-foreground mt-1">{isPlaying ? "Speaking…" : isProcessing ? "Thinking…" : "Ready when you are"}</p>
        </div>
        {isPlaying && <div className="flex items-center gap-1 text-xs text-primary"><span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> Speaking</div>}
      </header>

      {(isPlaying || isPausedByUser) && (
        <div className="px-4 py-2 border-b border-border/30 bg-background/70 backdrop-blur-sm flex items-center justify-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleInterruptAura}>
            <Square className="h-3.5 w-3.5" /> Interrupt {companionName}
          </Button>
          {isPausedByUser ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleResumeAura}>
              <Play className="h-3.5 w-3.5" /> Resume {companionName}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePauseAura}>
              <Pause className="h-3.5 w-3.5" /> Pause &amp; speak
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="flex-1 p-4 md:p-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-8">
          {isNew || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4 opacity-80">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4"><span className="font-serif text-3xl text-primary">{companionName[0]}</span></div>
              <h3 className="font-serif text-2xl text-foreground">Good evening, {userName}</h3>
              <p className="text-muted-foreground max-w-md">I’m here to listen. Start a live conversation below, set your phone down, and speak naturally. Aura will listen for each turn, respond, and listen again.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div key={msg.id} className={cn("flex w-full gap-4", isUser ? "justify-end" : "justify-start")}>
                  {!isUser && <Avatar className="h-8 w-8 border border-border mt-1 shrink-0"><AvatarFallback className="bg-primary/10 text-primary text-xs font-serif">{companionName[0]}</AvatarFallback></Avatar>}
                  <div className={cn("relative px-5 py-3.5 max-w-[85%] md:max-w-[75%]", isUser ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm" : "bg-card border border-border text-card-foreground rounded-2xl rounded-tl-sm shadow-sm")}>
                    <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{msg.content}</div>
                  </div>
                  {isUser && (
                    <div className="flex flex-col items-end gap-1 mt-1 shrink-0">
                      <Avatar className="h-8 w-8 bg-transparent"><AvatarFallback className="bg-muted text-muted-foreground"><User className="h-4 w-4" /></AvatarFallback></Avatar>
                      {msg.speakerName && <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded-full shrink-0"><Mic className="h-3 w-3" /><span>{msg.speakerName}</span></div>}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isProcessing && (
            <div className="flex w-full gap-4 justify-start">
              <Avatar className="h-8 w-8 border border-border mt-1 shrink-0"><AvatarFallback className="bg-primary/10 text-primary text-xs font-serif">{companionName[0]}</AvatarFallback></Avatar>
              <div className="px-5 py-4 bg-card border border-border rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                <div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" /><div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} /><div className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-bounce" style={{ animationDelay: "300ms" }} /></div>
              </div>
            </div>
          )}
          <div ref={scrollRef} className="h-4" />
        </div>
      </ScrollArea>

      <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent shrink-0 border-t border-border/10">
        <VoiceRecorder
          ref={recorderRef}
          onSendAudio={handleSendVoice}
          onSendText={handleSendText}
          isProcessing={isProcessing || isPlaying || isPausedByUser}
          mode={listenMode}
          wakeWord={wakeWord}
          onModeChange={setListenMode}
          onWakeWordChange={setWakeWord}
          onSessionChange={handleSessionChange}
        />
      </div>
    </div>
  );
}
