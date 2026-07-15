import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ClerkProvider, Show, useClerk, ClerkLoaded } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { useEffect, useRef } from 'react';

// Pages
import LandingPage from '@/pages/landing';
import { SignInPage, SignUpPage } from '@/pages/auth';
import CompanionPage from '@/pages/companion';
import MemoriesPage from '@/pages/memories';
import SettingsPage from '@/pages/settings';
import AppLayout from '@/components/layout/app-layout';

// Setup Clerk environment
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(25 60% 45%)",
    colorForeground: "hsl(25 40% 15%)",
    colorMutedForeground: "hsl(25 20% 45%)",
    colorDanger: "hsl(0 60% 50%)",
    colorBackground: "hsl(40 40% 98%)",
    colorInput: "hsl(40 20% 88%)",
    colorInputForeground: "hsl(25 40% 15%)",
    colorNeutral: "hsl(40 20% 88%)",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none p-8",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-2xl text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "font-medium text-foreground",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/80 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground bg-card px-2",
    identityPreviewEditButton: "text-primary hover:text-primary/80",
    formFieldSuccessText: "text-green-600",
    alertText: "text-destructive font-medium",
    logoBox: "mb-4",
    logoImage: "h-8 object-contain",
    socialButtonsBlockButton: "border border-border hover:bg-accent hover:text-accent-foreground",
    formButtonPrimary: "bg-primary text-primary-foreground hover:opacity-90 font-medium shadow-sm transition-opacity",
    formFieldInput: "border border-input bg-card text-foreground rounded-md",
    footerAction: "mt-4",
    dividerLine: "bg-border",
    alert: "border border-destructive/20 bg-destructive/10 text-destructive",
    otpCodeFieldInput: "border border-input bg-card",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Route component={() => {
          const [, setLocation] = useLocation();
          useEffect(() => { setLocation('/companion'); }, [setLocation]);
          return null;
        }} />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: any }) {
  const [, setLocation] = useLocation();
  
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Component />
        </AppLayout>
      </Show>
      <Show when="signed-out">
        <Route component={() => {
          useEffect(() => { setLocation('/'); }, []);
          return null;
        }} />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

const queryClient = new QueryClient();

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to check in with your companion",
          },
        },
        signUp: {
          start: {
            title: "Begin your journey",
            subtitle: "Create a space just for you",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkLoaded>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <Route path="/companion" component={() => <ProtectedRoute component={CompanionPage} />} />
            <Route path="/companion/:id" component={() => <ProtectedRoute component={CompanionPage} />} />
            <Route path="/memories" component={() => <ProtectedRoute component={MemoriesPage} />} />
            <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
            
            <Route component={NotFound} />
          </Switch>
        </ClerkLoaded>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
