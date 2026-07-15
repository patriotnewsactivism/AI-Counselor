import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  Heart, 
  MessageCircle, 
  BookHeart, 
  Settings, 
  Menu,
  PlusCircle,
  LogOut,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useClerk } from "@clerk/react";
import { useListConversations } from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  return (
    <div className="min-h-[100dvh] flex bg-background font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>

      {/* Mobile Shell */}
      <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-background/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2 text-primary">
            <Heart className="h-6 w-6 fill-primary/20" />
            <span className="font-serif font-medium text-lg text-foreground">Aura</span>
          </div>
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border text-sidebar-foreground">
              <SidebarContent />
            </SheetContent>
          </Sheet>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent() {
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const { data: conversations = [], isLoading } = useListConversations();
  
  const handleLogout = () => {
    signOut({ redirectUrl: "/" });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6">
        <Link href="/companion" className="flex items-center gap-2 text-primary w-fit">
          <Heart className="h-7 w-7 fill-primary/20" />
          <span className="font-serif font-medium text-2xl text-sidebar-foreground tracking-tight">
            Aura
          </span>
        </Link>
      </div>

      <div className="px-4 pb-4">
        <Button 
          className="w-full justify-start gap-2 bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 rounded-full"
          onClick={() => setLocation('/companion')}
        >
          <PlusCircle className="h-4 w-4" />
          New Conversation
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="flex flex-col gap-1 py-2">
          <div className="text-xs font-medium text-sidebar-foreground/50 px-2 py-1 mb-1 uppercase tracking-wider">
            Recent
          </div>
          
          {isLoading ? (
            <div className="px-2 py-3 text-sm text-sidebar-foreground/50">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-sm text-sidebar-foreground/50 italic">No recent conversations</div>
          ) : (
            conversations.map(conv => {
              const isActive = location === `/companion/${conv.id}`;
              return (
                <Link key={conv.id} href={`/companion/${conv.id}`} className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors text-left",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}>
                  <span className="truncate">{conv.title || "A quiet moment"}</span>
                  {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-50 shrink-0" />}
                </Link>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-sidebar-border flex flex-col gap-1">
        <Link href="/memories" className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left",
          location === '/memories' 
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        )}>
          <BookHeart className="h-4 w-4" />
          Memories
        </Link>
        <Link href="/settings" className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left",
          location === '/settings' 
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        )}>
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground mt-2"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </div>
  );
}
