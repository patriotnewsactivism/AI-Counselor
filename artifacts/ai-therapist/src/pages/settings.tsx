import { useEffect, useRef, useState } from "react";
import { 
  useGetProfile, 
  useUpdateProfile, 
  useGetStats,
  getGetProfileQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Settings, Save, User, MessageSquare, BookHeart, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { data: profile, isLoading: isLoadingProfile } = useGetProfile();
  const { data: stats, isLoading: isLoadingStats } = useGetStats();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [preferredName, setPreferredName] = useState("");
  const [companionName, setCompanionName] = useState("");
  
  const initialized = useRef(false);

  useEffect(() => {
    if (profile && !initialized.current) {
      setPreferredName(profile.preferredName || "");
      setCompanionName(profile.companionName || "Aura");
      initialized.current = true;
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync({
        data: {
          preferredName: preferredName.trim() || undefined,
          companionName: companionName.trim() || "Aura"
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast({
        title: "Preferences saved",
        description: "Your companion has noted your preferences."
      });
    } catch (err) {
      toast({
        title: "Error saving preferences",
        description: "Please try again later.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <header className="px-6 py-8 border-b border-border/50 shrink-0 bg-card/30">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center shrink-0">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-foreground">Settings</h1>
            <p className="text-muted-foreground mt-1">Your preferences and usage stats.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-12">
          
          {/* Profile Settings */}
          <section>
            <h2 className="font-serif text-xl text-foreground mb-4">Preferences</h2>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              {isLoadingProfile ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <form onSubmit={handleSave} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="preferredName">What should your companion call you?</Label>
                    <Input 
                      id="preferredName"
                      value={preferredName}
                      onChange={(e) => setPreferredName(e.target.value)}
                      placeholder="e.g. Sarah, Alex"
                      className="max-w-md bg-background"
                    />
                    <p className="text-xs text-muted-foreground">Leave blank to use your account default.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="companionName">Companion's Name</Label>
                    <Input 
                      id="companionName"
                      value={companionName}
                      onChange={(e) => setCompanionName(e.target.value)}
                      placeholder="e.g. Aura, Guide"
                      className="max-w-md bg-background"
                    />
                  </div>

                  <Button type="submit" disabled={updateProfile.isPending} className="bg-primary text-primary-foreground hover:opacity-90">
                    {updateProfile.isPending ? "Saving..." : "Save Preferences"}
                  </Button>
                </form>
              )}
            </div>
          </section>

          {/* Stats */}
          <section>
            <h2 className="font-serif text-xl text-foreground mb-4">Your Journey</h2>
            
            {isLoadingStats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                  icon={<MessageSquare className="h-5 w-5 text-primary" />}
                  label="Conversations"
                  value={stats.conversationCount.toString()}
                />
                <StatCard 
                  icon={<MessageSquare className="h-5 w-5 text-primary" />}
                  label="Messages"
                  value={stats.messageCount.toString()}
                />
                <StatCard 
                  icon={<BookHeart className="h-5 w-5 text-primary" />}
                  label="Memories"
                  value={stats.memoryCount.toString()}
                />
                <StatCard 
                  icon={<Calendar className="h-5 w-5 text-primary" />}
                  label="Last Active"
                  value={stats.lastActiveAt ? format(new Date(stats.lastActiveAt), "MMM d") : "Never"}
                />
              </div>
            ) : null}
          </section>

          <section className="pt-8 border-t border-border mt-4">
            <p className="text-xs text-muted-foreground text-center">
              Aura is a supportive companion, not a licensed therapist or crisis service. <br/>
              In an emergency, please contact local emergency services or a crisis line immediately.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-serif text-2xl text-foreground">
        {value}
      </div>
    </div>
  );
}
