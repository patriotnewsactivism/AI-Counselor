import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetConversation,
  useListMessages,
  useSendMessage,
  useCreateConversation,
  useGetProfile,
} from "@workspace/api-client-react";
import { LiveConversation } from "@/components/companion/live-conversation";
import { VoiceStreamRecorder, type VoiceStreamRecorderHandle, type StreamTurnState } from "@/components/companion/voice-stream-recorder";
import { useAuth } from "@clerk/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, User, Mic, Square, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { usePWAInstall } from "@/hooks/use-pwa-install";

/** wss://<api host> derived from the same VITE_API_URL the rest of the app
 * uses for HTTP calls (see main.tsx). Empty in local dev, where Vite proxies
 * same-origin — the Grok streaming pipeline isn't available in that case
 * since there's no separate API origin to build a WS URL from. Falls back
 * to the Web Speech API LiveConversation instead. */
function deriveWsBaseUrl(): string | null {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) return null;
  try {
    const url = new URL(apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  } catch {
    return null;
  }
}

export default function CompanionPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const streamRecorderRef = useRef<VoiceStreamRecorderHandle>(null);
  const { getToken } = useAuth();
  const wsBaseUrl = deriveWsBaseUrl();
  const [streamState, setStreamState] = useState<StreamTurnState>("idle");
  const [streamTranscript, setStreamTranscript] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const { canInstall, promptInstall } = usePWAInstall();

  const isNew = !id;
  const conversationId = isNew ? null : parseInt(id, 10);

  const { data: profile } = useGetProfile();
  const { data: conversation, isLoading: isLoadingConv } = useGetConversation(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId || 0) },
  });
  const { data: messages = [] } = useListMessages(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getListMessagesQueryKey(conversationId || 0) },
  });

  const createConv = useCreateConversation();
  const sendText = useSendMessage();

  const companionName = profile?.companionName || "Aura";
  const userName = profile?.preferredName || "You";
  const wakeWord = (profile?.wakeWord?.trim() || "over").trim();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Keep the ref in sync with the URL param so ensureConversation() returns
  // the existing conversation id instead of creating a new one on first turn.
  useEffect(() => {
    conversationIdRef.current = conversationId ?? null;
  }, [conversationId]);

  // Guards against a race where two turns are sent back-to-back before the
  // URL has re-rendered with the newly created conversation's id: without
  // this, ensureConversation() would see conversationId still null on the
  // second call and spin up a SECOND brand-new conversation, causing the
  // companion to "forget" everything and re-greet mid-session.
  const pendingConversationId = useRef<Promise<number> | null>(null);

  const ensureConversation = async () => {
    if (conversationIdRef.current) return conversationIdRef.current;
    if (pendingConversationId.current) return pendingConversationId.current;

    const creation = (async () => {
      const newConv = await createConv.mutateAsync({ data: { title: "New Conversation" } });
      conversationIdRef.current = newConv.id;
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setLocation(`/companion/${newConv.id}`);
      return newConv.id;
    })();

    pendingConversationId.current = creation;
    try {
      return await creation;
    } finally {
      pendingConversationId.current = null;
    }
  };

  /** Sends one conversational turn and returns the companion's reply text so
   *  the live voice loop can speak it. Drives the header/typing indicator. */
  const sendConversationTurn = async (content: string): Promise<string> => {
    setIsProcessing(true);
    try {
      const targetId = await ensureConversation();
      const response = await sendText.mutateAsync({ id: targetId, data: { content } });
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetId) });
      return response.assistantMessage.content;
    } catch (error) {
      console.error("Failed to send message", error);
      toast({ title: "I couldn't send that message", description: "Please try again.", variant: "destructive" });
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const startGrokStream = async () => {
    if (!wsBaseUrl) return;
    setStreamError(null);
    setIsProcessing(true);
    try {
      const targetId = await ensureConversation();
      setIsProcessing(false);
      if (targetId == null) throw new Error("No conversation id");
      await streamRecorderRef.current?.start(targetId);
    } catch (error) {
      console.error("Failed to start voice stream", error);
      toast({ title: "Couldn't start the voice stream", description: "Please try again.", variant: "destructive" });
      setIsProcessing(false);
    }
  };

  const stopGrokStream = () => {
    streamRecorderRef.current?.stop();
    setStreamTranscript("");
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

  const grokAvailable = !!wsBaseUrl;

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="p-4 border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex items-center gap-4 shrink-0">
        <Avatar className="h-10 w-10 border-2 border-primary/20">
          <AvatarFallback className="bg-primary/10 text-primary font-serif">{companionName[0]}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h2 className="font-serif text-lg font-medium leading-none text-foreground">{companionName}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isProcessing ? "Thinking…" : streamState === "listening" ? "Listening…" : streamState === "speaking" ? "Speaking…" : "Ready when you are"}
          </p>
        </div>
        {canInstall && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => void promptInstall()}
          >
            <Download className="h-4 w-4" /> Install
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1 p-4 md:p-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-8">
          {isNew || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4 opacity-80">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4"><span className="font-serif text-3xl text-primary">{companionName[0]}</span></div>
              <h3 className="font-serif text-2xl text-foreground">Good evening, {userName}</h3>
              <p className="text-muted-foreground max-w-md">
                I'm here to listen. Tap the button below and just talk — say <span className="font-medium text-foreground">"{wakeWord}"</span> when you're done, and I'll respond. Say it again while I'm talking to cut me off.
              </p>
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
        {grokAvailable ? (
          <div className="flex flex-col items-center gap-3">
            {streamTranscript && (
              <p className="text-sm text-muted-foreground text-center max-w-md">{streamTranscript}</p>
            )}
            <div className="relative">
              {streamState !== "idle" && streamState !== "error" && (
                <>
                  <div className="absolute inset-0 bg-primary/20 rounded-full scale-[2] animate-pulse pointer-events-none" />
                  <div
                    className="absolute inset-0 bg-primary/30 rounded-full scale-[1.5] animate-ping pointer-events-none"
                    style={{ animationDuration: "1.5s" }}
                  />
                </>
              )}
              <button
                onClick={() => {
                  if (streamState === "idle" || streamState === "error") {
                    void startGrokStream();
                  } else {
                    stopGrokStream();
                  }
                }}
                aria-label={streamState !== "idle" && streamState !== "error" ? "End conversation" : "Start conversation"}
                className={cn(
                  "relative z-10 flex items-center justify-center h-24 w-24 rounded-full transition-all duration-300 shadow-lg",
                  streamState !== "idle" && streamState !== "error"
                    ? "bg-destructive text-destructive-foreground scale-110"
                    : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
                )}
              >
                {streamState === "connecting" ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : streamState !== "idle" && streamState !== "error" ? (
                  <Square className="h-8 w-8 fill-current" />
                ) : (
                  <Mic className="h-10 w-10" />
                )}
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 text-center min-h-10">
              <span className={cn("text-sm font-medium", streamState !== "idle" ? "text-primary" : "text-muted-foreground")}>
                {streamState === "listening"
                  ? `Listening… say "${wakeWord}" when you're done`
                  : streamState === "speaking"
                    ? `${companionName} is speaking…`
                    : streamState === "connecting"
                      ? "Connecting…"
                      : streamState === "error"
                        ? "Something went wrong — tap to retry"
                        : "Tap to start talking"}
              </span>
              {streamError && <span className="max-w-sm text-xs text-destructive">{streamError}</span>}
            </div>
            <VoiceStreamRecorder
              ref={streamRecorderRef}
              wsBaseUrl={wsBaseUrl}
              getToken={getToken}
              onTurnStateChange={setStreamState}
              onTranscript={(text, isFinal) => setStreamTranscript(isFinal ? "" : text)}
              onAssistantSentence={() => setStreamTranscript("")}
              onAssistantDone={() => {
                if (conversationId) queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
              }}
              onError={(message) => {
                setStreamError(message);
                toast({ title: "Voice stream error", description: message, variant: "destructive" });
              }}
            />
          </div>
        ) : (
          <LiveConversation
            onSendTurn={sendConversationTurn}
            companionName={companionName}
            wakeWord={wakeWord}
          />
        )}
      </div>
    </div>
  );
}
