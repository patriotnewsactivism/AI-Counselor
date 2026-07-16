import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetConversation,
  useListMessages,
  useSendMessage,
  useSendVoiceMessage,
  useCreateConversation,
  useGetProfile
} from "@workspace/api-client-react";
import { VoiceRecorder, type VoiceRecorderHandle } from "@/components/companion/voice-recorder";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Loader2, User, Mic, Repeat } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey, getListConversationsQueryKey, getGetConversationQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// Local storage key for the turn-based "keep listening" toggle.
const CONTINUOUS_MODE_KEY = "ai-therapist:continuousMode";

// Small pause after the companion finishes speaking before we re-arm the
// mic, so the tail of its own TTS audio isn't picked up as the next input.
// This turn-based approach (speak -> reply -> auto re-listen, never both
// directions open at once) is the intentional seam for a future "live"
// duplex mode: swap this effect + VoiceRecorderHandle for a persistent
// WebRTC/streaming channel without touching the rest of the page.
const RE_ARM_DELAY_MS = 500;

export default function CompanionPage() {
  const { id } = useParams<{ id?: string }>();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const recorderRef = useRef<VoiceRecorderHandle>(null);

  const [continuousMode, setContinuousMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(CONTINUOUS_MODE_KEY);
    return stored === null ? true : stored === "true";
  });

  const isNew = !id;
  const conversationId = isNew ? null : parseInt(id, 10);

  const { data: profile } = useGetProfile();
  const { data: conversation, isLoading: isLoadingConv } = useGetConversation(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId || 0) }
  });
  const { data: messages = [], isLoading: isLoadingMessages } = useListMessages(conversationId || 0, {
    query: { enabled: !!conversationId, queryKey: getListMessagesQueryKey(conversationId || 0) }
  });

  const createConv = useCreateConversation();
  const sendText = useSendMessage();
  const sendVoice = useSendVoiceMessage();

  const companionName = profile?.companionName || "Aura";
  const userName = profile?.preferredName || "You";

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isProcessing]);

  useEffect(() => {
    window.localStorage.setItem(CONTINUOUS_MODE_KEY, String(continuousMode));
  }, [continuousMode]);

  // Handle audio playback end — this is where turn-based "keep talking"
  // actually happens: once the companion's reply finishes playing, and the
  // user has continuous mode on, we re-arm the mic automatically instead of
  // making them tap it again. Voice input and TTS playback never overlap.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      if (continuousMode && !isProcessing) {
        window.setTimeout(() => {
          recorderRef.current?.startRecording();
        }, RE_ARM_DELAY_MS);
      }
    };

    audio.onended = handleEnded;
    audio.onpause = () => setIsPlaying(false);
    audio.onplay = () => setIsPlaying(true);
  }, [audioUrl, continuousMode, isProcessing]);

  const playAudio = (url: string) => {
    if (audioRef.current) {
      if (isPlaying && audioRef.current.src === url) {
        audioRef.current.pause();
      } else {
        audioRef.current.src = url;
        audioRef.current.play().catch(e => console.error("Audio play failed", e));
      }
    } else {
      setAudioUrl(url);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play().catch(e => console.error("Audio play failed", e));
        }
      }, 50);
    }
  };

  const handleSendText = async (content: string) => {
    setIsProcessing(true);
    try {
      let targetId = conversationId;

      if (!targetId) {
        // Create new conversation first
        const newConv = await createConv.mutateAsync({ data: { title: "New Conversation" } });
        targetId = newConv.id;
        // Invalidate conversation list immediately
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        // Update URL without full reload
        setLocation(`/companion/${targetId}`);
      }

      await sendText.mutateAsync({ id: targetId, data: { content } });

      // Refresh messages
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetId) });
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendVoice = async (audioBase64: string, mimeType: string) => {
    setIsProcessing(true);
    try {
      let targetId = conversationId;

      if (!targetId) {
        const newConv = await createConv.mutateAsync({ data: { title: "New Conversation" } });
        targetId = newConv.id;
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        setLocation(`/companion/${targetId}`);
      }

      const response = await sendVoice.mutateAsync({
        id: targetId,
        data: { audioBase64, mimeType }
      });

      if (response.autoEnrolled && response.speakerName) {
        toast({
          title: "New voice recognized",
          description: `I've learned ${response.speakerName}'s voice — I'll recognise them next time.`,
        });
      }

      // Play returned audio
      if (response.audioBase64 && response.audioMimeType) {
        const url = `data:${response.audioMimeType};base64,${response.audioBase64}`;
        setAudioUrl(url);
        // Play automatically
        setTimeout(() => {
          if (audioRef.current) audioRef.current.play().catch(e => console.log(e));
        }, 100);
      }

      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(targetId) });
    } catch (err) {
      console.error("Failed to send voice message", err);
    } finally {
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
      {/* Hidden audio element for playback */}
      <audio ref={audioRef} className="hidden" />

      {/* Header */}
      <header className="p-4 border-b border-border/50 bg-background/50 backdrop-blur-sm sticky top-0 z-10 flex items-center gap-4 shrink-0">
        <Avatar className="h-10 w-10 border-2 border-primary/20">
          <AvatarFallback className="bg-primary/10 text-primary font-serif">{companionName[0]}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h2 className="font-serif text-lg font-medium leading-none text-foreground">{companionName}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isProcessing ? "Listening..." : "Listening"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
          <Label htmlFor="continuous-mode" className="text-xs text-muted-foreground cursor-pointer hidden sm:inline">
            Keep talking
          </Label>
          <Switch
            id="continuous-mode"
            checked={continuousMode}
            onCheckedChange={setContinuousMode}
            aria-label="Automatically listen again after each reply"
          />
        </div>
      </header>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 md:p-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-8">
          {isNew || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4 opacity-80">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <span className="font-serif text-3xl text-primary">{companionName[0]}</span>
              </div>
              <h3 className="font-serif text-2xl text-foreground">Good evening, {userName}</h3>
              <p className="text-muted-foreground max-w-md">
                I'm here to listen. Take a deep breath, and whenever you're ready, tap the microphone to share what's on your mind today.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div key={msg.id} className={cn("flex w-full gap-4", isUser ? "justify-end" : "justify-start")}>
                  {!isUser && (
                    <Avatar className="h-8 w-8 border border-border mt-1 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-serif">{companionName[0]}</AvatarFallback>
                    </Avatar>
                  )}

                  <div className={cn(
                    "relative px-5 py-3.5 max-w-[85%] md:max-w-[75%]",
                    isUser
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm"
                      : "bg-card border border-border text-card-foreground rounded-2xl rounded-tl-sm shadow-sm"
                  )}>
                    <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>

                  {isUser && (
                    <div className="flex flex-col items-end gap-1 mt-1 shrink-0">
                      <Avatar className="h-8 w-8 bg-transparent">
                        <AvatarFallback className="bg-muted text-muted-foreground">
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      {msg.speakerName && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded-full shrink-0">
                          <Mic className="h-3 w-3" />
                          <span>{msg.speakerName}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isProcessing && (
            <div className="flex w-full gap-4 justify-start">
              <Avatar className="h-8 w-8 border border-border mt-1 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-serif">{companionName[0]}</AvatarFallback>
              </Avatar>
              <div className="px-5 py-4 bg-card border border-border rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="h-4" />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent shrink-0 border-t border-border/10">
        <VoiceRecorder
          ref={recorderRef}
          onSendAudio={handleSendVoice}
          onSendText={handleSendText}
          isProcessing={isProcessing}
        />
      </div>
    </div>
  );
}
