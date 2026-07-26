import { useState } from "react";
import { useGetProfile, useSetHistoryPin, useRemoveHistoryPin, getGetProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { setHistoryToken, clearHistoryToken } from "@/lib/history-access";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function HistoryPinSection() {
  const { data: profile } = useGetProfile();
  const setHistoryPin = useSetHistoryPin();
  const removeHistoryPin = useRemoveHistoryPin();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const enabled = Boolean(profile?.historyPinEnabled);

  const resetFields = () => {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  };

  const openDialog = (removing: boolean) => {
    setIsRemoving(removing);
    resetFields();
    setIsDialogOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (enabled && !currentPin) {
      toast({ title: "Enter your current PIN", variant: "destructive" });
      return;
    }
    if (newPin.length < 4) {
      toast({ title: "PIN too short", description: "Use at least 4 digits.", variant: "destructive" });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ title: "PINs don't match", variant: "destructive" });
      return;
    }
    try {
      const result = await setHistoryPin.mutateAsync({
        data: { pin: newPin, currentPin: enabled ? currentPin : undefined },
      });
      setHistoryToken(result.token, result.expiresAt);
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast({ title: enabled ? "History PIN changed" : "History PIN set" });
      setIsDialogOpen(false);
      resetFields();
    } catch {
      toast({ title: "Couldn't save your PIN", description: "Check your current PIN and try again.", variant: "destructive" });
    }
  };

  const handleRemove = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPin) {
      toast({ title: "Enter your current PIN", variant: "destructive" });
      return;
    }
    try {
      await removeHistoryPin.mutateAsync({ data: { currentPin } });
      clearHistoryToken();
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast({ title: "History PIN removed", description: "Past conversations no longer require a PIN." });
      setIsDialogOpen(false);
      resetFields();
    } catch {
      toast({ title: "Couldn't remove your PIN", description: "Check your current PIN and try again.", variant: "destructive" });
    }
  };

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">History PIN</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            Protects the History page — an extra PIN, separate from your account password, so past
            conversations stay private on a shared or unattended device.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={enabled ? "text-primary" : "text-muted-foreground"}>
            {enabled ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {enabled ? "A History PIN is set" : "No History PIN set"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled ? "Required before viewing past conversations." : "Anyone signed into this account can view History."}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => openDialog(false)}>
            {enabled ? "Change" : "Set PIN"}
          </Button>
          {enabled && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => openDialog(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRemoving ? "Remove History PIN" : enabled ? "Change History PIN" : "Set a History PIN"}</DialogTitle>
            <DialogDescription>
              {isRemoving
                ? "Enter your current PIN to remove protection from your conversation history."
                : "Choose a 4-8 digit PIN. You'll need it to view past conversations."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={isRemoving ? handleRemove : handleSave} className="space-y-4">
            {(enabled || isRemoving) && (
              <div className="space-y-2">
                <Label htmlFor="current-pin">Current PIN</Label>
                <Input
                  id="current-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentPin}
                  onChange={(event) => setCurrentPin(digitsOnly(event.target.value))}
                  className="bg-background"
                  autoFocus
                />
              </div>
            )}
            {!isRemoving && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-pin">New PIN</Label>
                  <Input
                    id="new-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={newPin}
                    onChange={(event) => setNewPin(digitsOnly(event.target.value))}
                    className="bg-background"
                    autoFocus={!enabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-pin">Confirm new PIN</Label>
                  <Input
                    id="confirm-new-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={confirmPin}
                    onChange={(event) => setConfirmPin(digitsOnly(event.target.value))}
                    className="bg-background"
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button
                type="submit"
                variant={isRemoving ? "destructive" : "default"}
                disabled={setHistoryPin.isPending || removeHistoryPin.isPending}
              >
                {(setHistoryPin.isPending || removeHistoryPin.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                {isRemoving ? "Remove PIN" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
