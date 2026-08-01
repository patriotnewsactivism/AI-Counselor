import { useState } from "react";
import { useGetVoiceAuthStatus, useCreateVoiceAuthChallenge, useVerifyVoiceAuth } from "@workspace/api-client-react";
import { Mic, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { startVoiceAuthRecording, type VoiceAuthRecorder } from "@/lib/voice-auth-capture";

/**
 * Alternative unlock path for the History gate (routes/history.ts's PIN
 * flow) -- shown only when the account has Voice ID enrolled. On a
 * successful match, calls onUnlocked with the same {token, expiresAt} shape
 * useUnlockHistory returns, since the backend issues the identical
 * HistoryTokenResponse for both paths.
 */
export function VoiceIdUnlock({ onUnlocked }: { onUnlocked: (token: string, expiresAt: string) => void }) {
  const { data: status } = useGetVoiceAuthStatus();
  const createChallenge = useCreateVoiceAuthChallenge();
  const verifyVoiceAuth = useVerifyVoiceAuth();
  const { toast } = useToast();

  const [phrase, setPhrase] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<VoiceAuthRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  if (!status?.enrolled) return null;

  const handleStart = async () => {
    try {
      const challenge = await createChallenge.mutateAsync();
      setPhrase(challenge.phrase);
      setChallengeId(challenge.challengeId);
      const rec = await startVoiceAuthRecording();
      setRecorder(rec);
      setIsRecording(true);
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  };

  const handleStop = async () => {
    if (!recorder || !challengeId) return;
    setIsRecording(false);
    try {
      const { audioBase64, mimeType } = await recorder.stop();
      const result = await verifyVoiceAuth.mutateAsync({ data: { audioBase64, mimeType, challengeId } });
      onUnlocked(result.token, result.expiresAt);
    } catch (err) {
      toast({
        title: "Voice didn't match",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRecorder(null);
      setPhrase(null);
      setChallengeId(null);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-border/50 flex flex-col items-center gap-3">
      <p className="text-xs text-muted-foreground">or unlock with your voice</p>
      {phrase && (
        <p className="text-2xl font-mono tracking-widest text-foreground">{phrase}</p>
      )}
      {!isRecording ? (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleStart} disabled={createChallenge.isPending}>
          {createChallenge.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Unlock with Voice ID
        </Button>
      ) : (
        <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleStop} disabled={verifyVoiceAuth.isPending}>
          {verifyVoiceAuth.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          {verifyVoiceAuth.isPending ? "Checking..." : "Stop & verify"}
        </Button>
      )}
    </div>
  );
}
