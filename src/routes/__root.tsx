import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, useLocation, useNavigate, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { getSettings } from "@/lib/dataStore";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import LoginPage from "@/components/LoginPage";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Page not found.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: { error: any }) {
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sahil Road Lines — Transport ERP" },
      { name: "description", content: "Dispatch and logistics management for Sahil Road Lines transport contractors." },
      { property: "og:title", content: "Sahil Road Lines — Transport ERP" },
      { property: "og:description", content: "Dispatch and logistics management for Sahil Road Lines transport contractors." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Sahil Road Lines — Transport ERP" },
      { name: "twitter:description", content: "Dispatch and logistics management for Sahil Road Lines transport contractors." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7108ce72-fafc-4a64-83ca-bd4045429480/id-preview-137941cf--c3fdc003-983a-41fd-9d2e-ae2172d4275c.lovable.app-1784182860299.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7108ce72-fafc-4a64-83ca-bd4045429480/id-preview-137941cf--c3fdc003-983a-41fd-9d2e-ae2172d4275c.lovable.app-1784182860299.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Gates the entire app on login. Crucially, getSettings() (a Supabase query)
// is only ever called AFTER a session exists — this matters once RLS is
// tightened to require authentication, since an unauthenticated call would
// otherwise fail before the login screen even had a chance to render.
function AuthGate() {
  const { session, loading, isRecovery, recoveryError } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Public routes reachable without a session (self-service PIN recovery).
  const isPublicAuthRoute = pathname === "/forgot-pin" || pathname === "/reset-pin" || pathname === "/test-receipt";

  // A PASSWORD_RECOVERY session is a temporary auth state that must be routed
  // to /reset-pin — it must NEVER fall through to the normal Dashboard even
  // though a Supabase session object exists. Recovery has priority over all
  // authenticated routing. An invalid/expired recovery error in the URL hash
  // is routed the same way so the user sees the "request a new link" page.
  const recoveryActive = isRecovery || !!recoveryError;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[gate] pathname:", pathname,
      "loading:", loading,
      "session:", session ? "present" : "none",
      "isRecovery:", isRecovery,
      "recoveryError:", recoveryError?.code ?? null);
  }

  useEffect(() => {
    if (recoveryActive && !isPublicAuthRoute) {
      navigate({ to: "/reset-pin" });
    }
  }, [recoveryActive, isPublicAuthRoute, navigate]);

  useEffect(() => {
    if (!session) return;
    getSettings()
      .then((s) => {
        document.documentElement.classList.toggle("dark", s.darkMode);
      })
      .catch(() => {
        // settings fetch failing shouldn't block the app from rendering
      });
  }, [session]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // During recovery (valid session or invalid/expired link), route to
  // /reset-pin.  If we're already on a public auth route, render the outlet
  // normally.  If we're on any other route (e.g. "/" because Supabase
  // redirected to the site root), show a loading state while the navigation
  // effect above pushes to /reset-pin — never show the Dashboard.
  if (recoveryActive) {
    if (!isPublicAuthRoute) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Redirecting to password reset...</div>
        </div>
      );
    }
    return (
      <>
        <Outlet />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  if (!session && !isPublicAuthRoute) {
    return <LoginPage />;
  }

  return (
    <>
      <Outlet />
      {session && <Toaster richColors position="top-right" />}
    </>
  );
}
