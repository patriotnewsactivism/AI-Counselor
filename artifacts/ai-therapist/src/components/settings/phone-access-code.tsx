import { useState } from "react";
import { useGetProfile, useSetPhoneAccessCode, useRemovePhoneAccessCode, getGetProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function PhoneAccessCodeSection() {
  const { data: profile } = useGetProfile();
  const setCode = useSetPhoneAccessCode();
  const removeCode = useRemovePhoneAccessCode();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");

  const enabled = Boolean(profile?.phoneAccessCodeEnabled);

  const resetFields = () => {
    setCurrentCode("");
    setNewCode("");
    setConfirmCode("");
  };

  const openDialog = (removing: boolean) => {
    setIsRemoving(removing);
    resetFields();
    setIsDialogOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (enabled && !currentCode) {
      toast({ title: "Enter your current code", variant: "destructive" });
      return;
    }
    if (newCode.length !== 6) {
      toast({ title: "Code must be 6 digits", variant: "destructive" });
      return;
    }
    if (newCode !== confirmCode) {
      toast({ title: "Codes don't match", variant: "destructive" });
      return;
    }
    try {
      await setCode.mutateAsync({ data: { code: newCode, currentCode: enabled ? currentCode : undefined } });
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast({ title: enabled ? "Phone access code changed" : "Phone access code set" });
      setIsDialogOpen(false);
      resetFields();
    } catch {
      toast({ title: "Couldn't save your code", description: "Check your current code and try again.", variant: "destructive" });
    }
  };

  const handleRemove = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentCode) {
      toast({ title: "Enter your current code", variant: "destructive" });
      return;
    }
    try {
      await removeCode.mutateAsync({ data: { currentCode } });
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast({ title: "Phone access code removed", description: "The phone line can no longer identify this account." });
      setIsDialogOpen(false);
      resetFields();
    } catch {
      toast({ title: "Couldn't remove your code", description: "Check your current code and try again.", variant: "destructive" });
    }
  };

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">Phone Access Code</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            A 6-digit code you give the phone line so it knows which account a call belongs to — a phone call has no
            way to sign in, so this is the phone-side equivalent of being logged in.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={enabled ? "text-primary" : "text-muted-foreground"}>
            {enabled ? <ShieldCheck className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {enabled ? "A phone access code is set" : "No phone access code set"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled ? "The phone line can identify this account." : "Set a code to enable calling in."}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => openDialog(false)}>
            {enabled ? "Change" : "Set code"}
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
            <DialogTitle>{isRemoving ? "Remove Phone Access Code" : enabled ? "Change Phone Access Code" : "Set a Phone Access Code"}</DialogTitle>
            <DialogDescription>
              {isRemoving
                ? "Enter your current code to disable phone-line access for this account."
                : "Choose a 6-digit code. You'll say or enter it when you call in."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={isRemoving ? handleRemove : handleSave} className="space-y-4">
            {(enabled || isRemoving) && (
              <div className="space-y-2">
                <Label htmlFor="current-code">Current code</Label>
                <Input
                  id="current-code"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentCode}
                  onChange={(event) => setCurrentCode(digitsOnly(event.target.value))}
                  className="bg-background"
                  autoFocus
                />
              </div>
            )}
            {!isRemoving && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-code">New code</Label>
                  <Input
                    id="new-code"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={newCode}
                    onChange={(event) => setNewCode(digitsOnly(event.target.value))}
                    className="bg-background"
                    autoFocus={!enabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-code">Confirm new code</Label>
                  <Input
                    id="confirm-new-code"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(digitsOnly(event.target.value))}
                    className="bg-background"
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button
                type="submit"
                variant={isRemoving ? "destructive" : "default"}
                disabled={setCode.isPending || removeCode.isPending}
              >
                {(setCode.isPending || removeCode.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                {isRemoving ? "Remove code" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
