import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import {
  Shield,
  KeyRound,
  Activity,
  LogOut,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Camera,
  Pencil,
  Send,
  Link2,
  Link2Off,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authApi, profileApi, twoFactorApi, telegramApi, type ApiProfileStats } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { sessionAuth } from "@/lib/auth";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/profile")({
  component: Profile,
  head: () => ({ meta: [{ title: "Profile // DDS" }] }),
});

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  senior_operator: "Senior Operator",
  operator: "Operator",
  analyst: "Analyst",
  viewer: "Viewer",
};

const CLEARANCE_TIERS: Record<string, string> = {
  UNCLASSIFIED: "Tier 1",
  SECRET: "Tier 2",
  "TOP SECRET": "Tier 3",
};

const CLEARANCE_COLOR: Record<string, string> = {
  UNCLASSIFIED: "text-muted-foreground",
  SECRET: "text-warning",
  "TOP SECRET": "text-threat",
};

function getInitials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Change Password Dialog ────────────────────────────────────
function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setSuccess(false);
    setLoading(false);
  };
  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError(t("Passwords do not match"));
      return;
    }
    if (next.length < 6) {
      setError(t("Min 6 characters"));
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(current, next);
      setSuccess(true);
      setTimeout(handleClose, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("Failed to change password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="border-border bg-background max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.25em] text-hud">
            {t("Change Password")}
          </DialogTitle>
        </DialogHeader>
        {success ? (
          <div className="flex items-center gap-3 py-4 text-hud text-sm">
            <CheckCircle className="h-5 w-5" /> {t("Password updated successfully.")}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 py-2">
            <Field label={t("Current password")}>
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-input/30 border-border text-sm"
              />
            </Field>
            <Field label={t("New password")}>
              <Input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-input/30 border-border text-sm"
              />
            </Field>
            <Field label={t("Confirm new password")}>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-input/30 border-border text-sm"
              />
            </Field>
            {error && (
              <div className="flex items-center gap-2 text-[11px] text-threat">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {loading ? t("Updating...") : t("Update")}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Two-Factor Auth Dialog ───────────────────────────────────
type TfaMode = "setup" | "verify" | "disable";
function TwoFactorDialog({
  open,
  enabled,
  onClose,
  onChanged,
}: {
  open: boolean;
  enabled: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<TfaMode>(enabled ? "disable" : "setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(enabled ? "disable" : "setup");
      setCode("");
      setError(null);
      setQrDataUrl(null);
      setSecret(null);
      setDone(false);
    }
  }, [open, enabled]);

  async function doSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await twoFactorApi.setup();
      setQrDataUrl(res.qrDataUrl);
      setSecret(res.secret);
      setMode("verify");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("Failed to start setup"));
    } finally {
      setLoading(false);
    }
  }

  async function doVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await twoFactorApi.verify(code);
      setDone(true);
      setTimeout(() => {
        onChanged();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("Invalid code"));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function doDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await twoFactorApi.disable(code);
      setDone(true);
      setTimeout(() => {
        onChanged();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("Invalid code"));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-border bg-background max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.25em] text-hud">
            {enabled ? t("Disable 2FA") : t("Enable 2FA")}
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex items-center gap-3 py-4 text-hud text-sm">
            <CheckCircle className="h-5 w-5" />
            {enabled ? t("2FA disabled.") : t("2FA enabled successfully.")}
          </div>
        ) : mode === "setup" ? (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              {t(
                "Install an authenticator app (Google Authenticator, Authy) and scan the QR code.",
              )}
            </p>
            {error && (
              <div className="text-xs text-threat flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={doSetup}
                disabled={loading}
                className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("Generate QR")}
              </button>
            </DialogFooter>
          </div>
        ) : mode === "verify" ? (
          <form onSubmit={doVerify} className="space-y-4 py-2">
            {qrDataUrl && (
              <div className="flex flex-col items-center gap-2">
                <img src={qrDataUrl} alt="QR Code" className="w-40 h-40 border border-hud/30" />
                {secret && (
                  <p className="text-[9px] font-mono text-muted-foreground break-all">{secret}</p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("Enter the 6-digit code from your app to confirm.")}
            </p>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              autoFocus
              className="bg-input/30 border-border text-sm tracking-[0.4em] font-mono"
            />
            {error && (
              <div className="text-xs text-threat flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("Verify & Enable")}
              </button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={doDisable} className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              {t("Enter your authenticator code to disable 2FA.")}
            </p>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              autoFocus
              className="bg-input/30 border-border text-sm tracking-[0.4em] font-mono"
            />
            {error && (
              <div className="text-xs text-threat flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex items-center gap-2 border border-threat/60 bg-threat/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-threat hover:bg-threat/20 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("Disable 2FA")}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Name Dialog ──────────────────────────────────────────
function EditNameDialog({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(current);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setName(current);
  }, [open, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await profileApi.updateName(name.trim());
      onSaved(res.name);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("Failed to update name"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-border bg-background max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-[0.25em] text-hud">
            {t("Edit Display Name")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-2">
          <Field label={t("Full name (ФИО)")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Syrym Argyn"
              required
              minLength={2}
              className="bg-input/30 border-border text-sm"
            />
          </Field>
          {error && (
            <div className="flex items-center gap-2 text-[11px] text-threat">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? t("Saving...") : t("Save")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

// ─── Avatar Widget ─────────────────────────────────────────────
function AvatarWidget({
  initials,
  avatarUrl,
  onUpload,
}: {
  initials: string;
  avatarUrl: string | null | undefined;
  onUpload: (url: string) => void;
}) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    try {
      const res = await profileApi.uploadAvatar(file);
      onUpload(res.avatarUrl);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : t("Upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="relative mx-auto w-fit">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <div
        onClick={() => fileRef.current?.click()}
        className="group relative mx-auto flex h-24 w-24 cursor-pointer items-center justify-center border border-hud bg-hud/10 overflow-hidden"
        title={t("Click to upload photo")}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-bold text-hud hud-text-glow">{initials}</span>
        )}
        {/* hover overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 opacity-0 transition-opacity group-hover:opacity-100">
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-hud" />
          ) : (
            <>
              <Camera className="h-5 w-5 text-hud" />
              <span className="mt-1 text-[9px] uppercase tracking-[0.15em] text-hud">
                {t("Upload")}
              </span>
            </>
          )}
        </div>
      </div>
      {err && <div className="mt-1 text-[10px] text-threat text-center">{err}</div>}
    </div>
  );
}

// ─── Main Profile Page ─────────────────────────────────────────
function Profile() {
  const { t } = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<ApiProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [showName, setShowName] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [liveAvatar, setLiveAvatar] = useState<string | null>(null);
  const [liveName, setLiveName] = useState<string | null>(null);
  const [tgLinked, setTgLinked] = useState(false);
  const [tgCode, setTgCode] = useState("");
  const [tgCodeInput, setTgCodeInput] = useState("");
  const [tgLinking, setTgLinking] = useState(false);
  const [tgError, setTgError] = useState("");

  const cached = (() => {
    try {
      return JSON.parse(localStorage.getItem("dds_user") ?? "null");
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    profileApi
      .stats()
      .then((d) => {
        setData(d);
        if (d.user) {
          try {
            const prev = JSON.parse(localStorage.getItem("dds_user") ?? "{}");
            localStorage.setItem("dds_user", JSON.stringify({ ...prev, ...d.user }));
            window.dispatchEvent(new Event("dds_user_updated"));
          } catch {
            // ignore localStorage errors
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    telegramApi.status().then((d) => setTgLinked(d.linked)).catch(() => {});
  }, []);

  const user = data?.user ?? cached;
  const stats = data?.stats;
  const name = liveName ?? user?.name ?? "—";
  const initials = name !== "—" ? getInitials(name) : "??";
  const role = user ? (ROLE_LABELS[user.role] ?? user.role) : "—";
  const tier = user ? (CLEARANCE_TIERS[user.clearance] ?? "—") : "—";
  const clrColor = user ? (CLEARANCE_COLOR[user.clearance] ?? "") : "";
  const avatarUrl = liveAvatar ?? user?.avatarUrl ?? null;
  const joinedAt = user?.createdAt ? format(new Date(user.createdAt), "yyyy-MM-dd") : "—";

  const handleTgLink = async () => {
    if (!tgCodeInput.trim()) return;
    setTgLinking(true);
    setTgError("");
    try {
      await telegramApi.link(tgCodeInput.trim());
      setTgLinked(true);
      setTgCode("");
      setTgCodeInput("");
    } catch (err: any) {
      setTgError(err.message ?? t("Link failed"));
    } finally {
      setTgLinking(false);
    }
  };

  const handleTgUnlink = async () => {
    await telegramApi.unlink().catch(() => {});
    setTgLinked(false);
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore — proceed with local logout regardless
    }
    sessionStorage.removeItem("dds_token");
    localStorage.removeItem("dds_user");
    sessionAuth.clear();
    navigate({ to: "/login", replace: true });
  };

  return (
    <>
      <ChangePasswordDialog open={showPwd} onClose={() => setShowPwd(false)} />
      <TwoFactorDialog
        open={show2fa}
        enabled={totpEnabled}
        onClose={() => setShow2fa(false)}
        onChanged={() => setTotpEnabled((v) => !v)}
      />
      <EditNameDialog
        open={showName}
        current={name}
        onClose={() => setShowName(false)}
        onSaved={(n) => {
          setLiveName(n);
          try {
            const prev = JSON.parse(localStorage.getItem("dds_user") ?? "{}");
            localStorage.setItem("dds_user", JSON.stringify({ ...prev, name: n }));
            window.dispatchEvent(new Event("dds_user_updated"));
          } catch {
            // ignore localStorage errors
          }
        }}
      />

      <div>
        <PageHeader
          title={t("Operator Profile")}
          subtitle={t("Identity · credentials · activity ledger")}
          actions={
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 border border-border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-threat hover:text-threat"
            >
              <LogOut className="h-3.5 w-3.5" /> {t("Logout")}
            </button>
          }
        />

        <div className="grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_2fr]">
          {/* ── Identity card ── */}
          <HudPanel bodyClassName="p-6 text-center">
            {loading && !user ? (
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-hud" />
            ) : (
              <>
                <AvatarWidget
                  initials={initials}
                  avatarUrl={avatarUrl}
                  onUpload={(url) => {
                    setLiveAvatar(url);
                    try {
                      const prev = JSON.parse(localStorage.getItem("dds_user") ?? "{}");
                      localStorage.setItem("dds_user", JSON.stringify({ ...prev, avatarUrl: url }));
                      window.dispatchEvent(new Event("dds_user_updated"));
                    } catch {
                      // ignore localStorage errors
                    }
                  }}
                />

                {/* Name with edit button */}
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="text-lg font-bold tracking-widest text-foreground">{name}</span>
                  <button
                    onClick={() => setShowName(true)}
                    className="text-muted-foreground hover:text-hud"
                    title="Edit name"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Role · Clearance tier */}
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {t(role)} · {t(tier)}
                </div>

                {/* Clearance badge */}
                {user?.clearance && (
                  <div
                    className={`mt-1 inline-block border border-current px-2 py-0.5 text-[9px] uppercase tracking-[0.3em] font-bold ${clrColor}`}
                  >
                    {user.clearance}
                  </div>
                )}

                <div className="mt-4 border-t border-border pt-4 space-y-2 text-xs text-left">
                  <InfoRow label={t("Operator ID")} value={user?.operatorId ?? "—"} />
                  <InfoRow label={t("Email")} value={user?.email ?? "—"} />
                  <InfoRow label={t("Role")} value={t(role)} />
                  <InfoRow
                    label={t("Clearance")}
                    value={user?.clearance ? t(user.clearance) : "—"}
                    tone="hud"
                  />
                  <InfoRow label={t("Joined")} value={joinedAt} />
                  <InfoRow
                    label={t("Last active")}
                    value={
                      user?.lastActive
                        ? new Date(user.lastActive).toLocaleString("ru-KZ", {
                            timeZone: "Asia/Almaty",
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"
                    }
                  />
                  <InfoRow
                    label={t("Status")}
                    value={(user?.status ?? "online").toUpperCase()}
                    tone={user?.status === "online" ? "hud" : undefined}
                  />
                </div>
              </>
            )}
          </HudPanel>

          <div className="space-y-3">
            {/* ── Security panel ── */}
            <HudPanel title={t("Security")} actions={<Shield className="h-4 w-4 text-hud" />}>
              <div className="grid gap-3 md:grid-cols-2 text-xs">
                <ActionCard
                  label={t("Change password")}
                  desc={t("Update your access credentials")}
                  icon={<KeyRound className="h-4 w-4" />}
                  onClick={() => setShowPwd(true)}
                />
                <ActionCard
                  label={t("Edit display name")}
                  desc={t("Update your ФИО on the roster")}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => setShowName(true)}
                />
                <ActionCard
                  label={totpEnabled ? t("2FA: Enabled") : t("Enable 2FA")}
                  desc={
                    totpEnabled
                      ? t("TOTP active — click to disable")
                      : t("Add an authenticator app")
                  }
                  icon={<KeyRound className="h-4 w-4" />}
                  tone={totpEnabled ? "hud" : undefined}
                  onClick={() => setShow2fa(true)}
                />
                <ActionCard
                  label={t("Session")}
                  desc={t("JWT · 24h expiry · auto-refresh")}
                  tone="warning"
                />
              </div>
            </HudPanel>

            {/* ── Telegram ── */}
            <HudPanel
              title="Telegram"
              actions={<Send className="h-4 w-4 text-hud" />}
            >
              {tgLinked ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <CheckCircle className="h-4 w-4" />
                    <span>{t("Telegram account linked")}</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {t("You receive push notifications via the bot.")}
                  </p>
                  <button
                    onClick={handleTgUnlink}
                    className="flex items-center gap-1.5 rounded border border-red-800/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                  >
                    <Link2Off className="h-3 w-3" />
                    {t("Unlink Telegram")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400">
                    {t("Link your Telegram to receive threat and incident alerts.")}
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-zinc-300">
                    <li>{t("Open Telegram and find @SkyGuardianDDS_Bot")}</li>
                    <li>{t("Send /auth — you will receive a 6-digit code")}</li>
                    <li>{t("Enter the code below")}</li>
                  </ol>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="000000"
                      value={tgCodeInput}
                      onChange={(e) => setTgCodeInput(e.target.value.replace(/\D/g, ""))}
                      className="w-28 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-center text-sm font-mono tracking-widest text-white focus:border-hud focus:outline-none"
                    />
                    <button
                      onClick={handleTgLink}
                      disabled={tgLinking || tgCodeInput.length !== 6}
                      className="flex items-center gap-1.5 rounded border border-hud/60 px-3 py-1.5 text-xs text-hud hover:bg-hud/10 disabled:opacity-40"
                    >
                      {tgLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                      {t("Link")}
                    </button>
                  </div>
                  {tgError && <p className="text-xs text-red-400">{tgError}</p>}
                </div>
              )}
            </HudPanel>

            {/* ── Activity stats ── */}
            <HudPanel
              title={t("Activity Statistics")}
              actions={<Activity className="h-4 w-4 text-hud" />}
            >
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-hud" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
                  <StatBox
                    label={t("Total detections")}
                    value={stats ? String(stats.totalDetections) : "—"}
                  />
                  <StatBox
                    label={t("Incidents assigned")}
                    value={stats ? String(stats.assignedIncidents) : "—"}
                  />
                  <StatBox
                    label={t("Incidents closed")}
                    value={stats ? String(stats.closedIncidents) : "—"}
                  />
                  <StatBox label={t("Role")} value={t(role)} />
                  <StatBox
                    label={t("Audit actions")}
                    value={stats ? String(stats.auditActions) : "—"}
                  />
                  <StatBox
                    label={t("Clearance")}
                    value={user?.clearance ? t(user.clearance) : "—"}
                  />
                </div>
              )}
            </HudPanel>
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value, tone }: { label: string; value: string; tone?: "hud" }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground shrink-0">
        {label}
      </span>
      <span
        className={`hud-stat font-bold text-right truncate ${tone === "hud" ? "text-hud" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function ActionCard({
  label,
  desc,
  icon,
  tone,
  onClick,
}: {
  label: string;
  desc: string;
  icon?: React.ReactNode;
  tone?: "hud" | "warning";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "hud" ? "text-hud" : tone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <div
      onClick={onClick}
      className={`border border-border bg-panel/30 px-3 py-3 ${onClick ? "cursor-pointer hover:border-hud" : ""}`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-1 text-[11px] ${toneClass}`}>{desc}</div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-panel/40 px-3 py-3">
      <div className="hud-stat text-2xl font-bold text-hud">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
