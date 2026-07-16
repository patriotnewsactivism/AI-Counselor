import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Mic, Square, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface VoiceRecorderHandle {
  /** Called by companion.tsx to re-arm the mic after a reply finishes.
   *  This is the swap-seam: a future "live" mode would replace this
   *  startRecording/stopRecording pair with a WebRTC streaming channel. */
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

interface VoiceRecorderProps {
  onSendAudio: (base64: string, mimeType: string) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
  isProcessing: boolean;
}

export const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(
  function VoiceRecorder({ onSendAudio, onSendText, isProcessing }, ref) {
  const [isRecording, setIsRecording] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState("");
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          const base64 = base64data.split(",")[1];
          onSendAudio(base64, blob.type);
        };
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please check permissions or use text mode.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  useImperativeHandle(ref, () => ({ startRecording, stopRecording }));

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isProcessing) return;
    onSendText(text.trim());
    setText("");
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-4">
      {textMode ? (
        <form onSubmit={handleTextSubmit} className="w-full flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 min-h-[60px] max-h-[200px] resize-y bg-card border border-input rounded-2xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleTextSubmit(e);
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
              {isProcessing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5 ml-1" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs h-8 text-muted-foreground hover:text-foreground"
              onClick={() => setTextMode(false)}
            >
              Voice
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-6 w-full">
          <div className="relative">
            {isRecording && (
              <>
                <div className="absolute inset-0 bg-primary/20 rounded-full scale-[2] animate-pulse pointer-events-none" />
                <div
                  className="absolute inset-0 bg-primary/30 rounded-full scale-[1.5] animate-ping pointer-events-none"
                  style={{ animationDuration: "3s" }}
                />
              </>
            )}

            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              className={cn(
                "relative z-10 flex items-center justify-center h-24 w-24 rounded-full transition-all duration-300 shadow-lg",
                isRecording
                  ? "bg-destructive text-destructive-foreground scale-110"
                  : isProcessing
                  ? "bg-card border-2 border-border text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl"
              )}
            >
              {isProcessing ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : isRecording ? (
                <Square className="h-8 w-8 fill-current" />
              ) : (
                <Mic className="h-10 w-10" />
              )}
            </button>
          </div>

          <div className="flex flex-col items-center h-8">
            {isRecording ? (
              <span className="font-mono text-xl text-primary font-medium tracking-widest animate-pulse">
                {formatTime(recordingDuration)}
              </span>
            ) : isProcessing ? (
              <span className="text-muted-foreground text-sm font-medium animate-pulse">
                Listening & responding...
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">Tap to speak</span>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground mt-[-8px]"
            onClick={() => setTextMode(true)}
            disabled={isRecording || isProcessing}
          >
            Or type a message
          </Button>
        </div>
      )}
    </div>
  );
});
