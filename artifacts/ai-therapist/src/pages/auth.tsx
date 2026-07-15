import { SignIn, SignUp } from "@clerk/react";
import { Heart } from "lucide-react";
import { Link } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="mb-8 relative z-10 flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
          <Heart className="h-8 w-8 fill-primary/20" />
          <span className="font-serif font-medium text-2xl tracking-tight text-foreground">
            Aura
          </span>
        </Link>
      </div>

      <div className="w-full max-w-[440px] relative z-10">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

export function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="mb-8 relative z-10 flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
          <Heart className="h-8 w-8 fill-primary/20" />
          <span className="font-serif font-medium text-2xl tracking-tight text-foreground">
            Aura
          </span>
        </Link>
      </div>

      <div className="w-full max-w-[440px] relative z-10">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}
