import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import appCss from "../styles.css?url";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { authApi } from "@/lib/api";
import { isTokenValid, sessionAuth } from "@/lib/auth";
import { I18nProvider, useT } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

// Routes that don't require authentication
const NAKED = new Set(["/", "/login"]);

// ─── 404 ──────────────────────────────────────────────────────
function NotFoundComponent() {
  const { t } = useT();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="hud-panel max-w-md text-center px-10 py-12">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          {t("SIGNAL LOST")}
        </div>
        <h1 className="mt-2 text-7xl font-bold text-hud hud-text-glow">404</h1>
        <h2 className="mt-2 text-sm uppercase tracking-[0.2em] text-foreground">
          {t("Coordinates not found")}
        </h2>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("The requested module is offline or the route does not exist in the system manifest.")}
        </p>
        <Link
          to="/command"
          className="mt-6 inline-block border border-hud bg-hud/10 px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20"
        >
          {t("‹‹ Return to Command")}
        </Link>
      </div>
    </div>
  );
}

// ─── Route definition ─────────────────────────────────────────
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sky Guardian — Drone Defense System" },
      {
        name: "description",
        content: "Tactical airspace monitoring, drone detection, and incident response platform.",
      },
      { name: "theme-color", content: "#0d1612" },
      { property: "og:title", content: "Sky Guardian — Drone Defense System" },
      {
        property: "og:description",
        content: "Real-time airspace monitoring and counter-UAS command platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider>{children}</I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

// ─── Auth states ──────────────────────────────────────────────
type AuthState =
  | "idle" // naked route — auth not required
  | "checking" // verifying token with the server
  | "ok" // authenticated
  | "fail"; // not authenticated → redirect to /login

// ─── Root component ───────────────────────────────────────────
function RootComponent() {
  const loc = useLocation();
  const navigate = useNavigate();
  const isNaked = NAKED.has(loc.pathname);

  const [auth, setAuth] = useState<AuthState>("idle");

  useEffect(() => {
    // Naked routes (/  /login) — no auth check needed.
    // Critically: do NOT set auth to "ok" here. If we did, the state
    // would persist when navigating away and the protected route would
    // render before the token check completes (the original bypass bug).
    if (isNaked) {
      setAuth("idle");
      return;
    }

    // ── Step 1: fast local check ──────────────────────────────
    const token = sessionStorage.getItem("dds_token");
    if (!token || !isTokenValid(token)) {
      sessionStorage.removeItem("dds_token");
      localStorage.removeItem("dds_user");
      sessionAuth.clear();
      setAuth("fail");
      return;
    }

    // ── Step 2: if already server-verified this session, allow instantly ──
    if (sessionAuth.verified) {
      setAuth("ok");
      return;
    }

    // ── Step 3: first protected route this session — verify with server ──
    setAuth("checking");
    authApi
      .me()
      .then(() => {
        sessionAuth.markVerified();
        setAuth("ok");
      })
      .catch((err: unknown) => {
        if (err instanceof TypeError) {
          // Network unreachable (server not running) — allow access with
          // the locally valid token so the mock-data fallback still works.
          sessionAuth.markVerified();
          setAuth("ok");
        } else {
          // Server explicitly rejected the token (401 / 403).
          sessionStorage.removeItem("dds_token");
          localStorage.removeItem("dds_user");
          sessionAuth.clear();
          setAuth("fail");
        }
      });
  }, [loc.pathname, isNaked]);

  // Redirect to login whenever auth fails
  useEffect(() => {
    if (auth === "fail") {
      navigate({ to: "/login", replace: true });
    }
  }, [auth, navigate]);

  // ── Render ─────────────────────────────────────────────────
  if (isNaked) return <Outlet />;
  if (auth === "fail") return null; // brief blank while navigating to /login
  if (auth === "checking") return <SessionCheckScreen />;
  if (auth !== "ok") return null; // "idle" — shouldn't happen on protected routes
  return (
    <ErrorBoundary>
      <AppShell>
        <Outlet />
      </AppShell>
    </ErrorBoundary>
  );
}

// ─── Session verification loading screen ─────────────────────
function SessionCheckScreen() {
  const { t } = useT();
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background scanline">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_oklch(0.22_0.1_145/0.3),_transparent_70%)]" />
      <div className="hud-panel relative z-10 flex flex-col items-center gap-5 px-14 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-hud hud-text-glow" />
        <div className="space-y-1 text-center">
          <div className="text-sm font-bold uppercase tracking-[0.35em] text-hud hud-text-glow">
            {t("Verifying Session")}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("Authenticating with command server…")}
          </div>
        </div>
      </div>
    </div>
  );
}
