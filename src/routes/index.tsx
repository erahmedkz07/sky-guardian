import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Zap, Lock, User, ShieldAlert } from "lucide-react";
import { authApi } from "@/lib/api";
import { isTokenValid, sessionAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: Splash,
});

function Splash() {
  const { t } = useT();
  const [progress, setProgress] = useState(0);
  const [animDone, setAnimDone] = useState(false);

  // null = checking, true = authenticated, false = not authenticated
  const [authResult, setAuthResult] = useState<boolean | null>(null);

  // ── Animation ─────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(id);
          setAnimDone(true);
          return 100;
        }
        return p + 4;
      });
    }, 60);
    return () => clearInterval(id);
  }, []);

  // ── Concurrent auth check — runs while animation plays ────
  useEffect(() => {
    const token = sessionStorage.getItem("dds_token");

    if (!token || !isTokenValid(token)) {
      sessionStorage.removeItem("dds_token");
      localStorage.removeItem("dds_user");
      sessionAuth.clear();
      setAuthResult(false);
      return;
    }

    // Token looks valid locally — confirm with server
    authApi
      .me()
      .then(() => {
        sessionAuth.markVerified(); // skip re-check on first protected route
        setAuthResult(true);
      })
      .catch((err: unknown) => {
        if (err instanceof TypeError) {
          // Server unreachable — allow access with cached token (mock fallback)
          sessionAuth.markVerified();
          setAuthResult(true);
        } else {
          // Server rejected token
          sessionStorage.removeItem("dds_token");
          localStorage.removeItem("dds_user");
          sessionAuth.clear();
          setAuthResult(false);
        }
      });
  }, []);

  // ── Redirect only after BOTH animation and auth check complete ──
  if (animDone && authResult !== null) {
    return <Navigate to={authResult ? "/command" : "/login"} />;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background scanline">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_oklch(0.25_0.12_145/0.4),_transparent_70%)]" />

      <div className="hud-panel relative z-10 w-full max-w-xl px-10 py-12">
        <div className="flex items-center gap-4 border-b border-border pb-6">
          <div className="relative flex h-14 w-14 items-center justify-center border border-hud bg-background hud-glow">
            <Zap className="h-8 w-8 text-hud hud-text-glow" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              {t("SECURE CHANNEL")}
            </div>
            <div className="text-2xl font-bold tracking-[0.3em] text-hud hud-text-glow">
              {t("DDS // CORE")}
            </div>
            <div className="text-xs text-muted-foreground">{t("Drone Defense System v4.2.1")}</div>
          </div>
        </div>

        <div className="mt-8 space-y-3 text-xs">
          <BootLine done={progress > 10} text={t("› Establishing secure uplink to command grid")} />
          <BootLine
            done={progress > 25}
            text={t("› Authenticating cryptographic handshake (RSA-4096)")}
          />
          <BootLine done={progress > 45} text={t("› Loading sensor manifest (12 nodes)")} />
          <BootLine done={progress > 65} text={t("› Initializing AI threat correlation engine")} />
          <BootLine done={progress > 85} text={t("› Synchronizing tactical map overlays")} />
          <BootLine
            done={progress > 99}
            text={t("› All systems nominal — handing off to operator")}
          />
        </div>

        <div className="mt-8">
          <div className="flex justify-between text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <span>{t("System Boot")}</span>
            <span className="text-hud">{progress}%</span>
          </div>
          <div className="mt-2 h-1 w-full bg-muted">
            <div
              className="h-full bg-hud transition-all"
              style={{ width: `${progress}%`, boxShadow: "0 0 12px var(--hud)" }}
            />
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-warning" />
            <span>{t("UNCLASSIFIED // FOR DEMONSTRATION")}</span>
          </div>
          <Link to="/login" className="flex items-center gap-1 hover:text-hud">
            <Lock className="h-3 w-3" />
            <User className="h-3 w-3" />
            {t("Manual Login")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function BootLine({ done, text }: { done: boolean; text: string }) {
  return (
    <div className={`flex items-center gap-2 ${done ? "text-hud" : "text-muted-foreground"}`}>
      <span className={`inline-block h-1.5 w-1.5 ${done ? "bg-hud" : "bg-muted blink-pulse"}`} />
      <span className="font-mono">{text}</span>
      <span className="ml-auto text-[10px]">{done ? "[OK]" : "[...]"}</span>
    </div>
  );
}
