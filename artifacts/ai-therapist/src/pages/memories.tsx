import { useListMemories, useDeleteMemory, getListMemoriesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Trash2, BookHeart, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

export default function MemoriesPage() {
  const { data: memories = [], isLoading } = useListMemories();
  const deleteMemory = useDeleteMemory();
  const queryClient = useQueryClient();

  const handleDelete = async (id: number) => {
    try {
      await deleteMemory.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMemoriesQueryKey() });
    } catch (err) {
      console.error("Failed to delete memory", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <header className="px-6 py-8 border-b border-border/50 shrink-0 bg-card/30">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center shrink-0">
            <BookHeart className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-foreground">Memories</h1>
            <p className="text-muted-foreground mt-1">Things your companion remembers about you.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-12">
          
          <div className="bg-accent/50 border border-accent rounded-xl p-4 flex gap-3 text-sm text-accent-foreground/80 leading-relaxed shadow-sm">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p>
                <strong>Your Private Context</strong> <br/>
                These are just notes based on things you've explicitly shared, helping your companion build context and continue the conversation smoothly over time. This is not a biometric profile or voice fingerprint. You can delete any memory at any time.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 mt-4">
              {[1, 2, 3].map(i => (
                <Card key={i} className="shadow-none">
                  <CardContent className="p-5 flex justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                    <Skeleton className="h-8 w-8 rounded-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-2xl bg-card/20 mt-4">
              <BookHeart className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="font-serif text-xl text-foreground mb-2">No memories yet</h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                As you talk with your companion, important context about your life, preferences, and challenges will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 mt-4">
              {memories.map((memory) => (
                <Card key={memory.id} className="group overflow-hidden transition-all hover:border-primary/30">
                  <CardContent className="p-5 flex justify-between items-start gap-4">
                    <div>
                      {memory.category && (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground mb-2">
                          {memory.category}
                        </span>
                      )}
                      <p className="text-[15px] text-foreground leading-relaxed">
                        {memory.content}
                      </p>
                      <p className="text-xs text-muted-foreground mt-3">
                        Recorded {format(new Date(memory.createdAt), "MMMM d, yyyy")}
                      </p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(memory.id)}
                      disabled={deleteMemory.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
