import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Zap, Lock, User, Shield, AlertTriangle, KeyRound, ShieldOff } from "lucide-react";
import { authApi } from "@/lib/api";
import { sessionAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

interface SysStats {
  sensors: { online: number; total: number };
  activeTracks: number;
  openIncidents: number;
}

function useAstanaTime() {
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleString("en-GB", {
        timeZone: "Asia/Almaty",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    setTime(fmt());
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

async function fetchStats(): Promise<SysStats> {
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  const res = await fetch(`${base}/api/stats`);
  if (!res.ok) throw new Error("stats unavailable");
  return res.json();
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Login // DDS" }] }),
});

function LoginPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SysStats | null>(null);
  const astanaTime = useAstanaTime();

  // 2FA step
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  // Access recovery modal
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryId, setRecoveryId] = useState("");
  const [recoverySubmitted, setRecoverySubmitted] = useState(false);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  function finishLogin(token: string, user: object) {
    sessionStorage.setItem("dds_token", token);
    localStorage.setItem("dds_user", JSON.stringify(user));
    sessionAuth.markVerified();
    window.dispatchEvent(new Event("dds_user_updated"));
    navigate({ to: "/command", replace: true });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await authApi.login(email, pwd);
      if ("requiresTwoFactor" in result && result.requiresTwoFactor) {
        setPendingToken(result.pendingToken);
      } else if ("token" in result) {
        finishLogin(result.token, result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Authentication failed"));
    } finally {
      setLoading(false);
    }
  };

  const submit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingToken || totpCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const { token, user } = await authApi.loginWith2fa(pendingToken, totpCode);
      finishLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Invalid code"));
      setTotpCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryId.trim()) return;
    setRecoverySubmitted(true);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 scanline">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_oklch(0.22_0.1_145/0.35),_transparent_70%)]" />

      {/* ─── Access Recovery Modal ────────────────────────────── */}
      {showRecovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="hud-panel w-full max-w-md p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {t("Security Protocol")}
                </div>
                <h2 className="mt-1 text-lg font-bold uppercase tracking-[0.2em] text-hud hud-text-glow">
                  {t("Access Recovery")}
                </h2>
              </div>
              <ShieldOff className="h-7 w-7 text-warning" />
            </div>

            {recoverySubmitted ? (
              <div className="space-y-4">
                <div className="border border-hud/40 bg-hud/5 px-4 py-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-hud mb-2">
                    {t("Request Logged")}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("Recovery request for Operator ID")} <span className="font-bold text-hud font-mono">{recoveryId}</span>{" "}
                    {t("has been logged in the audit system. Contact your System Administrator with this ID to restore access.")}
                  </p>
                </div>
                <div className="border border-warning/30 bg-warning/5 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-warning">
                  {t("All recovery attempts are recorded and audited.")}
                </div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground space-y-1 pt-1">
                  <div>{t("Admin contact")}: <span className="text-foreground">system-admin@dds.kz</span></div>
                  <div>{t("Hotline")}: <span className="text-foreground">+7 (700) 000-00-00</span></div>
                </div>
                <button
                  onClick={() => setShowRecovery(false)}
                  className="w-full border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
                >
                  {t("Close")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleRecoverySubmit} className="space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("Enter your Operator ID to submit a recovery request. Your System Administrator will be notified.")}
                </p>
                <Field icon={<User className="h-4 w-4" />} label={t("Operator ID")}>
                  <input
                    value={recoveryId}
                    onChange={(e) => setRecoveryId(e.target.value)}
                    placeholder="OP-XXXX"
                    className="w-full bg-transparent text-sm outline-none font-mono"
                    autoFocus
                  />
                </Field>
                <div className="border border-warning/30 bg-warning/5 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-warning flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {t("Recovery requests are logged and attributed. Unauthorized use is a security violation.")}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRecovery(false)}
                    className="flex-1 border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={!recoveryId.trim()}
                    className="flex-1 border border-warning bg-warning/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-warning hover:bg-warning/20 disabled:opacity-50"
                  >
                    {t("Submit Request")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="hud-panel hidden lg:flex flex-col justify-between p-10">
          <div>
            <div className="flex items-center gap-3">
              <Zap className="h-6 w-6 text-hud hud-text-glow" />
              <span className="text-xl font-bold tracking-[0.3em] text-hud hud-text-glow">DDS</span>
            </div>
            <div className="mt-12 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Briefing // {astanaTime || "——:——:——"} AST
            </div>
            <h2 className="mt-3 text-3xl font-bold uppercase leading-tight tracking-wider text-foreground">
              {t("Airspace integrity is a 24/7 mandate.")}
            </h2>
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              {t(
                "You are accessing the Drone Defense Operations Console. All actions are logged, attributed, and reviewable by command authority.",
              )}
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <Row
              label={t("Sensors online")}
              value={stats ? `${stats.sensors.online} / ${stats.sensors.total}` : "— / —"}
              tone="hud"
            />
            <Row
              label={t("Active tracks")}
              value={stats ? String(stats.activeTracks).padStart(2, "0") : "—"}
              tone="warning"
            />
            <Row
              label={t("Open incidents")}
              value={stats ? String(stats.openIncidents).padStart(2, "0") : "—"}
              tone="threat"
            />
            <Row label={t("DEFCON")} value={t("DEFCON 3 — ELEVATED")} tone="warning" />
          </div>
        </div>

        <div className="hud-panel p-8 sm:p-10">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {pendingToken ? t("Two-Factor Authentication") : t("Authentication Required")}
              </div>
              <h1 className="mt-2 text-2xl font-bold uppercase tracking-[0.2em] text-hud hud-text-glow">
                {pendingToken ? t("Enter Code") : t("Operator Login")}
              </h1>
            </div>
            {pendingToken ? (
              <KeyRound className="h-8 w-8 text-hud" />
            ) : (
              <Shield className="h-8 w-8 text-hud" />
            )}
          </div>

          {/* ─── 2FA step ─────────────────────────────── */}
          {pendingToken && (
            <form onSubmit={submit2fa} className="mt-8 space-y-5">
              <p className="text-xs text-muted-foreground">
                {t("Enter the 6-digit code from your authenticator app.")}
              </p>
              <Field icon={<KeyRound className="h-4 w-4" />} label={t("Authenticator Code")}>
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="w-full bg-transparent text-sm outline-none tracking-[0.4em] font-mono"
                  placeholder="000000"
                  autoFocus
                />
              </Field>
              {error && (
                <div className="flex items-center gap-2 border border-threat/40 bg-threat/10 px-3 py-2 text-xs text-threat">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || totpCode.length !== 6}
                className="w-full border border-hud bg-hud/10 px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-hud hover:bg-hud/20 disabled:opacity-60"
              >
                {loading ? t("VERIFYING...") : t("Verify ›")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingToken(null);
                  setError(null);
                }}
                className="w-full text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-hud"
              >
                {t("‹ Back")}
              </button>
            </form>
          )}

          {/* ─── Password step ────────────────────────── */}
          {!pendingToken && (
            <form onSubmit={submit} className="mt-8 space-y-5">
              <Field icon={<User className="h-4 w-4" />} label={t("Operator ID")}>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                  autoComplete="username"
                  autoFocus
                />
              </Field>
              <Field icon={<Lock className="h-4 w-4" />} label={t("Encryption Key")}>
                <input
                  type="password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                  autoComplete="current-password"
                />
              </Field>

              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="accent-hud" />
                  <span>{t("Hardware token")}</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setShowRecovery(true);
                    setRecoverySubmitted(false);
                    setRecoveryId("");
                  }}
                  className="hover:text-hud cursor-pointer transition-colors"
                >
                  {t("Recover access ›")}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full overflow-hidden border border-hud bg-hud/10 px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-hud hover:bg-hud/20 disabled:opacity-60"
              >
                {loading ? t("AUTHENTICATING...") : t("Initiate Session ›› ")}
              </button>

              {error && (
                <div className="flex items-center gap-2 border border-threat/40 bg-threat/5 p-3 text-[10px] uppercase tracking-[0.2em] text-threat">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {error}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-center gap-2 border border-border bg-input/40 px-3 py-2.5 focus-within:border-hud">
        <span className="text-muted-foreground">{icon}</span>
        {children}
      </div>
    </label>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "hud" | "warning" | "threat";
}) {
  const t = { hud: "text-hud", warning: "text-warning", threat: "text-threat" }[tone];
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</span>
      <span className={`hud-stat font-bold ${t}`}>{value}</span>
    </div>
  );
}
