import { useEffect, useRef, useState } from "react";
import { useGetProfile, useUpdateProfile, getGetProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Ear, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Account-wide (not per-browser) turn-taking preference — the same
 * "wait for a keyword instead of ending the turn on silence" behavior
 * live-conversation.tsx already offers per-browser via localStorage, but
 * persisted to the profile so the phone line (mcpBridge.ts's verify_caller)
 * can read it too. Deliberately a separate setting from the browser-only
 * toggle rather than replacing it, to avoid touching that already-working
 * code under time pressure.
 */
export function CallPreferencesSection() {
  const { data: profile, isLoading } = useGetProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeWord, setWakeWord] = useState("over");
  const initialized = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (profile && !initialized.current) {
      setWakeWordEnabled(profile.wakeWordEnabled);
      setWakeWord(profile.wakeWord || "over");
      initialized.current = true;
    }
  }, [profile]);

  const save = (next: { wakeWordEnabled: boolean; wakeWord: string }) => {
    updateProfile.mutate(
      { data: next },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() }),
        onError: () => toast({ title: "Couldn't save call preferences", variant: "destructive" }),
      },
    );
  };

  const handleToggle = (checked: boolean) => {
    setWakeWordEnabled(checked);
    save({ wakeWordEnabled: checked, wakeWord });
  };

  const handleWordChange = (value: string) => {
    setWakeWord(value);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      save({ wakeWordEnabled, wakeWord: value.trim() || "over" });
    }, 600);
  };

  if (isLoading) return null;

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">Call Preferences</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            Applies to the phone line, and is the account-wide default for browser voice conversations too.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
          <div className="flex items-center gap-3">
            <Ear className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Wait for a sign-off word before responding</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Keeps listening through pauses instead of replying on the first silence.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            className="accent-primary h-4 w-4 shrink-0"
            checked={wakeWordEnabled}
            onChange={(event) => handleToggle(event.target.checked)}
            disabled={updateProfile.isPending}
          />
        </label>
        {wakeWordEnabled && (
          <div className="space-y-2 pl-8">
            <Label htmlFor="call-keyword">Sign-off word</Label>
            <Input
              id="call-keyword"
              value={wakeWord}
              onChange={(event) => handleWordChange(event.target.value)}
              placeholder="over"
              maxLength={32}
              className="max-w-xs bg-background"
            />
          </div>
        )}
        {updateProfile.isPending && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </div>
        )}
      </div>
    </section>
  );
}
