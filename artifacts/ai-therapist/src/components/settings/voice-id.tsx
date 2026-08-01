import { useState } from "react";
import {
  useGetVoiceAuthStatus,
  useCreateVoiceAuthChallenge,
  useEnrollVoiceAuth,
  useRemoveVoiceAuth,
  getGetVoiceAuthStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, ShieldCheck, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { startVoiceAuthRecording, type VoiceAuthRecorder } from "@/lib/voice-auth-capture";

const SAMPLES_NEEDED = 2;

export function VoiceIdSection() {
  const { data: status } = useGetVoiceAuthStatus();
  const removeVoiceAuth = useRemoveVoiceAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const enrolled = Boolean(status?.enrolled);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetVoiceAuthStatusQueryKey() });

  const handleRemove = async () => {
    try {
      await removeVoiceAuth.mutateAsync();
      invalidate();
      toast({ title: "Voice ID removed" });
    } catch {
      toast({ title: "Couldn't remove Voice ID", variant: "destructive" });
    }
  };

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">Voice ID</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            An alternative to the History PIN -- read a short number sequence aloud to unlock History
            instead of typing a PIN. Not available on phone calls, web app only.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={enrolled ? "text-primary" : "text-muted-foreground"}>
            {enrolled ? <ShieldCheck className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {enrolled ? "Voice ID is set up" : "Voice ID not set up"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enrolled ? "You can unlock History by speaking instead of typing your PIN." : "Enroll your voice to unlock History hands-free."}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(true)}>
            {enrolled ? "Re-enroll" : "Set up"}
          </Button>
          {enrolled && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removeVoiceAuth.isPending}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <EnrollVoiceIdDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} onEnrolled={invalidate} />
    </section>
  );
}

type SampleState = "idle" | "recording" | "captured";

function EnrollVoiceIdDialog({
  open,
  onOpenChange,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrolled: () => void;
}) {
  const createChallenge = useCreateVoiceAuthChallenge();
  const enrollVoiceAuth = useEnrollVoiceAuth();
  const { toast } = useToast();

  const [phrase, setPhrase] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sampleState, setSampleState] = useState<SampleState>("idle");
  const [samples, setSamples] = useState<{ audioBase64: string; mimeType: string; challengeId: string }[]>([]);
  const [recorder, setRecorder] = useState<VoiceAuthRecorder | null>(null);

  const reset = () => {
    setPhrase(null);
    setChallengeId(null);
    setSampleState("idle");
    setSamples([]);
    setRecorder(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const requestNewChallenge = async () => {
    try {
      const result = await createChallenge.mutateAsync();
      setPhrase(result.phrase);
      setChallengeId(result.challengeId);
      setSampleState("idle");
    } catch {
      toast({ title: "Couldn't get a challenge phrase", variant: "destructive" });
    }
  };

  const handleStart = async () => {
    if (!challengeId) {
      await requestNewChallenge();
      return;
    }
    try {
      const rec = await startVoiceAuthRecording();
      setRecorder(rec);
      setSampleState("recording");
    } catch {
      toast({ title: "Microphone access denied", description: "Allow microphone access to continue.", variant: "destructive" });
    }
  };

  const handleStop = async () => {
    if (!recorder || !challengeId) return;
    try {
      const { audioBase64, mimeType } = await recorder.stop();
      setSamples((prev) => [...prev, { audioBase64, mimeType, challengeId }]);
      setSampleState("captured");
      setRecorder(null);
    } catch {
      toast({ title: "Recording failed", variant: "destructive" });
      setSampleState("idle");
    }
  };

  const handleNextOrFinish = async () => {
    if (samples.length < SAMPLES_NEEDED) {
      await requestNewChallenge();
      return;
    }
    try {
      const result = await enrollVoiceAuth.mutateAsync({ data: { samples } });
      toast({ title: "Voice ID enrolled", description: `${result.sampleCount} sample(s) saved.` });
      onEnrolled();
      handleOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't enroll Voice ID",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up Voice ID</DialogTitle>
          <DialogDescription>
            Read the number sequence aloud, clearly, in a quiet room. You'll do this {SAMPLES_NEEDED} times
            to build a reliable voiceprint ({samples.length}/{SAMPLES_NEEDED} done).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!phrase ? (
            <Button onClick={requestNewChallenge} disabled={createChallenge.isPending} className="w-full">
              {createChallenge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get a phrase to read"}
            </Button>
          ) : (
            <>
              <div className="bg-muted rounded-xl p-6 text-center">
                <p className="text-xs text-muted-foreground mb-2">Read this aloud</p>
                <p className="text-3xl font-mono tracking-widest text-foreground">{phrase}</p>
              </div>

              {sampleState === "idle" && (
                <Button onClick={handleStart} className="w-full gap-2">
                  <Mic className="h-4 w-4" /> Start recording
                </Button>
              )}
              {sampleState === "recording" && (
                <Button onClick={handleStop} variant="destructive" className="w-full gap-2">
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
              {sampleState === "captured" && (
                <Button onClick={handleNextOrFinish} className="w-full" disabled={enrollVoiceAuth.isPending}>
                  {enrollVoiceAuth.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : samples.length < SAMPLES_NEEDED ? (
                    "Sounds good, next phrase"
                  ) : (
                    "Finish enrollment"
                  )}
                </Button>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
