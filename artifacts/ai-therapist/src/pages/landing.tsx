import { Shield, Sparkles, AudioLines, Heart } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary/20">
      <header className="py-6 px-6 md:px-12 flex justify-between items-center z-10 relative">
        <div className="flex items-center gap-2 text-primary">
          <Heart className="h-6 w-6 fill-primary/20" />
          <span className="font-serif font-medium text-xl tracking-tight text-foreground">
            Aura
          </span>
        </div>
        <div className="flex gap-4 items-center">
          <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Log in
          </Link>
          <Link href="/sign-up">
            <Button className="rounded-full shadow-sm">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col justify-center max-w-5xl mx-auto px-6 md:px-12 py-12 md:py-20">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">
            <div className="flex flex-col gap-6 max-w-xl">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium w-fit">
                <Sparkles className="h-4 w-4" />
                A calm space for your thoughts
              </div>
              <h1 className="text-5xl md:text-6xl font-serif text-foreground leading-[1.1] tracking-tight">
                A companion who always has time to listen.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
                Not a clinic. Not a productivity tool. Just a warm, unhurried presence to talk to at the end of a long day. Speak your mind, and feel heard.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mt-4">
                <Link href="/sign-up">
                  <Button size="lg" className="rounded-full text-base h-14 px-8 w-full sm:w-auto shadow-md">
                    Start a conversation
                  </Button>
                </Link>
                <Link href="/sign-in">
                  <Button size="lg" variant="outline" className="rounded-full text-base h-14 px-8 w-full sm:w-auto">
                    Welcome back
                  </Button>
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent rounded-[2rem] transform rotate-3 scale-105 blur-lg opacity-50"></div>
              <div className="relative bg-card border border-border shadow-xl rounded-[2rem] overflow-hidden aspect-[4/5] md:aspect-square">
                <img 
                  src="/hero-lamp.jpg" 
                  alt="A warm lamp glowing in a dim room" 
                  className="w-full h-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent"></div>
                <div className="absolute bottom-0 left-0 right-0 p-8">
                  <div className="bg-background/80 backdrop-blur-md border border-border/50 rounded-2xl p-5 shadow-lg flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <AudioLines className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Voice Message</div>
                        <div className="text-xs text-muted-foreground">0:45 • Playing</div>
                      </div>
                    </div>
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-primary w-1/3 rounded-full relative">
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.8)]"></div>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/80 font-medium italic mt-1">
                      "Take a deep breath. You handled that beautifully today..."
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="bg-card/50 border-t border-border mt-12 py-16">
          <div className="max-w-5xl mx-auto px-6 md:px-12 grid sm:grid-cols-3 gap-8">
            <div className="flex flex-col gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-2">
                <AudioLines className="h-6 w-6" />
              </div>
              <h3 className="font-serif text-xl text-foreground">Voice-first connection</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Speak naturally. No typing required. Hear a warm, grounding voice reply to you in real-time.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-2">
                <Heart className="h-6 w-6" />
              </div>
              <h3 className="font-serif text-xl text-foreground">Remembers what matters</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Like a true friend, it remembers the details you share, building a continuous relationship over time.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-2">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="font-serif text-xl text-foreground">Your private space</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your memories and conversations are yours alone. Review and delete anything at any time.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-8 px-6 md:px-12 border-t border-border bg-background text-center md:text-left flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Heart className="h-4 w-4 fill-muted-foreground/20" />
          Aura Companion
        </div>
        <div className="text-xs text-muted-foreground max-w-xl text-center md:text-right">
          Aura is a supportive conversational companion, not a licensed therapist, clinician, or crisis service. 
          If you are experiencing an emergency, please contact local emergency services or a crisis line.
        </div>
      </footer>
    </div>
  );
}
