import { useState, useRef, useEffect } from "react";
import { 
  useListVoiceProfiles,
  useEnrollVoiceProfile,
  useDeleteVoiceProfile,
  useUpdateVoiceProfile,
  getListVoiceProfilesQueryKey,
  getGetStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Mic, Plus, Trash2, Edit2, Check, X, Loader2, Square, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function VoiceProfilesSection() {
  const { data: profiles, isLoading } = useListVoiceProfiles();
  const deleteProfile = useDeleteVoiceProfile();
  const updateProfile = useUpdateVoiceProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [isEnrollDialogOpen, setIsEnrollDialogOpen] = useState(false);

  const handleEdit = (id: number, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await updateProfile.mutateAsync({ id, data: { name: editName.trim() } });
      queryClient.invalidateQueries({ queryKey: getListVoiceProfilesQueryKey() });
      setEditingId(null);
      toast({ title: "Profile updated" });
    } catch (err) {
      toast({ title: "Error updating profile", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteProfile.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListVoiceProfilesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() }); // update stats
      toast({ title: "Profile deleted" });
    } catch (err) {
      toast({ title: "Error deleting profile", variant: "destructive" });
    }
  };

  return (
    <section className="pt-8 border-t border-border mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-serif text-xl text-foreground">Voice Profiles</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[90%] leading-relaxed">
            Your companion learns to recognise the people in your life. Enrolled voices are tied to this account — not shared with anyone, and deletable anytime.
          </p>
        </div>
        <Button 
          onClick={() => setIsEnrollDialogOpen(true)}
          variant="outline" 
          size="sm"
          className="shrink-0 gap-1.5"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add voice</span>
        </Button>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !profiles || profiles.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
              <Headphones className="h-6 w-6 text-primary/60" />
            </div>
            <h3 className="font-medium text-foreground mb-1">No voices enrolled</h3>
            <p className="text-sm text-muted-foreground">Add a voice to help Aura recognize who is speaking.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profiles.map(profile => (
              <div key={profile.id} className="p-4 sm:p-5 flex items-center justify-between gap-4 group">
                <div className="flex items-center gap-4 flex-1 overflow-hidden">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                    <Mic className="h-5 w-5 text-primary" />
                  </div>
                  {editingId === profile.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="max-w-[200px] h-8 text-sm bg-background"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(profile.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950" onClick={() => handleSaveEdit(profile.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">{profile.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {profile.lastHeardAt 
                          ? `Last heard ${formatDistanceToNow(new Date(profile.lastHeardAt), { addSuffix: true })}`
                          : "Never heard"}
                      </div>
                    </div>
                  )}
                </div>
                
                {editingId !== profile.id && (
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleEdit(profile.id, profile.name)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(profile.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <EnrollVoiceDialog open={isEnrollDialogOpen} onOpenChange={setIsEnrollDialogOpen} />
    </section>
  );
}

function EnrollVoiceDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioData, setAudioData] = useState<{ base64: string, mimeType: string } | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const { toast } = useToast();
  
  const enrollProfile = useEnrollVoiceProfile();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) {
      resetState();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [open]);

  const resetState = () => {
    setName("");
    setIsRecording(false);
    setRecordingDuration(0);
    setAudioData(null);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const startRecording = async () => {
    try {
      setAudioData(null);
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
          const base64 = base64data.split(',')[1];
          setAudioData({ base64, mimeType: blob.type });
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);
      
      timerRef.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      toast({
        title: "Microphone access denied",
        description: "Please allow microphone access to record a voice.",
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleEnroll = async () => {
    if (!name.trim() || !audioData) return;
    try {
      await enrollProfile.mutateAsync({
        data: {
          name: name.trim(),
          audioBase64: audioData.base64,
          mimeType: audioData.mimeType
        }
      });
      queryClient.invalidateQueries({ queryKey: getListVoiceProfilesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() }); // update stats
      toast({ title: "Voice profile created", description: `${name} has been enrolled.` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Error enrolling voice", description: "Please try recording again.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-serif">Enroll a Voice</DialogTitle>
          <DialogDescription>
            Record 5-10 seconds of speech. Your companion will use this to recognise who is speaking.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-6">
          <div className="space-y-2">
            <label htmlFor="voiceName" className="text-sm font-medium text-foreground">Who is speaking?</label>
            <Input 
              id="voiceName"
              placeholder="e.g. My partner, David, Mom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background"
            />
          </div>

          <div className="flex flex-col items-center justify-center p-6 bg-secondary/30 rounded-xl border border-border">
            {audioData ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 rounded-full flex items-center justify-center mb-1">
                  <Check className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Recording captured</p>
                  <Button variant="link" size="sm" onClick={startRecording} className="h-auto p-0 text-primary">
                    Record again
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  {isRecording && (
                    <div className="absolute inset-0 bg-destructive/20 rounded-full scale-[1.5] animate-ping pointer-events-none" />
                  )}
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={cn(
                      "relative z-10 flex items-center justify-center h-16 w-16 rounded-full transition-all duration-300 shadow-md",
                      isRecording 
                        ? "bg-destructive text-destructive-foreground scale-105" 
                        : "bg-primary text-primary-foreground hover:scale-105"
                    )}
                  >
                    {isRecording ? <Square className="h-6 w-6 fill-current" /> : <Mic className="h-6 w-6" />}
                  </button>
                </div>
                
                <div className="h-6 flex items-center justify-center">
                  {isRecording ? (
                    <span className="font-mono text-lg font-medium text-destructive animate-pulse">
                      0:{recordingDuration.toString().padStart(2, '0')}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Tap to start recording</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleEnroll} 
            disabled={!name.trim() || !audioData || enrollProfile.isPending}
            className="gap-2 bg-primary text-primary-foreground hover:opacity-90"
          >
            {enrollProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Voice Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
