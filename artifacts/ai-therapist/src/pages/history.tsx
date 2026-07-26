import { useEffect, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { History as HistoryIcon, Lock, Trash2, MessageCircle, Loader2, Download } from "lucide-react";
import {
  useGetProfile,
  useListConversations,
  useDeleteConversation,
  useSetHistoryPin,
  useUnlockHistory,
  listMessages,
  getListConversationsQueryKey,
  getGetProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getHistoryToken, setHistoryToken, clearHistoryToken } from "@/lib/history-access";

export default function HistoryPage() {
  const { data: profile, isLoading: isLoadingProfile } = useGetProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(() => getHistoryToken());
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [exportingId, setExportingId] = useState<number | null>(null);

  const setHistoryPin = useSetHistoryPin();
  const unlockHistory = useUnlockHistory();
  const deleteConversation = useDeleteConversation();

  const {
    data: conversations = [],
    isLoading: isLoadingConversations,
    isError,
  } = useListConversations({
    query: { enabled: !!token, retry: false, queryKey: getListConversationsQueryKey() },
    request: token ? { headers: { "x-history-token": token } } : undefined,
  });

  // The token can go stale (expired, or a PIN change elsewhere) — fall back
  // to the lock screen rather than showing a broken/empty list.
  useEffect(() => {
    if (!isError || !token) return;
    clearHistoryToken();
    setToken(null);
    toast({ title: "History locked again", description: "Please re-enter your PIN.", variant: "destructive" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  const handleLock = () => {
    clearHistoryToken();
    setToken(null);
  };

  const resetPinFields = () => {
    setPin("");
    setConfirmPin("");
  };

  const handleSetupSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pin.length < 4) {
      toast({ title: "PIN too short", description: "Use at least 4 digits.", variant: "destructive" });
      return;
    }
    if (pin !== confirmPin) {
      toast({ title: "PINs don't match", description: "Please enter the same PIN twice.", variant: "destructive" });
      return;
    }
    try {
      const result = await setHistoryPin.mutateAsync({ data: { pin } });
      setHistoryToken(result.token, result.expiresAt);
      setToken(result.token);
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      resetPinFields();
    } catch {
      toast({ title: "Couldn't set your PIN", description: "Please try again.", variant: "destructive" });
    }
  };

  const handleUnlockSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await unlockHistory.mutateAsync({ data: { pin } });
      setHistoryToken(result.token, result.expiresAt);
      setToken(result.token);
      resetPinFields();
    } catch {
      toast({ title: "Incorrect PIN", description: "Please try again.", variant: "destructive" });
      setPin("");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteConversation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    } catch {
      toast({ title: "Couldn't delete that conversation", variant: "destructive" });
    }
  };

  const handleExport = async (id: number, title: string | null) => {
    setExportingId(id);
    try {
      const messages = await listMessages(id);
      const lines = messages.map((m) => {
        const who = m.role === "user" ? m.speakerName || "You" : "Companion";
        const when = format(new Date(m.createdAt), "MMM d, yyyy h:mm a");
        return `[${when}] ${who}: ${m.content}`;
      });
      const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeTitle = (title || "conversation").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      link.href = url;
      link.download = `${safeTitle}-${id}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Couldn't export that transcript", variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <header className="px-6 py-8 border-b border-border/50 shrink-0 bg-card/30">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center shrink-0">
              <HistoryIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-serif text-3xl text-foreground">History</h1>
              <p className="text-muted-foreground mt-1">Your past conversations, protected by a PIN.</p>
            </div>
          </div>
          {token && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleLock}>
              <Lock className="h-3.5 w-3.5" /> Lock
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-12">
          {isLoadingProfile ? (
            <Skeleton className="h-64 w-full max-w-md mx-auto rounded-2xl mt-6" />
          ) : !token ? (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm max-w-md mx-auto w-full mt-6">
              <div className="flex flex-col items-center text-center gap-2 mb-6">
                <div className="w-14 h-14 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                  <Lock className="h-6 w-6" />
                </div>
                <h2 className="font-serif text-xl text-foreground">
                  {profile?.historyPinEnabled ? "Enter your History PIN" : "Set up a History PIN"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {profile?.historyPinEnabled
                    ? "For your privacy, past conversations stay locked until you enter your PIN."
                    : "Choose a 4-8 digit PIN to keep your past conversations private on shared devices."}
                </p>
              </div>

              {profile?.historyPinEnabled ? (
                <form onSubmit={handleUnlockSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="unlock-pin">PIN</Label>
                    <Input
                      id="unlock-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="••••"
                      className="bg-background text-center tracking-[0.5em] text-lg"
                      autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={unlockHistory.isPending || pin.length < 4}>
                    {unlockHistory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSetupSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="setup-pin">New PIN</Label>
                    <Input
                      id="setup-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="4-8 digits"
                      className="bg-background"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-pin">Confirm PIN</Label>
                    <Input
                      id="confirm-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={confirmPin}
                      onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="4-8 digits"
                      className="bg-background"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={setHistoryPin.isPending || pin.length < 4}>
                    {setHistoryPin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set PIN & View History"}
                  </Button>
                </form>
              )}
              <p className="text-xs text-muted-foreground text-center mt-4">
                You can change or remove this PIN anytime in Settings.
              </p>
            </div>
          ) : isLoadingConversations ? (
            <div className="grid gap-3 mt-2">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="shadow-none">
                  <CardContent className="p-5 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-2xl bg-card/20 mt-4">
              <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="font-serif text-xl text-foreground mb-2">No conversations yet</h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                Start a conversation and it'll show up here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 mt-2">
              {conversations.map((conv) => (
                <Card key={conv.id} className="group overflow-hidden transition-all hover:border-primary/30">
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <Link href={`/companion/${conv.id}`} className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium text-foreground truncate">{conv.title || "A quiet moment"}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {format(new Date(conv.updatedAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </Link>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground hover:bg-accent"
                        onClick={() => handleExport(conv.id, conv.title)}
                        disabled={exportingId === conv.id}
                        aria-label="Download transcript"
                      >
                        {exportingId === conv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(conv.id)}
                        disabled={deleteConversation.isPending}
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
