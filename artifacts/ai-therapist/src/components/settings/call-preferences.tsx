import { useEffect, useRef, useState } from "react";
import { useGetProfile, useUpdateProfile, getGetProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Ear, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Account-wide sign-off word preference. The companion always waits for
 * this word before responding — this setting just controls *which* word.
 * Applies to both the browser app and the phone line.
 */
export function CallPreferencesSection() {
  const { data: profile, isLoading } = useGetProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [wakeWord, setWakeWord] = useState("over");
  const initialized = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (profile && !initialized.current) {
      setWakeWord(profile.wakeWord || "over");
      initialized.current = true;
    }
  }, [profile]);

  const save = (word: string) => {
    updateProfile.mutate(
      { data: { wakeWord: word } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() }),
        onError: () => toast({ title: "Couldn't save call preferences", variant: "destructive" }),
      },
    );
  };

  const handleWordChange = (value: string) => {
    setWakeWord(value);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      save(value.trim() || "over");
    }, 600);
  };

  if (isLoading) return null;

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">Sign-off Word</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            The companion always waits for this word before responding — on the phone and in the browser.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <Ear className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Sign-off word</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Like radio protocol: keep talking through pauses — the companion only replies once you end with this word.
            </p>
          </div>
        </div>
        <div className="space-y-2 pl-8">
          <Label htmlFor="call-keyword">Word</Label>
          <Input
            id="call-keyword"
            value={wakeWord}
            onChange={(event) => handleWordChange(event.target.value)}
            placeholder="over"
            maxLength={32}
            className="max-w-xs bg-background"
          />
        </div>
        {updateProfile.isPending && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </div>
        )}
      </div>
    </section>
  );
}
